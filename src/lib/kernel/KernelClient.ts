// The DI seam between the app and the kernel worker (issue #24). Imports `./types` and nothing
// else — no `comlink`, no `three`, no `brepjs` — which is what makes this unit-testable in the
// Node-only Vitest project with a hand-written `RecordingKernel` stub instead of a real Worker.
// `Comlink.wrap` and `new Worker(...)` live in the separate, browser-only `createKernelClient.ts`
// factory; this module only ever sees the `KernelApi` shape they produce, injected via
// `KernelClientOptions.connect()`.
//
// Per architecture invariant 2 (on-demand rendering only), this module never calls
// `invalidate()` itself — it just reports finished meshes and errors via `onMesh`/`onError`, and
// callers (Scene.svelte in PR 2) decide whether/when that becomes exactly one `invalidateFor(...,
// 'model')`.
import type {
	JobId,
	KernelError,
	KernelOutcome,
	KernelRequest,
	KernelRequestInput,
	KernelResult,
	MeshPayload,
	SolidId
} from './types';

/**
 * Structural mirror of the worker's Comlink proxy (see `KernelWorkerApi` in `./types`, which is
 * what `Comlink.wrap<KernelWorkerApi>` in `createKernelClient.ts` actually types). Declared as its
 * own alias — rather than this module importing `KernelWorkerApi` directly — so nothing here has
 * to know that "the worker's Comlink proxy" and "`KernelWorkerApi`" are the same shape; it only
 * needs to know what shape *it* requires of whatever `connect()` hands back.
 */
export type KernelApi = {
	warmup(): Promise<KernelOutcome>;
	makeBox(req: Extract<KernelRequest, { type: 'box' }>): Promise<KernelResult<MeshPayload>>;
	makeCylinder(
		req: Extract<KernelRequest, { type: 'cylinder' }>
	): Promise<KernelResult<MeshPayload>>;
	tessellate(
		req: Extract<KernelRequest, { type: 'tessellate' }>
	): Promise<KernelResult<MeshPayload>>;
	cancel(jobId: JobId): Promise<void>;
	dispose(solidId: SolidId): Promise<void>;
};

/** Injectable clock, so tests can drive debounce timing synchronously (a hand-written
 *  `ManualClock`) instead of reaching for `vi.useFakeTimers()` — see `KernelClient.spec.ts`. */
export interface Scheduler {
	/** Schedules `fn` to run after `ms` milliseconds; returns a canceller. */
	delay(fn: () => void, ms: number): () => void;
}

const setTimeoutScheduler: Scheduler = {
	delay(fn, ms) {
		const handle = setTimeout(fn, ms);
		return () => clearTimeout(handle);
	}
};

export interface KernelClientOptions {
	/** Lazy on purpose: the ~22 MB worker boots on first use (first `request()` or explicit
	 *  `warmup()`), not at import/construction time. */
	connect(): Promise<KernelApi>;
	/** Default: `setTimeout`-backed. */
	scheduler?: Scheduler;
	/** Default: 60ms. */
	debounceMs?: number;
}

interface SolidState {
	cancelDebounce?: () => void;
	pendingInput?: KernelRequestInput;
	inFlightJobId?: JobId;
	/** Whether `cancel()` has already been sent for `inFlightJobId` — guarantees at most one
	 *  `cancel()` call per superseded in-flight job, however many times it gets re-superseded
	 *  while still running. */
	cancelledInFlight: boolean;
}

/**
 * Debounces and conflates parameter updates per solid, then dispatches them to the kernel worker.
 *
 * **The honest cancellation guarantee** (see also `kernel.worker.ts`): OCCT-WASM is single-threaded
 * and its `mesh()` call is synchronous, so a `cancel()` message physically cannot be delivered
 * while a job is inside it. This class does not pretend otherwise. What it guarantees instead: at
 * most one stale computation can ever run to completion per solid. Every request superseded before
 * it was ever sent is conflated away in this solid's single pending slot and never reaches the
 * worker at all; every in-flight request superseded after being sent gets exactly one `cancel()`
 * call, which either preempts it at the worker's macrotask gate (before it touches OCCT) or — if
 * it's already inside `mesh()` — is a no-op, in which case its eventual (correct, but stale) result
 * is dropped here by `jobId` instead of being surfaced as a mesh or triggering `invalidate()`.
 */
