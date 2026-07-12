// The kernel worker (issue #22). The **only** file in the repo permitted to name `brepjs` or
// `occt-wasm` — enforced mechanically by the `no-restricted-imports` block in eslint.config.js, so
// architecture invariant 1 ("no brepjs/OCCT symbol may execute on the main thread") is a lint
// failure, not a style nit, the moment a second file tries to import either package.
//
// Never names a worker-only global. The tsconfig's `lib` is `["esnext","DOM","DOM.Iterable"]` with
// no `webworker`, and `.svelte-kit/tsconfig.json` is generated so it can't be edited to add one —
// loading `lib.webworker.d.ts` alongside `lib.dom` produces dozens of duplicate-identifier errors
// and breaks `pnpm check`. `Comlink.expose()` defaults its endpoint to `globalThis`, so this file
// never has to write `self`, and everything else it touches (`Map`, `Set`, `setTimeout`) is already
// in `lib.dom`.
import * as Comlink from 'comlink';
import { OcctKernel } from 'occt-wasm';
import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url';
import { box, cylinder, mesh, OcctWasmAdapter, registerKernel, toBufferGeometryData } from 'brepjs';
import type { ValidSolid } from 'brepjs';
import {
	err,
	meshTransferables,
	ok,
	type JobId,
	type KernelOutcome,
	type KernelResult,
	type KernelWorkerApi,
	type MakeBoxRequest,
	type MakeCylinderRequest,
	type MeshPayload,
	type SolidId,
	type TessellateRequest
} from './types';

/**
 * Resolves once (memoized), after OCCT's ~22 MB WASM module has booted and registered itself as
 * brepjs's default kernel. Every method below awaits this first, so the first caller pays the boot
 * cost and every later call — even for a different solid — piggybacks on the same promise.
 *
 * Registering manually (rather than calling brepjs's own no-args `init()`) is what lets the wasm
 * URL be Vite's own content-hashed asset (`?url` import) instead of occt-wasm's `import.meta.url`
 * auto-location, which is what makes the asset cacheable by Phase 3's service worker. brepjs's
 * `registerKernel(id, adapter)` makes `id` the default kernel as a side effect of it being the
 * *first* kernel registered (see `_defaultKernelId` in brepjs's kernel/index.ts) — so no separate
 * call to brepjs's own `init()` is needed, or wanted: that path re-derives the wasm URL itself and
 * would race this one.
 */
let readyPromise: Promise<void> | undefined;
function ensureReady(): Promise<void> {
	if (!readyPromise) {
		readyPromise = OcctKernel.init({ wasm: wasmUrl }).then((kernel) => {
			registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel));
		});
	}
	return readyPromise;
}

const solids = new Map<SolidId, ValidSolid>();

// Populated by `cancel()`, drained by `wasCancelled()`. A `Set` rather than a per-job flag on some
// longer-lived record because a cancelled job's own record may already be gone by the time this is
// checked (see `wasCancelled`'s one-shot delete).
const cancelledJobs = new Set<JobId>();

/**
 * The achievable cancellation guarantee (see `KernelClient.ts` for the client half of this): OCCT
 * is single-threaded and `mesh()` is synchronous, so once a job's macrotask gate (below) has
 * resolved and it has entered `mesh()`, the worker's event loop is blocked and a `cancel()` message
 * physically cannot be delivered until `mesh()` returns — cancelling that job is therefore a no-op
 * from here on, and its result is instead dropped by `jobId` on the client. What *is* achievable,
 * and is exactly what this checks: a job that has not yet passed its macrotask gate — i.e. every
 * `cancel()` that arrives while the worker is idle, between two jobs — is preempted here, before it
 * ever touches OCCT.
 */
function wasCancelled(jobId: JobId): boolean {
	return cancelledJobs.delete(jobId);
}

/** Resolves after the current macrotask queue has been drained, so a `cancel()` message sent while
 *  this job was still queued (rather than already inside the synchronous `mesh()` call below) has a
 *  chance to actually arrive and be recorded by `cancel()` before `wasCancelled` is checked. */
