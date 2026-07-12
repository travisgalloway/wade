import { describe, expect, it } from 'vitest';
import { KernelClient, type KernelApi, type Scheduler } from './KernelClient';
import type { JobId, KernelError, KernelRequest, KernelResult, MeshPayload } from './types';

/** Hand-written `Scheduler` stub: virtual time advanced explicitly by the test, so debounce timing
 *  is deterministic without `vi.useFakeTimers()`. */
class ManualClock implements Scheduler {
	private now = 0;
	private nextId = 0;
	private readonly timers = new Map<number, { fn: () => void; dueAt: number }>();

	delay(fn: () => void, ms: number): () => void {
		const id = this.nextId++;
		this.timers.set(id, { fn, dueAt: this.now + ms });
		return () => {
			this.timers.delete(id);
		};
	}

	/** Advances virtual time by `ms` and synchronously runs every timer that becomes due, in due
	 *  order. Timers scheduled by a running timer are eligible in the same `advance` call only if
	 *  their due time has already passed. */
	advance(ms: number): void {
		this.now += ms;
		for (;;) {
			const due = [...this.timers.entries()]
				.filter(([, timer]) => timer.dueAt <= this.now)
				.sort((a, b) => a[1].dueAt - b[1].dueAt)[0];
			if (!due) return;
			const [id, timer] = due;
			this.timers.delete(id);
			timer.fn();
		}
	}
}

/** Hand-written `KernelApi` stub. Each `make*`/`tessellate` call is recorded and left pending
 *  (its promise resolved later, by test code calling `settle`) — this is what lets tests observe
 *  "has a request been sent yet" as a distinct moment from "has it resolved yet". */
class RecordingKernel implements KernelApi {
	readonly requests: KernelRequest[] = [];
	readonly cancelCalls: JobId[] = [];
	readonly disposeCalls: string[] = [];

	private readonly resolvers = new Map<JobId, (result: KernelResult<MeshPayload>) => void>();

	async warmup(): Promise<{ ok: true } | { ok: false; error: KernelError }> {
		return { ok: true };
	}

	makeBox(req: Extract<KernelRequest, { type: 'box' }>): Promise<KernelResult<MeshPayload>> {
		return this.record(req);
	}

	makeCylinder(
		req: Extract<KernelRequest, { type: 'cylinder' }>
	): Promise<KernelResult<MeshPayload>> {
		return this.record(req);
	}

	tessellate(
		req: Extract<KernelRequest, { type: 'tessellate' }>
	): Promise<KernelResult<MeshPayload>> {
		return this.record(req);
	}

	async cancel(jobId: JobId): Promise<void> {
		this.cancelCalls.push(jobId);
	}

	async dispose(solidId: string): Promise<void> {
		this.disposeCalls.push(solidId);
	}

	/** Resolves the pending promise for `jobId` with `result`. Throws if that job was never sent
	 *  or has already been settled — a misuse bug in the test, not a thing to silently ignore. */
	settle(jobId: JobId, result: KernelResult<MeshPayload>): void {
		const resolve = this.resolvers.get(jobId);
		if (!resolve) throw new Error(`RecordingKernel: no pending call for jobId ${jobId}`);
		this.resolvers.delete(jobId);
		resolve(result);
	}

	private record(req: KernelRequest): Promise<KernelResult<MeshPayload>> {
		this.requests.push(req);
		return new Promise((resolve) => this.resolvers.set(req.jobId, resolve));
	}
}

function meshResult(jobId: JobId): KernelResult<MeshPayload> {
	return {
		ok: true,
		jobId,
		value: {
			positions: new Float32Array([0, 0, 0]),
			normals: new Float32Array([0, 0, 1]),
			indices: new Uint32Array([0, 0, 0]),
			triangleCount: 1
		}
	};
}

const boxParams = { width: 1, depth: 1, height: 1 };

