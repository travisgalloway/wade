// The parametric document model for the kernel-driven scene (issues #25, #26): the box and
// cylinder parameters the UI edits and that Scene.svelte turns into `KernelClient.request()` calls.
// Two solids — a box and a cylinder, each with its own stable SolidId — rather than one, so that
// #26's "only the changed solid is re-tessellated" is something a slider drag can actually
// demonstrate, instead of being vacuously true with a single solid in the scene.
//
// Follows SceneModel.svelte.ts's factory + getters + `$state` convention: this is view-layer
// document state (architecture invariant 3), not scene/render state — no `three` and no
// kernel/comlink import here, which is what keeps the pure clamping logic below importable and
// unit-testable with no DOM (see params.spec.ts). Requires the `.svelte.ts` suffix because
// `createParamsModel` uses `$state`.
import type { BoxParams, CylinderParams, SolidId } from '$lib/kernel/types';

/** Stable across the document's lifetime — created once, re-tessellated many times as sliders
 *  move. Exported so Scene.svelte's kernel requests and its per-solid geometry/BVH bookkeeping
 *  agree on which solid is which. */
export const BOX_SOLID_ID: SolidId = 'box-1';
export const CYLINDER_SOLID_ID: SolidId = 'cylinder-1';

interface Range {
	min: number;
	max: number;
}

/** Kept modest (rather than e.g. 0..1000) so the box and cylinder — offset a fixed distance apart
 *  in Scene.svelte — stay visually separated across the whole slider range. */
export const BOX_LIMITS: Record<keyof BoxParams, Range> = {
	width: { min: 5, max: 90 },
	depth: { min: 5, max: 90 },
	height: { min: 5, max: 90 }
};

export const CYLINDER_LIMITS: Record<keyof CylinderParams, Range> = {
	radius: { min: 5, max: 50 },
	height: { min: 5, max: 90 }
};

const DEFAULT_BOX: BoxParams = { width: 40, depth: 30, height: 20 };
const DEFAULT_CYLINDER: CylinderParams = { radius: 15, height: 40 };

function clamp(value: number, range: Range): number {
	if (Number.isNaN(value)) return range.min;
	return Math.min(range.max, Math.max(range.min, value));
}

/** Pure — clamps a single box param into its declared range. Exported (and unit-tested in
 *  params.spec.ts) so a slider can never send an out-of-range or malformed value to the kernel,
 *  independent of whatever `min`/`max` the `<input type="range">` element itself declares. */
export function clampBoxParam(key: keyof BoxParams, value: number): number {
	return clamp(value, BOX_LIMITS[key]);
}

/** Pure — the cylinder counterpart of {@link clampBoxParam}. */
export function clampCylinderParam(key: keyof CylinderParams, value: number): number {
	return clamp(value, CYLINDER_LIMITS[key]);
}

export interface ParamsModel {
	readonly box: Readonly<BoxParams>;
	readonly cylinder: Readonly<CylinderParams>;
	setBoxParam(key: keyof BoxParams, value: number): void;
	setCylinderParam(key: keyof CylinderParams, value: number): void;
}

/**
 * Builds the params model. Each field is its own `$state` primitive (rather than one `$state`
 * object holding all three/two fields) so that reading `box`/`cylinder` through the getters below
 * — which is exactly what Scene.svelte's per-solid `$effect`s do to build each kernel request —
 * subscribes to every field individually; merely holding a reference to a parent state object
 * would not establish that fine-grained a dependency. The getters also always return a fresh
 * plain object, never a Svelte-proxied value directly, since that plain object is what ends up
 * passed into a `KernelRequest`.
 */
export function createParamsModel(): ParamsModel {
	let boxWidth = $state(DEFAULT_BOX.width);
	let boxDepth = $state(DEFAULT_BOX.depth);
	let boxHeight = $state(DEFAULT_BOX.height);
	let cylinderRadius = $state(DEFAULT_CYLINDER.radius);
	let cylinderHeight = $state(DEFAULT_CYLINDER.height);

	return {
		get box(): BoxParams {
			return { width: boxWidth, depth: boxDepth, height: boxHeight };
		},
		get cylinder(): CylinderParams {
			return { radius: cylinderRadius, height: cylinderHeight };
		},
		setBoxParam(key, value) {
			const clamped = clampBoxParam(key, value);
			if (key === 'width') boxWidth = clamped;
			else if (key === 'depth') boxDepth = clamped;
			else boxHeight = clamped;
		},
		setCylinderParam(key, value) {
			const clamped = clampCylinderParam(key, value);
			if (key === 'radius') cylinderRadius = clamped;
			else cylinderHeight = clamped;
		}
	};
}
