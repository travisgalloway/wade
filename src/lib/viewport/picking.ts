// three-mesh-bvh hover + click selection. CPU-side and renderer-agnostic — raycasting against a
// BVH is plain geometry math, unaffected by whether the active backend is WebGPU or the WebGL2
// fallback (invariant 5 is a renderer concern; this module doesn't care).
import { BufferGeometry, Mesh, Raycaster, Vector2, type Camera, type Object3D } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

let installed = false;

/**
 * Installs `three-mesh-bvh`'s bounds-tree computation and accelerated raycast onto the shared
 * `BufferGeometry`/`Mesh` prototypes. Idempotent and side-effecting by nature (it patches global
 * prototypes), so it's a one-time call — do it once at app start, not per component mount.
 */
export function installBVHAcceleration(): void {
	if (installed) return;
	installed = true;

	BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
	BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
	Mesh.prototype.raycast = acceleratedRaycast;
}

/** Builds (or rebuilds) the BVH for a geometry so raycasts against it use the accelerated path. */
export function buildBoundsTree(geometry: BufferGeometry): void {
	geometry.computeBoundsTree();
}

export type PointerKind = 'mouse' | 'pen' | 'touch';

export interface ScreenPoint {
	/** CSS pixels, relative to the canvas's top-left corner. */
	x: number;
	y: number;
	pointerKind: PointerKind;
}

/**
 * Pixels the pick ray is lifted above a touch/pen contact point, so a fingertip or stylus tip
 * never occludes the very thing it's trying to select ("beat occlusion" — architecture issue #1).
 * Mouse pointers already sit above the surface (no finger/stylus to occlude anything), so they
 * get no offset — the cursor tip itself is the intended pick point.
 */
export const OCCLUSION_OFFSET_PX = 40;

/** Applies the beat-occlusion offset for touch/pen; passes mouse points through unchanged. */
export function offsetPickPoint(point: ScreenPoint): { x: number; y: number } {
	if (point.pointerKind === 'mouse') return { x: point.x, y: point.y };
	return { x: point.x, y: point.y - OCCLUSION_OFFSET_PX };
}

/** Converts a CSS-pixel canvas coordinate to normalized device coordinates for `Raycaster`. */
export function toNDC(x: number, y: number, width: number, height: number): Vector2 {
	return new Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1);
}

export interface PickParams {
	/** Pointer position in CSS pixels, relative to the canvas. */
	x: number;
	y: number;
	pointerKind: PointerKind;
	/** Canvas size in CSS pixels (not device pixels). */
	width: number;
	height: number;
	camera: Camera;
	/** Candidate objects to test, e.g. the scene's pickable meshes. */
	objects: Object3D[];
}

/**
 * BVH-accelerated hover/click picking. A single `Raycaster` is reused across calls (raycasting is
 * a per-call operation with no meaningful state to retain between picks).
 */
export class Picker {
	private readonly raycaster = new Raycaster();

	pick(params: PickParams): Object3D | null {
		const offset = offsetPickPoint({ x: params.x, y: params.y, pointerKind: params.pointerKind });
		const ndc = toNDC(offset.x, offset.y, params.width, params.height);

		this.raycaster.setFromCamera(ndc, params.camera);
		const hits = this.raycaster.intersectObjects(params.objects, false);
		return hits[0]?.object ?? null;
	}
}