function yieldToMacrotaskQueue(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function toMeshPayload(shape: ValidSolid): MeshPayload {
	const data = toBufferGeometryData(mesh(shape));
	// brepjs types these typed arrays against the general `ArrayBufferLike` (which also covers
	// `SharedArrayBuffer`), but they're always freshly allocated JS-side copies out of OCCT's
	// tessellation — invariant 7 (single-threaded OCCT) means a `SharedArrayBuffer` is never in play
	// here. Asserting the narrower `ArrayBuffer` is what makes `MeshPayload` statically transferable.
	return {
		positions: data.position as Float32Array<ArrayBuffer>,
		normals: data.normal as Float32Array<ArrayBuffer>,
		indices: data.index as Uint32Array<ArrayBuffer>,
		triangleCount: data.index.length / 3
	};
}

/** Wraps a message so `error` is always a plain string, whatever brepjs/OCCT actually threw. */
function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const api: KernelWorkerApi = {
	async warmup(): Promise<KernelOutcome> {
		try {
			await ensureReady();
			return { ok: true };
		} catch (error) {
			return { ok: false, error: { code: 'kernel-init-failed', message: describeError(error) } };
		}
	},

	async makeBox(req: MakeBoxRequest): Promise<KernelResult<MeshPayload>> {
		try {
			await ensureReady();
		} catch (error) {
			return err(req.jobId, { code: 'kernel-init-failed', message: describeError(error) });
		}

		await yieldToMacrotaskQueue();
		if (wasCancelled(req.jobId)) {
			return err(req.jobId, { code: 'cancelled', message: 'superseded before tessellation began' });
		}

		let shape: ValidSolid;
		try {
			shape = box(req.params.width, req.params.depth, req.params.height);
		} catch (error) {
			return err(req.jobId, { code: 'invalid-params', message: describeError(error) });
		}
		solids.set(req.solidId, shape);

		try {
			const payload = toMeshPayload(shape);
			return Comlink.transfer(ok(req.jobId, payload), meshTransferables(payload));
		} catch (error) {
			return err(req.jobId, { code: 'geometry-failed', message: describeError(error) });
		}
	},

	async makeCylinder(req: MakeCylinderRequest): Promise<KernelResult<MeshPayload>> {
		try {
			await ensureReady();
		} catch (error) {
			return err(req.jobId, { code: 'kernel-init-failed', message: describeError(error) });
		}

		await yieldToMacrotaskQueue();
		if (wasCancelled(req.jobId)) {
			return err(req.jobId, { code: 'cancelled', message: 'superseded before tessellation began' });
		}

		let shape: ValidSolid;
		try {
			shape = cylinder(req.params.radius, req.params.height);
		} catch (error) {
			return err(req.jobId, { code: 'invalid-params', message: describeError(error) });
		}
		solids.set(req.solidId, shape);

		try {
			const payload = toMeshPayload(shape);
			return Comlink.transfer(ok(req.jobId, payload), meshTransferables(payload));
		} catch (error) {
			return err(req.jobId, { code: 'geometry-failed', message: describeError(error) });
		}
	},

	async tessellate(req: TessellateRequest): Promise<KernelResult<MeshPayload>> {
		try {
			await ensureReady();
		} catch (error) {
			return err(req.jobId, { code: 'kernel-init-failed', message: describeError(error) });
		}

		await yieldToMacrotaskQueue();
		if (wasCancelled(req.jobId)) {
			return err(req.jobId, { code: 'cancelled', message: 'superseded before tessellation began' });
		}

		const shape = solids.get(req.solidId);
		if (!shape) {
			return err(req.jobId, {
				code: 'unknown-solid',
				message: `no solid registered for ${req.solidId}`
			});
		}

		try {
			const payload = toMeshPayload(shape);
			return Comlink.transfer(ok(req.jobId, payload), meshTransferables(payload));
		} catch (error) {
			return err(req.jobId, { code: 'geometry-failed', message: describeError(error) });
		}
	},

	async cancel(jobId: JobId): Promise<void> {
		cancelledJobs.add(jobId);
	},

	async dispose(solidId: SolidId): Promise<void> {
		solids.delete(solidId);
	}
} satisfies KernelWorkerApi;

Comlink.expose(api);
