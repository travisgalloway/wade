// Pure vertex/edge/grid snapping — no DOM, no Threlte (issue #27). This is the foundation Phase 4's
// constraint inference and widget-less transforms build on, and it is what makes architecture
// invariant 9 ("precision comes from snapping and typed values, not steady fingers") a real,
// testable mechanism instead of a design aspiration. Everything below is plain functions over
// `three`'s math types, in the style of picking.ts and gestureArbiter.ts, so it unit-tests in the
// Node-only Vitest project with no shims.
//
// The design mirrors how picking already works (picking.ts): a ray localizes a hit *triangle* via
// the mesh's existing BVH (three-mesh-bvh — already required to be built on every pickable geometry
// before it's pickable, see `buildBoundsTree`), and only that triangle's 3 vertices and 3 edges are
// considered as snap candidates. That keeps the search O(1) per pointer move instead of scanning
// every vertex in the scene, and it matches the intuitive behavior of "snap to whatever's under the
// cursor" rather than to a vertex on the far side of the model that happens to be within pixel
// tolerance of the screen point.
//
// Priority is vertex > edge > grid: `resolveSnap` never lets a numerically-closer lower-priority
// candidate win over a higher-priority one that is still within tolerance — a vertex is the more
// semantically precise target, and that precedence is what makes the snap indicator predictable
// instead of jittering between kinds as the pointer wobbles by a pixel.
import {
	Mesh,
	Plane,
	Ray,
	Raycaster,
	Vector3,
	type BufferGeometry,
	type Camera,
	type Object3D
} from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { toNDC, toScreen } from '$lib/viewport/picking';

/** What a resolved snap locked onto — carried alongside the point so UI can show *why* it snapped
 *  (different marker color/shape per kind), which is what makes invariant 9 usable rather than
 *  magic: the user sees precision being applied, not a mysteriously-adjusted position. */
export type SnapKind = 'vertex' | 'edge' | 'grid';

/** A resolved snap: the kind that won and the world-space point to snap to. */
export interface SnapResult {
	kind: SnapKind;
	point: Vector3;
}

/** A candidate before priority/tolerance is applied — the point plus how far it is from the
 *  pointer on screen, in CSS pixels. */
export interface SnapCandidate {
	kind: SnapKind;
	point: Vector3;
	screenDistancePx: number;
}

/** Grid spacing in scene units. Matches the granularity of the kernel scene's box/cylinder param
 *  ranges (see params.svelte.ts's BOX_LIMITS/CYLINDER_LIMITS), so a grid-snapped placement lines up
 *  with values a slider would actually produce. */
export const DEFAULT_GRID_SPACING = 10;

/** Screen-space snap radius, in CSS pixels. Deliberately generous (touch/pen-sized, invariant 9's
 *  "no dependence on tiny handles") rather than a mouse-precision few pixels. */
export const DEFAULT_SNAP_TOLERANCE_PX = 20;

/**
 * Grid snap: quantizes `point`'s X/Z to the nearest multiple of `spacing`, leaving Y untouched.
 * The ground grid is the XZ plane (Y = 0), matching three.js's Y-up convention and where the
 * kernel scene's solids already sit (Scene.svelte positions both at y = 0) — but this function
 * itself makes no assumption about Y being zero, so it composes with a point already projected
 * onto any horizontal plane.
 */
export function snapToGrid(point: Vector3, spacing: number): Vector3 {
	return new Vector3(
		Math.round(point.x / spacing) * spacing,
		point.y,
		Math.round(point.z / spacing) * spacing
	);
}

/** A vertex snap candidate in the same space as the `ray`/`geometry` passed to `nearestVertex`. */
export interface VertexHit {
	point: Vector3;
	distance: number;
}

/** An edge-point snap candidate in the same space as the `ray`/`geometry` passed to
 *  `nearestEdgePoint`. */
export interface EdgeHit {
	point: Vector3;
	distance: number;
}

/**
 * Finds the snap-worthy vertex nearest to `ray`, restricted to the single triangle the ray hits
 * first via the geometry's BVH (see the module docstring for why). `ray` and the returned point are
 * in the geometry's own local space — a caller with a transformed mesh must convert both directions
 * itself (see `worldRayToLocal`). Returns `null` when the ray misses the geometry entirely, the
 * geometry has no BVH built yet, or every vertex of the hit triangle is further than `maxDistance`
 * from the ray.
 */
export function nearestVertex(
	geometry: BufferGeometry,
	ray: Ray,
	maxDistance = Number.POSITIVE_INFINITY
): VertexHit | null {
	const bvh = geometry.boundsTree;
	const position = geometry.getAttribute('position');
	if (!(bvh instanceof MeshBVH) || !position) return null;

	const hit = bvh.raycastFirst(ray);
	if (!hit?.face) return null;

	const vertex = new Vector3();
	const closestOnRay = new Vector3();
	let best: VertexHit | null = null;

	for (const index of [hit.face.a, hit.face.b, hit.face.c]) {
		vertex.fromBufferAttribute(position, index);
		ray.closestPointToPoint(vertex, closestOnRay);
		const distance = closestOnRay.distanceTo(vertex);
		if (distance > maxDistance) continue;
		if (!best || distance < best.distance) best = { point: vertex.clone(), distance };
	}

	return best;
}

