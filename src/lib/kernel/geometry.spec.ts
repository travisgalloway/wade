import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { toBufferGeometry } from './geometry';
import type { MeshPayload } from './types';

/** A unit box centered at the origin, as brepjs's `box()` + `mesh()` would tessellate it (8
 *  vertices, 12 triangles) — enough to assert real attribute counts and a known bounding box
 *  without depending on brepjs/occt-wasm in this Node-only test. */
function unitBoxPayload(): MeshPayload {
	const h = 0.5;
	const corners: [number, number, number][] = [
		[-h, -h, -h],
		[h, -h, -h],
		[h, h, -h],
		[-h, h, -h],
		[-h, -h, h],
		[h, -h, h],
		[h, h, h],
		[-h, h, h]
	];
	const positions = new Float32Array(corners.flat());
	// Flat (unshared) normals would be more correct for a box, but the index/attribute-count/
	// bounding-box assertions below don't depend on which face each vertex's normal points along.
	const normals = new Float32Array(corners.flatMap(() => [0, 0, 1]));
	const indices = new Uint32Array([
		0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7,
		4, 3, 4, 0
	]);

	return { positions, normals, indices, triangleCount: indices.length / 3 };
}

describe('toBufferGeometry', () => {
	it('produces an indexed geometry (issue #48 invariant, carried into the kernel path)', () => {
		const geometry = toBufferGeometry(unitBoxPayload());
		expect(geometry.index).not.toBeNull();
	});

	it('carries position and normal attributes with the payload vertex count', () => {
		const geometry = toBufferGeometry(unitBoxPayload());

		expect(geometry.attributes.position).toBeDefined();
		expect(geometry.attributes.position.count).toBe(8);
		expect(geometry.attributes.normal).toBeDefined();
		expect(geometry.attributes.normal.count).toBe(8);
	});

	it('has an index matching the payload triangle count', () => {
		const payload = unitBoxPayload();
		const geometry = toBufferGeometry(payload);

		expect(geometry.index!.count).toBe(payload.triangleCount * 3);
	});

	it('reports a bounding box matching the known unit-box params', () => {
		const geometry = toBufferGeometry(unitBoxPayload());
		geometry.computeBoundingBox();

		const box = geometry.boundingBox ?? new Box3();
		expect(box.min).toEqual(new Vector3(-0.5, -0.5, -0.5));
		expect(box.max).toEqual(new Vector3(0.5, 0.5, 0.5));
	});
});
