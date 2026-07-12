import { describe, expect, it } from 'vitest';
import { err, meshTransferables, ok, type MeshPayload } from './types';

function makePayload(): MeshPayload {
	return {
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
		indices: new Uint32Array([0, 1, 2]),
		triangleCount: 1
	};
}

describe('meshTransferables', () => {
	it('lists the three distinct buffers backing a mesh payload', () => {
		const payload = makePayload();
		const transferables = meshTransferables(payload);

		expect(transferables).toHaveLength(3);
		expect(transferables).toContain(payload.positions.buffer);
		expect(transferables).toContain(payload.normals.buffer);
		expect(transferables).toContain(payload.indices.buffer);
	});

	it('de-dupes via Set when multiple views share one ArrayBuffer', () => {
		// Three typed-array views over a single backing buffer — the scenario the de-dupe guards
		// against: listing the same buffer three times would make postMessage throw DataCloneError.
		const buffer = new ArrayBuffer(12 * 3);
		const payload: MeshPayload = {
			positions: new Float32Array(buffer, 0, 3),
			normals: new Float32Array(buffer, 12, 3),
			indices: new Uint32Array(buffer, 24, 3),
			triangleCount: 1
		};

		expect(meshTransferables(payload)).toEqual([buffer]);
	});
});

describe('structuredClone transfer (issue #23 acceptance criterion)', () => {
	it('detaches the source buffers and the clone has matching contents', () => {
		const payload = makePayload();
		const positionsBefore = Array.from(payload.positions);

		const clone = structuredClone(payload, { transfer: meshTransferables(payload) });

		expect(payload.positions.buffer.byteLength).toBe(0);
		expect(payload.normals.buffer.byteLength).toBe(0);
		expect(payload.indices.buffer.byteLength).toBe(0);

		expect(Array.from(clone.positions)).toEqual(positionsBefore);
		expect(clone.triangleCount).toBe(1);
	});
});

describe('MessageChannel round trip', () => {
	it('delivers a transferred payload to the other port with detached source buffers', async () => {
		const { port1, port2 } = new MessageChannel();
		const payload = makePayload();

		const received = new Promise<MeshPayload>((resolve) => {
			port2.onmessage = (event: MessageEvent<MeshPayload>) => resolve(event.data);
		});

		port1.postMessage(payload, meshTransferables(payload));
		const result = await received;

		expect(payload.positions.buffer.byteLength).toBe(0);
		expect(result.triangleCount).toBe(1);
		expect(Array.from(result.indices)).toEqual([0, 1, 2]);

		port1.close();
		port2.close();
	});
});

describe('ok/err', () => {
	it('builds a successful result carrying the jobId and value', () => {
		const result = ok('job-1', 42);
		expect(result).toEqual({ ok: true, jobId: 'job-1', value: 42 });
	});

	it('builds a failed result carrying the jobId and error', () => {
		const result = err('job-2', { code: 'invalid-params', message: 'bad width' });
		expect(result).toEqual({
			ok: false,
			jobId: 'job-2',
			error: { code: 'invalid-params', message: 'bad width' }
		});
	});
});
