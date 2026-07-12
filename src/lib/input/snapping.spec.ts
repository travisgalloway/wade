import { describe, expect, it } from 'vitest';
import {
	BufferAttribute,
	BufferGeometry,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	PerspectiveCamera,
	Ray,
	Vector3
} from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import {
	DEFAULT_SNAP_TOLERANCE_PX,
	nearestEdgePoint,
	nearestVertex,
	resolveSnap,
	resolveSnapAtPointer,
	snapToGrid,
	worldRayToLocal,
	type SnapCandidate,
	type SnapKind
} from './snapping';

/** A single right triangle in the Z = 0 plane: a = (0,0,0), b = (4,0,0), c = (0,4,0), with its BVH
 *  built directly (no global prototype patch — see picking.ts's `installBVHAcceleration`, which
 *  this suite deliberately avoids to keep it independent of other spec files' global state). */
function triangleGeometry(): BufferGeometry {
	const geometry = new BufferGeometry();
	// prettier-ignore
	const positions = new Float32Array([
		0, 0, 0,
		4, 0, 0,
		0, 4, 0
	]);
	geometry.setAttribute('position', new BufferAttribute(positions, 3));
	geometry.setIndex([0, 1, 2]);
	geometry.boundsTree = new MeshBVH(geometry);
	return geometry;
}

describe('snapToGrid', () => {
	it('rounds x/z to the nearest grid line and leaves y untouched', () => {
		const snapped = snapToGrid(new Vector3(23, 7, -18), 10);
		expect(snapped.toArray()).toEqual([20, 7, -20]);
	});

	it('rounds up at the midpoint between two grid lines', () => {
		const snapped = snapToGrid(new Vector3(25, 0, 0), 10);
		expect(snapped.x).toBe(30);
	});
});

describe('nearestVertex', () => {
	it('finds the triangle vertex a ray is aimed straight at', () => {
		const geometry = triangleGeometry();
		const ray = new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, -1));

		const hit = nearestVertex(geometry, ray);
		expect(hit).not.toBeNull();
		expect(hit!.point.toArray()).toEqual([0, 0, 0]);
		expect(hit!.distance).toBeCloseTo(0, 10);
	});

	it('finds the closer of two vertices when the ray passes nearer one than the others', () => {
		const geometry = triangleGeometry();
		// Close to vertex b (4,0,0), far from a (0,0,0) and c (0,4,0).
		const ray = new Ray(new Vector3(3.5, 0.2, 10), new Vector3(0, 0, -1));

		const hit = nearestVertex(geometry, ray);
		expect(hit).not.toBeNull();
		expect(hit!.point.toArray()).toEqual([4, 0, 0]);
	});

	it('returns null when the ray misses the geometry entirely', () => {
		const geometry = triangleGeometry();
		const ray = new Ray(new Vector3(100, 100, 10), new Vector3(0, 0, -1));

		expect(nearestVertex(geometry, ray)).toBeNull();
	});

	it('respects maxDistance, excluding every vertex once the tolerance is tight enough', () => {
		const geometry = triangleGeometry();
		const ray = new Ray(new Vector3(1.9, 1.9, 10), new Vector3(0, 0, -1));

		expect(nearestVertex(geometry, ray)).not.toBeNull();
		expect(nearestVertex(geometry, ray, 0.01)).toBeNull();
	});
});

describe('nearestEdgePoint', () => {
	it("finds the closest point on the hit triangle's nearest edge", () => {
		const geometry = triangleGeometry();
		// Aimed just off the midpoint of edge a-b: (0,0,0)-(4,0,0).
		const ray = new Ray(new Vector3(2, 0.1, 10), new Vector3(0, 0, -1));

		const hit = nearestEdgePoint(geometry, ray);
		expect(hit).not.toBeNull();
		expect(hit!.point.x).toBeCloseTo(2, 5);
		expect(hit!.point.y).toBeCloseTo(0, 5);
		expect(hit!.point.z).toBeCloseTo(0, 5);
	});

	it('returns null when the ray misses the geometry entirely', () => {
		const geometry = triangleGeometry();
		const ray = new Ray(new Vector3(100, 100, 10), new Vector3(0, 0, -1));

		expect(nearestEdgePoint(geometry, ray)).toBeNull();
	});

	it('respects maxDistance, excluding the edge once the tolerance is tight enough', () => {
		const geometry = triangleGeometry();
		const ray = new Ray(new Vector3(2, 0.5, 10), new Vector3(0, 0, -1));

		expect(nearestEdgePoint(geometry, ray)).not.toBeNull();
		expect(nearestEdgePoint(geometry, ray, 0.01)).toBeNull();
	});
});

describe('worldRayToLocal', () => {
	it("brings a world-space ray into a translated object's local space", () => {
		const object = new Object3D();
		object.position.set(10, 0, 0);
		object.updateMatrixWorld();

		const worldRay = new Ray(new Vector3(10, 0, 10), new Vector3(0, 0, -1));
		const localRay = worldRayToLocal(worldRay, object);

		expect(localRay.origin.toArray()).toEqual([0, 0, 10]);
		expect(localRay.direction.toArray()).toEqual([0, 0, -1]);
	});
});