export class KernelClient {
	private readonly connect: () => Promise<KernelApi>;
	private readonly scheduler: Scheduler;
	private readonly debounceMs: number;

	private apiPromise: Promise<KernelApi> | undefined;
	private readonly solids = new Map<SolidId, SolidState>();
	private readonly meshListeners = new Set<(solidId: SolidId, payload: MeshPayload) => void>();
	private readonly errorListeners = new Set<(error: KernelError) => void>();
	private nextJobId = 0;

	private sentCount = 0;
	private droppedCount = 0;

	constructor(options: KernelClientOptions) {
		this.connect = options.connect;
		this.scheduler = options.scheduler ?? setTimeoutScheduler;
		this.debounceMs = options.debounceMs ?? 60;
	}

	/** Counters for observability/tests. `inFlight`/`pending` are computed live from current
	 *  per-solid state; `sent`/`dropped` are cumulative for the client's lifetime. */
	get stats(): Readonly<{ sent: number; inFlight: number; pending: number; dropped: number }> {
		let inFlight = 0;
		let pending = 0;
		for (const state of this.solids.values()) {
			if (state.inFlightJobId !== undefined) inFlight += 1;
			if (state.pendingInput !== undefined) pending += 1;
		}
		return { sent: this.sentCount, inFlight, pending, dropped: this.droppedCount };
	}

	/** Debounced, conflated, fire-and-forget. Only the most recent call per `solidId` within the
	 *  debounce window is ever sent — see the class docstring for what happens to the rest. */
	request(input: KernelRequestInput): void {
		const state = this.stateFor(input.solidId);

		if (state.pendingInput !== undefined) {
			// A still-unsent request is being replaced before its debounce window even elapsed —
			// conflated away, never reaching the worker.
			this.droppedCount += 1;
		}
		state.pendingInput = input;

		state.cancelDebounce?.();
		state.cancelDebounce = this.scheduler.delay(() => this.flush(input.solidId), this.debounceMs);
	}

	/** Connects (if not already) and calls the worker's `warmup()`, surfacing failure via
	 *  `onError` rather than throwing. */
	async warmup(): Promise<void> {
		const api = await this.getApi();
		const result = await api.warmup();
		if (!result.ok) this.emitError(result.error);
	}

	onMesh(fn: (solidId: SolidId, payload: MeshPayload) => void): () => void {
		this.meshListeners.add(fn);
		return () => this.meshListeners.delete(fn);
	}

	onError(fn: (error: KernelError) => void): () => void {
		this.errorListeners.add(fn);
		return () => this.errorListeners.delete(fn);
	}

	/** Tears down this client's own bookkeeping (pending debounce timers, listeners). Does not
	 *  reach into the kernel — per-solid disposal there is `KernelWorkerApi.dispose(solidId)`,
	 *  called directly by whoever owns that solid's lifetime (PR 2's scene model). */
	dispose(): void {
		for (const state of this.solids.values()) {
			state.cancelDebounce?.();
		}
		this.solids.clear();
		this.meshListeners.clear();
		this.errorListeners.clear();
	}

	private stateFor(solidId: SolidId): SolidState {
		let state = this.solids.get(solidId);
		if (!state) {
			state = { cancelledInFlight: false };
			this.solids.set(solidId, state);
		}
		return state;
	}

	private async getApi(): Promise<KernelApi> {
		if (!this.apiPromise) this.apiPromise = this.connect();
		return this.apiPromise;
	}