/**
 * Finds the point on the hit triangle's nearest edge to `ray` (same hit-triangle restriction and
 * local-space contract as `nearestVertex`). Uses `Ray.distanceSqToSegment`, three.js's own
 * closest-point-between-a-ray-and-a-segment routine, rather than hand-rolled skew-line math.
 */
export function nearestEdgePoint(
	geometry: BufferGeometry,
	ray: Ray,
	maxDistance = Number.POSITIVE_INFINITY
): EdgeHit | null {
	const bvh = geometry.boundsTree;
	const position = geometry.getAttribute('position');
	if (!(bvh instanceof MeshBVH) || !position) return null;

	const hit = bvh.raycastFirst(ray);
	if (!hit?.face) return null;

	const a = new Vector3().fromBufferAttribute(position, hit.face.a);
	const b = new Vector3().fromBufferAttribute(position, hit.face.b);
	const c = new Vector3().fromBufferAttribute(position, hit.face.c);
	const edges: Array<[Vector3, Vector3]> = [
		[a, b],
		[b, c],
		[c, a]
	];

	const closest = new Vector3();
	let best: EdgeHit | null = null;

	for (const [start, end] of edges) {
		const distance = Math.sqrt(ray.distanceSqToSegment(start, end, undefined, closest));
		if (distance > maxDistance) continue;
		if (!best || distance < best.distance) best = { point: closest.clone(), distance };
	}

	return best;
}

/**
 * Brings a world-space ray into `object`'s local space, so its geometry's BVH — built in local
 * space, unaware of any world transform — can be queried directly by `nearestVertex`/
 * `nearestEdgePoint`. Mirrors what three.js's own accelerated `Mesh.raycast` does internally.
 * Requires `object.matrixWorld` to be current (Threlte updates the scene graph before every render,
 * so this holds for any object that has rendered at least one frame).
 */
export function worldRayToLocal(ray: Ray, object: Object3D): Ray {
	const inverse = object.matrixWorld.clone().invert();
	return ray.clone().applyMatrix4(inverse);
}

/** Euclidean distance between two CSS-pixel screen points. */
export function pixelDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

const SNAP_PRIORITY: readonly SnapKind[] = ['vertex', 'edge', 'grid'];

/**
 * Picks the winning snap candidate: among candidates within `tolerancePx`, the closest one of the
 * highest-priority kind present (vertex > edge > grid). A numerically closer lower-priority
 * candidate never wins over a higher-priority one still inside tolerance — see the module
 * docstring for why that's intended, not a bug. Returns `null` when nothing is within tolerance.
 */
export function resolveSnap(candidates: SnapCandidate[], tolerancePx: number): SnapResult | null {
	for (const kind of SNAP_PRIORITY) {
		let best: SnapCandidate | null = null;
		for (const candidate of candidates) {
			if (candidate.kind !== kind) continue;
			if (candidate.screenDistancePx > tolerancePx) continue;
			if (!best || candidate.screenDistancePx < best.screenDistancePx) best = candidate;
		}
		if (best) return { kind: best.kind, point: best.point.clone() };
	}
	return null;
}

/** The ground grid lives on the XZ plane (Y = 0) — three.js's Y-up convention, and where the
 *  kernel scene's solids already sit (Scene.svelte positions both at y = 0). */
const GROUND_PLANE = new Plane(new Vector3(0, 1, 0), 0);

export interface SnapPointerQuery {
	/** Pointer position in CSS pixels, relative to the canvas. */
	pointer: { x: number; y: number };
	/** Canvas size in CSS pixels (not device pixels). */
	width: number;
	height: number;
	camera: Camera;
	/** Candidate meshes for vertex/edge snapping — typically the scene's pickable objects. */
	meshes: Mesh[];
	gridSpacing: number;
	tolerancePx: number;
}

/**
 * The full pointer-driven snap resolution, and the one function the viewport calls from its
 * pointermove handler. Raycasts from `pointer` through `camera`, gathers a vertex and an edge
 * candidate per mesh (each in that mesh's local space via `worldRayToLocal`, converted back to
 * world space for the result) plus one grid candidate off the ground plane, scores every candidate
 * by its on-screen pixel distance from the pointer, and returns whichever `resolveSnap` picks.
 */
export function resolveSnapAtPointer(query: SnapPointerQuery): SnapResult | null {
	const ndc = toNDC(query.pointer.x, query.pointer.y, query.width, query.height);
	const raycaster = new Raycaster();
	raycaster.setFromCamera(ndc, query.camera);

	const candidates: SnapCandidate[] = [];

	const addCandidate = (kind: SnapKind, point: Vector3) => {
		const screen = toScreen(point, query.camera, query.width, query.height);
		if (!screen) return;
		candidates.push({ kind, point, screenDistancePx: pixelDistance(screen, query.pointer) });
	};

	for (const mesh of query.meshes) {
		const localRay = worldRayToLocal(raycaster.ray, mesh);

		const vertexHit = nearestVertex(mesh.geometry, localRay);
		if (vertexHit) addCandidate('vertex', mesh.localToWorld(vertexHit.point.clone()));

		const edgeHit = nearestEdgePoint(mesh.geometry, localRay);
		if (edgeHit) addCandidate('edge', mesh.localToWorld(edgeHit.point.clone()));
	}

	const groundPoint = raycaster.ray.intersectPlane(GROUND_PLANE, new Vector3());
	if (groundPoint) addCandidate('grid', snapToGrid(groundPoint, query.gridSpacing));

	return resolveSnap(candidates, query.tolerancePx);
}