describe('resolveSnap', () => {
	function candidate(
		kind: SnapKind,
		screenDistancePx: number,
		point = new Vector3()
	): SnapCandidate {
		return { kind, point, screenDistancePx };
	}

	it('prefers a vertex over a numerically closer edge or grid candidate, within tolerance', () => {
		const candidates = [candidate('grid', 1), candidate('edge', 2), candidate('vertex', 9)];

		expect(resolveSnap(candidates, 10)?.kind).toBe('vertex');
	});

	it('falls back to edge when no vertex is within tolerance', () => {
		const candidates = [candidate('vertex', 50), candidate('edge', 5), candidate('grid', 1)];

		expect(resolveSnap(candidates, 10)?.kind).toBe('edge');
	});

	it('falls back to grid when neither vertex nor edge is within tolerance', () => {
		const candidates = [candidate('vertex', 50), candidate('edge', 40), candidate('grid', 5)];

		expect(resolveSnap(candidates, 10)?.kind).toBe('grid');
	});

	it('returns null when nothing is within tolerance', () => {
		const candidates = [candidate('vertex', 50), candidate('edge', 40), candidate('grid', 30)];

		expect(resolveSnap(candidates, 10)).toBeNull();
	});

	it('picks the closest candidate among same-kind candidates', () => {
		const near = candidate('edge', 3, new Vector3(1, 0, 0));
		const far = candidate('edge', 8, new Vector3(2, 0, 0));

		expect(resolveSnap([far, near], 10)?.point.toArray()).toEqual([1, 0, 0]);
	});

	it('tolerance boundary: exactly at the limit is included, just past it is excluded', () => {
		const atLimit = candidate('grid', 10);
		expect(resolveSnap([atLimit], 10)?.kind).toBe('grid');

		const overLimit = candidate('grid', 10.0001);
		expect(resolveSnap([overLimit], 10)).toBeNull();
	});
});

describe('resolveSnapAtPointer', () => {
	function straightCamera(x: number, y: number, width: number, height: number): PerspectiveCamera {
		const camera = new PerspectiveCamera(50, width / height, 0.1, 1000);
		// No tilt: direction stays (0, 0, -1) regardless of x/y, so the ground plane (Y = 0) is
		// never crossed and a grid candidate can't sneak into a vertex/edge-focused test.
		camera.position.set(x, y, 10);
		camera.lookAt(x, y, 0);
		camera.updateMatrixWorld();
		return camera;
	}

	it('snaps to a vertex when the pointer is aimed straight at it', () => {
		const geometry = triangleGeometry();
		const mesh = new Mesh(geometry, new MeshBasicMaterial());
		mesh.updateMatrixWorld();

		const width = 800;
		const height = 600;
		const camera = straightCamera(0, 0, width, height);

		const result = resolveSnapAtPointer({
			pointer: { x: width / 2, y: height / 2 },
			width,
			height,
			camera,
			meshes: [mesh],
			gridSpacing: 10,
			tolerancePx: DEFAULT_SNAP_TOLERANCE_PX
		});

		expect(result?.kind).toBe('vertex');
		expect(result?.point.toArray()).toEqual([0, 0, 0]);
	});

	it('snaps to an edge point when the pointer is near an edge but not a vertex', () => {
		const geometry = triangleGeometry();
		const mesh = new Mesh(geometry, new MeshBasicMaterial());
		mesh.updateMatrixWorld();

		const width = 800;
		const height = 600;
		// Aim at (2, 0.05, 0): near the midpoint of edge a-b, far from all three vertices.
		const camera = straightCamera(2, 0.05, width, height);

		const result = resolveSnapAtPointer({
			pointer: { x: width / 2, y: height / 2 },
			width,
			height,
			camera,
			meshes: [mesh],
			gridSpacing: 10,
			tolerancePx: DEFAULT_SNAP_TOLERANCE_PX
		});

		expect(result?.kind).toBe('edge');
	});

	it('snaps to the grid when no mesh is nearby', () => {
		const width = 800;
		const height = 600;
		const camera = new PerspectiveCamera(50, width / height, 0.1, 1000);
		camera.position.set(0, 10, 10);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();

		const result = resolveSnapAtPointer({
			pointer: { x: width / 2, y: height / 2 },
			width,
			height,
			camera,
			meshes: [],
			gridSpacing: 10,
			tolerancePx: DEFAULT_SNAP_TOLERANCE_PX
		});

		expect(result?.kind).toBe('grid');
		expect(result?.point.y).toBe(0);
		expect(result!.point.x % 10).toBeCloseTo(0, 10);
		expect(result!.point.z % 10).toBeCloseTo(0, 10);
	});

	it('returns null when nothing is within tolerance', () => {
		const result = resolveSnapAtPointer({
			pointer: { x: 400, y: 300 },
			width: 800,
			height: 600,
			camera: straightCamera(1000, 1000, 800, 600),
			meshes: [],
			gridSpacing: 10,
			tolerancePx: 1
		});

		expect(result).toBeNull();
	});
});