	/** Runs once this solid's debounce window elapses. If nothing is in flight for this solid, the
	 *  pending input is sent immediately. If something is in flight, this solid's pending input
	 *  just waits — `cancel()` is sent (once) so at most one stale computation can complete, and
	 *  `onSettled` sends the pending input the moment the in-flight one resolves. */
	private flush(solidId: SolidId): void {
		const state = this.solids.get(solidId);
		if (!state) return;
		state.cancelDebounce = undefined;

		if (state.inFlightJobId !== undefined) {
			if (!state.cancelledInFlight) {
				state.cancelledInFlight = true;
				this.droppedCount += 1;
				const supersededJobId = state.inFlightJobId;
				void this.getApi().then((api) => api.cancel(supersededJobId));
			}
			return;
		}

		const input = state.pendingInput;
		if (input !== undefined) this.send(solidId, input);
	}

	private send(solidId: SolidId, input: KernelRequestInput): void {
		const state = this.stateFor(solidId);
		const jobId = String(this.nextJobId++);
		state.pendingInput = undefined;
		state.inFlightJobId = jobId;
		state.cancelledInFlight = false;
		this.sentCount += 1;

		// A debounce timer can still be outstanding here: `onSettled` calls `send` directly, ahead
		// of whatever timer `request()` scheduled for this same input. Left alone, that timer would
		// later fire, see this freshly-sent job as "in flight", and spuriously cancel it — this is
		// what stops that.
		state.cancelDebounce?.();
		state.cancelDebounce = undefined;

		const request = toKernelRequest(input, jobId);

		void this.getApi()
			.then((api) => dispatch(api, request))
			.then(
				(result) => this.onSettled(solidId, jobId, result),
				(error: unknown) => {
					// The Comlink call itself rejected (e.g. the worker crashed) rather than
					// resolving with a typed `KernelResult` — still never thrown further.
					this.onSettled(solidId, jobId, {
						ok: false,
						jobId,
						error: { code: 'worker-crashed', message: describeError(error) }
					});
				}
			);
	}

	private onSettled(solidId: SolidId, jobId: JobId, result: KernelResult<MeshPayload>): void {
		const state = this.solids.get(solidId);
		if (!state) return;

		// Defensive stale-drop by jobId: a result arriving for a job this solid no longer considers
		// current at all. Shouldn't happen structurally (a new job is never sent for a solid until
		// its predecessor settles), but this is the check that makes that invariant load-bearing
		// rather than assumed.
		if (state.inFlightJobId !== jobId) {
			this.droppedCount += 1;
			return;
		}

		// The real stale-drop case the honest cancellation guarantee describes: this job was
		// cancelled because a newer request superseded it, but OCCT's synchronous `mesh()` had
		// already started, so the worker finished it anyway and it comes back `ok: true`. Whether
		// it succeeded or failed, a job flagged superseded never becomes a mesh update — already
		// counted in `dropped` at the moment `cancel()` was sent in `flush()`, so it isn't
		// double-counted here.
		const wasSuperseded = state.cancelledInFlight;
		state.inFlightJobId = undefined;
		state.cancelledInFlight = false;

		if (!wasSuperseded) {
			if (result.ok) {
				for (const listener of this.meshListeners) listener(solidId, result.value);
			} else if (result.error.code !== 'cancelled') {
				this.emitError(result.error);
			}
			// A 'cancelled' error with no prior local supersession would be unexpected (the worker
			// only ever produces one in response to this client's own `cancel()`), but is swallowed
			// the same way on the principle that "cancelled" is never a user-facing failure.
		}

		if (state.pendingInput !== undefined) this.send(solidId, state.pendingInput);
	}

	private emitError(error: KernelError): void {
		for (const listener of this.errorListeners) listener(error);
	}
}

function toKernelRequest(input: KernelRequestInput, jobId: JobId): KernelRequest {
	switch (input.type) {
		case 'box':
			return { type: 'box', jobId, solidId: input.solidId, params: input.params };
		case 'cylinder':
			return { type: 'cylinder', jobId, solidId: input.solidId, params: input.params };
		case 'tessellate':
			return { type: 'tessellate', jobId, solidId: input.solidId };
	}
}

function dispatch(api: KernelApi, request: KernelRequest): Promise<KernelResult<MeshPayload>> {
	switch (request.type) {
		case 'box':
			return api.makeBox(request);
		case 'cylinder':
			return api.makeCylinder(request);
		case 'tessellate':
			return api.tessellate(request);
	}
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
