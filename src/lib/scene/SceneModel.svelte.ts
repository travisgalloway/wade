// Lightweight selection/hover view-model. Per invariant 3, this is a view model only — it holds
// *references* to the (imperative, non-reactive) three.js objects that are hovered/selected, never
// geometry or per-frame state. `$state` requires the `.svelte.ts` suffix (see settings.svelte.ts),
// which is why this isn't plain `SceneModel.ts`.
//
// A hover/selection change is a transient interaction, which architecture issue #1 explicitly
// names as a legal `invalidate()` trigger — so every setter that actually changes the value calls
// it. The reverse also matters for invariant 2: hover fires on every `pointermove`, so a setter
// that invalidated unconditionally would reintroduce a continuous render loop under the mouse.
// Each setter is therefore a no-op (no state write, no invalidate) when the incoming value is
// already current.
import type { Object3D } from 'three';
import { invalidateFor } from '$lib/viewport/renderLoop';

export interface SceneModel {
	readonly hovered: Object3D | null;
	readonly selected: Object3D | null;
	setHovered(object: Object3D | null): void;
	setSelected(object: Object3D | null): void;
}

export function createSceneModel(invalidate: () => void): SceneModel {
	let hovered = $state.raw<Object3D | null>(null);
	let selected = $state.raw<Object3D | null>(null);

	return {
		get hovered() {
			return hovered;
		},
		get selected() {
			return selected;
		},
		setHovered(object: Object3D | null) {
			if (object === hovered) return;
			hovered = object;
			invalidateFor(invalidate, 'interaction');
		},
		setSelected(object: Object3D | null) {
			if (object === selected) return;
			selected = object;
			invalidateFor(invalidate, 'interaction');
		}
	};
}
