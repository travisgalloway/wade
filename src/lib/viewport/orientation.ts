// The world's up-axis convention, in one place.
//
// This app is **right-handed Z-up**: X = width (right), Y = depth (away from the viewer), Z =
// height (up) — the convention AutoCAD, SketchUp and Blender use. It is deliberately *not*
// three.js's default Y-up.
//
// The reason is the kernel. OCCT (via brepjs) is itself right-handed Z-up: `box(width, depth,
// height)` in kernel.worker.ts lays width along X, depth along Y and height along Z. Matching it
// here means world space **is** kernel space — a mesh comes back from the worker and is mounted
// with no rotation, and a snap point read off the scene can be handed to the kernel as-is. The
// alternative (keeping three.js's Y-up and rotating every mesh at the boundary) would buy a
// smaller diff once and then need a coordinate conversion at every seam, forever.
//
// The cost is that three.js's own defaults assume Y-up, so a handful of things have to be told
// otherwise. They are all listed here so the set is auditable rather than scattered:
//   - `installZUpWorld()` below (`Object3D.DEFAULT_UP`) — the camera, OrbitControls and
//     TransformControls all derive their frame from an object's `up`.
//   - `GridHelper` is authored in the XZ plane, so Scene.svelte rotates it onto XY.
//   - three.js primitives (`CylinderGeometry`) are Y-axis aligned — see instancing.ts.
//   - The Phase 1 STL sample part was authored Y-up — see sampleMesh.ts.
import { Object3D, Vector3 } from 'three';

/** The world's up axis. Read this rather than writing `(0, 0, 1)` inline. */
export const WORLD_UP = new Vector3(0, 0, 1);

/** Normal of the ground plane (Z = 0) — the plane the grid is drawn on and that `snapToGrid`
 *  quantizes across. See snapping.ts. */
export const GROUND_NORMAL = new Vector3(0, 0, 1);

/** Direction from a framing target back to the camera: a 3/4 view from the front-right, above.
 *  "Front" is -Y, since +Y points away from the viewer. Used as `frameBox`'s default direction
 *  (framing.ts) and to seed the camera's initial position (Scene.svelte). */
export const DEFAULT_VIEW_DIRECTION = new Vector3(1, -1, 0.6);

/**
 * Makes +Z the default up axis for every `Object3D` constructed afterwards.
 *
 * Idempotent, and called at module scope (not inside a component) — same one-time-global-patch
 * pattern as `installBVHAcceleration()` in picking.ts. Module scope is what guarantees it runs
 * *before* the camera and controls are constructed: `Object3D.DEFAULT_UP` is copied into each
 * instance's own `up` at construction, so patching it after the camera exists would leave the
 * camera Y-up and the world Z-up, which is worse than either convention on its own.
 *
 * Setting the global default (rather than only `camera.up`) is what keeps OrbitControls and
 * TransformControls in the same frame as the camera — both read `object.up`, not a world constant.
 */
export function installZUpWorld(): void {
	Object3D.DEFAULT_UP.copy(WORLD_UP);
}