/** Real macrotask yield — unconditionally drains the microtask queue (however many `.then` hops
 *  `KernelClient`'s connect → dispatch → settle chain takes) before a timer fires, so tests never
 *  have to hand-count promise chain depth. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeClient(kernel: RecordingKernel, clock: ManualClock, debounceMs = 60) {
	return new KernelClient({
		connect: async () => kernel,
		scheduler: clock,
		debounceMs
	});
}

describe('KernelClient debounce coalescing', () => {
	it('sends only the most recent request once the debounce window elapses', async () => {
		const kernel = new RecordingKernel();
		const clock = new ManualClock();
		const client = makeClient(kernel, clock);

		client.request({ type: 'box', solidId: 's1', params: { width: 1, depth: 1, height: 1 } });
		clock.advance(30);
		client.request({ type: 'box', solidId: 's1', params: { width: 2, depth: 2, height: 2 } });
		clock.advance(30); // 60ms since the first request, but only 30ms since the second

		await flush();
		expect(kernel.requests).toHaveLength(0);

		clock.advance(30); // now 60ms since the second request
		await flush();

		expect(kernel.requests).toHaveLength(1);
		expect(kernel.requests[0]).toMatchObject({
			type: 'box',
			params: { width: 2, depth: 2, height: 2 }
		});
	});

	it('counts the coalesced-away request as dropped', async () => {
		const kernel = new RecordingKernel();
		const clock = new ManualClock();
		const client = makeClient(kernel, clock);

		client.request({ type: 'box', solidId: 's1', params: boxParams });
		client.request({ type: 'box', solidId: 's1', params: boxParams });

		expect(client.stats.dropped).toBe(1);
	});
});

describe('KernelClient keep-latest conflation', () => {
	it('sends the newest params once the in-flight job settles, skipping any in between', async () => {
		const kernel = new RecordingKernel();
		const clock = new ManualClock();
		const client = makeClient(kernel, clock);

		client.request({ type: 'box', solidId: 's1', params: { width: 1, depth: 1, height: 1 } });
		clock.advance(60);
		await flush();
		expect(kernel.requests).toHaveLength(1);
		const firstJobId = kernel.requests[0].jobId;

		// Two more updates arrive while the first is still in flight — only the second's params
		// should ever reach the kernel.
		client.request({ type: 'box', solidId: 's1', params: { width: 2, depth: 2, height: 2 } });
		clock.advance(60);
		await flush();
		client.request({ type: 'box', solidId: 's1', params: { width: 3, depth: 3, height: 3 } });
		clock.advance(60);
		await flush();

		expect(kernel.requests).toHaveLength(1); // still just the first — nothing sent while busy

		kernel.settle(firstJobId, meshResult(firstJobId));
		await flush();

		expect(kernel.requests).toHaveLength(2);
		expect(kernel.requests[1]).toMatchObject({ params: { width: 3, depth: 3, height: 3 } });
	});

	it('sends exactly one cancel() for the in-flight job, however many times it is superseded', async () => {
		const kernel = new RecordingKernel();
		const clock = new ManualClock();
		const client = makeClient(kernel, clock);

		client.request({ type: 'box', solidId: 's1', params: boxParams });
		clock.advance(60);
		await flush();
		const firstJobId = kernel.requests[0].jobId;

		client.request({ type: 'box', solidId: 's1', params: boxParams });
		clock.advance(60);
		await flush();
		client.request({ type: 'box', solidId: 's1', params: boxParams });
		clock.advance(60);
		await flush();

		expect(kernel.cancelCalls).toEqual([firstJobId]);
	});
});

describe('KernelClient stale-drop', () => {
	it('drops a superseded job’s result even when it resolves ok, and still delivers the pending one', async () => {
		const kernel = new RecordingKernel();
		const clock = new ManualClock();
		const client = makeClient(kernel, clock);

		const meshes: MeshPayload[] = [];
		client.onMesh((_solidId, payload) => meshes.push(payload));

		client.request({ type: 'box', solidId: 's1', params: { width: 1, depth: 1, height: 1 } });
		clock.advance(60);
		await flush();
		const firstJobId = kernel.requests[0].jobId;

		client.request({ type: 'box', solidId: 's1', params: { width: 2, depth: 2, height: 2 } });
		clock.advance(60);
		await flush();
		expect(kernel.cancelCalls).toEqual([firstJobId]);

		// The worker's cancel() arrived too late (job already inside the synchronous mesh() call in
		// the real worker) — it finishes anyway and resolves successfully with the stale jobId.
		kernel.settle(firstJobId, meshResult(firstJobId));
		await flush();

		expect(meshes).toHaveLength(0); // the stale result never became a mesh

		expect(kernel.requests).toHaveLength(2);
		const secondJobId = kernel.requests[1].jobId;
		kernel.settle(secondJobId, meshResult(secondJobId));
		await flush();

		expect(meshes).toHaveLength(1); // the superseding request's result does surface
	});
});

describe('KernelClient per-solid isolation', () => {
	it('debounces and conflates each solid independently', async () => {
		const kernel = new RecordingKernel();
		const clock = new ManualClock();
		const client = makeClient(kernel, clock);

		client.request({ type: 'box', solidId: 's1', params: boxParams });
		client.request({ type: 'cylinder', solidId: 's2', params: { radius: 1, height: 1 } });
		clock.advance(60);
		await flush();

		expect(kernel.requests).toHaveLength(2);
		expect(kernel.requests.map((r) => r.solidId).sort()).toEqual(['s1', 's2']);
	});

	it('cancelling one solid’s in-flight job never cancels another solid’s', async () => {
		const kernel = new RecordingKernel();
		const clock = new ManualClock();
		const client = makeClient(kernel, clock);

		client.request({ type: 'box', solidId: 's1', params: boxParams });
		client.request({ type: 'cylinder', solidId: 's2', params: { radius: 1, height: 1 } });
		clock.advance(60);
		await flush();

		client.request({ type: 'box', solidId: 's1', params: { width: 9, depth: 9, height: 9 } });
		clock.advance(60);
		await flush();

		const s1JobId = kernel.requests.find((r) => r.solidId === 's1')!.jobId;
		expect(kernel.cancelCalls).toEqual([s1JobId]);
	});
});

describe('KernelClient error surfacing', () => {
	it('surfaces a non-cancelled error via onError without throwing', async () => {
		const kernel = new RecordingKernel();
		const clock = new ManualClock();
		const client = makeClient(kernel, clock);

		const errors: KernelError[] = [];
		client.onError((error) => errors.push(error));

		client.request({ type: 'box', solidId: 's1', params: { width: -1, depth: 1, height: 1 } });
		clock.advance(60);
		await flush();
		const jobId = kernel.requests[0].jobId;

		expect(() => {
			kernel.settle(jobId, {
				ok: false,
				jobId,
				error: { code: 'invalid-params', message: 'bad width' }
			});
		}).not.toThrow();
		await flush();

		expect(errors).toEqual([{ code: 'invalid-params', message: 'bad width' }]);
	});

	it('does not surface a cancelled error as onError', async () => {
		const kernel = new RecordingKernel();
		const clock = new ManualClock();
		const client = makeClient(kernel, clock);

		const errors: KernelError[] = [];
		client.onError((error) => errors.push(error));

		client.request({ type: 'box', solidId: 's1', params: boxParams });
		clock.advance(60);
		await flush();
		const jobId = kernel.requests[0].jobId;

		kernel.settle(jobId, { ok: false, jobId, error: { code: 'cancelled', message: 'superseded' } });
		await flush();

		expect(errors).toHaveLength(0);
	});
});

describe('KernelClient.stats', () => {
	it('reports inFlight and pending counts live', async () => {
		const kernel = new RecordingKernel();
		const clock = new ManualClock();
		const client = makeClient(kernel, clock);

		client.request({ type: 'box', solidId: 's1', params: boxParams });
		expect(client.stats.pending).toBe(1);
		expect(client.stats.inFlight).toBe(0);

		clock.advance(60);
		await flush();

		expect(client.stats.pending).toBe(0);
		expect(client.stats.inFlight).toBe(1);
		expect(client.stats.sent).toBe(1);
	});
});
