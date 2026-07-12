// The wire contract between the main thread and the kernel worker (issue #23). Zero imports on
// purpose: this is what lets `KernelClient.ts` and this file both run in the Node-only Vitest
// project with no DOM shim and no Worker — and it's the type-level half of architecture invariant
// 1 (no brepjs/OCCT symbol may execute on the main thread), since nothing here needs brepjs to
// describe brepjs's output.
//
// `KernelWorkerApi` is declared here rather than in `kernel.worker.ts` so that main-thread code
// (specifically `createKernelClient.ts`, which types `Comlink.wrap<KernelWorkerApi>(worker)`)
// never has to import the worker module itself — only this dependency-free file.

/** Identifies one parametric solid across its lifetime (created once, re-tessellated many times).
 *  This is what lets the worker re-tessellate *only* the solid that changed (issue #26) instead of
 *  every solid in the scene. */
export type SolidId = string;

/** Identifies one request/response round trip. Never reused — a new `JobId` per `request()` call
 *  is what makes stale-drop-by-`jobId` possible in `KernelClient`. */
export type JobId = string;

/** Parameters for a `box` request — matches brepjs's `box(width, depth, height)`. */
export interface BoxParams {
	width: number;
	depth: number;
	height: number;
}

/** Parameters for a `cylinder` request — matches brepjs's `cylinder(radius, height)`. */
export interface CylinderParams {
	radius: number;
	height: number;
}

/** Common fields on every request the worker accepts. */
interface KernelRequestBase {
	jobId: JobId;
	solidId: SolidId;
}

export interface MakeBoxRequest extends KernelRequestBase {
	type: 'box';
	params: BoxParams;
}

export interface MakeCylinderRequest extends KernelRequestBase {
	type: 'cylinder';
	params: CylinderParams;
}

/** Re-tessellate a solid that was already created by an earlier `box`/`cylinder` request. */
export interface TessellateRequest extends KernelRequestBase {
	type: 'tessellate';
}

/** Discriminated union of every request the worker accepts. `solidId` is what scopes each request
 *  to a single solid, so #26's "only the changed solid is re-tessellated" is expressible at all. */
export type KernelRequest = MakeBoxRequest | MakeCylinderRequest | TessellateRequest;

/** What a caller passes to `KernelClient.request()` — the same shapes as {@link KernelRequest}
 *  minus `jobId`, which the client stamps on internally when it actually dispatches the request
 *  (not necessarily the same moment `request()` is called — see the debounce/conflation docs on
 *  `KernelClient`). */
export type KernelRequestInput =
	| { type: 'box'; solidId: SolidId; params: BoxParams }
	| { type: 'cylinder'; solidId: SolidId; params: CylinderParams }
	| { type: 'tessellate'; solidId: SolidId };

/** A tessellated mesh, shaped for zero-copy transfer across the worker boundary (invariant 6).
 *  Pinning the type parameter to `ArrayBuffer` (rather than the default `ArrayBufferLike`) is what
 *  makes `.buffer` statically a `Transferable` — `SharedArrayBuffer` is never a legal value here,
 *  which is the type-level statement of invariant 7 (single-threaded OCCT; no shared memory). */
export interface MeshPayload {
	positions: Float32Array<ArrayBuffer>;
	normals: Float32Array<ArrayBuffer>;
	indices: Uint32Array<ArrayBuffer>;
	triangleCount: number;
}

/** Closed set of ways a kernel operation can fail. Closed (not `string`) so every call site
 *  handling a `KernelError` is forced to reconsider itself if a new failure mode is ever added. */
export type KernelErrorCode =
	| 'kernel-init-failed'
	| 'invalid-params'
	| 'geometry-failed'
	| 'unknown-solid'
	| 'cancelled'
	| 'worker-crashed';

export interface KernelError {
	code: KernelErrorCode;
	message: string;
}

/**
 * Result of a job-scoped kernel operation. Never thrown across the worker boundary — Comlink would
 * structured-clone a thrown error and rethrow it on the caller's side, which loses the
 * {@link KernelErrorCode} and turns a perfectly recoverable UI condition (invalid slider input,
 * mid-flight cancellation) into an unhandled promise rejection. Every worker method that can fail
 * returns one of these instead.
 */
export type KernelResult<T> =
	{ ok: true; jobId: JobId; value: T } | { ok: false; jobId: JobId; error: KernelError };

/** Same never-throw contract as {@link KernelResult}, for the one worker operation
 *  (`warmup()`) that isn't scoped to a particular job or solid and so has no `jobId` to report. */
export type KernelOutcome = { ok: true } | { ok: false; error: KernelError };

/** Builds a successful {@link KernelResult}. */
export function ok<T>(jobId: JobId, value: T): KernelResult<T> {
	return { ok: true, jobId, value };
}

/** Builds a failed {@link KernelResult}. */
export function err<T>(jobId: JobId, error: KernelError): KernelResult<T> {
	return { ok: false, jobId, error };
}

/**
 * The transfer list for a {@link MeshPayload}, de-duplicated via `Set`. brepjs's mesh output
 * happens to give `positions`/`normals`/`indices` three distinct buffers today, but nothing
 * guarantees that stays true — if a future brepjs version ever returned multiple typed-array
 * *views* over one shared `ArrayBuffer`, listing that buffer twice in a transfer list makes
 * `postMessage` throw `DataCloneError`. De-duping here means callers never have to know or care.
 */
export function meshTransferables(payload: MeshPayload): Transferable[] {
	return Array.from(
		new Set<ArrayBuffer>([payload.positions.buffer, payload.normals.buffer, payload.indices.buffer])
	);
}

/**
 * The kernel worker's API surface, as seen through a Comlink proxy. Declared here (not in
 * `kernel.worker.ts`) so `kernel.worker.ts satisfies KernelWorkerApi` catches the worker drifting
 * out of sync with its own contract, while main-thread code that needs the *type* (`Comlink.wrap<
 * KernelWorkerApi>` in `createKernelClient.ts`) never has to import the worker module — only this
 * dependency-free one.
 */
export interface KernelWorkerApi {
	warmup(): Promise<KernelOutcome>;
	makeBox(req: MakeBoxRequest): Promise<KernelResult<MeshPayload>>;
	makeCylinder(req: MakeCylinderRequest): Promise<KernelResult<MeshPayload>>;
	tessellate(req: TessellateRequest): Promise<KernelResult<MeshPayload>>;
	/** Best-effort: see `kernel.worker.ts` and `KernelClient.ts` for the honest guarantee this
	 *  actually provides — at most one stale computation can ever run to completion. */
	cancel(jobId: JobId): Promise<void>;
	dispose(solidId: SolidId): Promise<void>;
}
