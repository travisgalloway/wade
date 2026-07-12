// The invalidate broker + render-call instrumentation. Not a loop: this file contains no
// `requestAnimationFrame`, no `setAnimationLoop`, and no `renderMode="always"`. Threlte's own
// scheduler ticks internally, but it only issues a GPU draw when the frame has been invalidated
// (see `renderMode="on-demand"` in Viewport.svelte) — this module is what feeds it those
// invalidations, and what makes the on-demand behavior observable from the outside.
import type { Camera, Object3D, WebGLRenderer } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

// Matches the union Threlte itself uses internally (@threlte/core does not re-export this type).
type Renderer = WebGLRenderer | WebGPURenderer;

declare global {
	interface Window {
		__wade?: { renderCount: number };
	}
}

/**
 * Wraps `renderer.render` to count actual GPU draw calls and expose the count as
 * `window.__wade.renderCount`. This is the mechanism issue #13's acceptance criterion
 * ("confirmed by logging render calls") and issue #21 both require, and what the Playwright
 * smoke test asserts against — it must only advance on interaction, never while idle.
 */
export function instrumentRenderer(renderer: Renderer): void {
	let renderCount = 0;
	window.__wade = { renderCount };

	const originalRender = renderer.render.bind(renderer);
	renderer.render = (scene: Object3D, camera: Camera) => {
		renderCount += 1;
		window.__wade!.renderCount = renderCount;
		if (import.meta.env.DEV) {
			console.debug(`[wade] render #${renderCount}`);
		}
		originalRender(scene, camera);
	};
}

/** The only legal reasons to call Threlte's `invalidate()` — see architecture invariant 2. */
export type InvalidateReason = 'camera' | 'resize' | 'model' | 'interaction';

/**
 * Thin, self-documenting wrapper around Threlte's `invalidate()` so every call site names the
 * legal trigger it represents (camera change, resize, model swap, or an active transient
 * interaction) and logs it in dev. Resize and camera-drag invalidation already happen inside
 * Threlte/`<OrbitControls>` itself; call sites in this app use this for the rest — e.g. a model
 * swap once the sample mesh finishes loading.
 */
export function invalidateFor(invalidate: () => void, reason: InvalidateReason): void {
	if (import.meta.env.DEV) {
		console.debug(`[wade] invalidate: ${reason}`);
	}
	invalidate();
}
