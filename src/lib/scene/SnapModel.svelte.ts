// View-model for the live snap indicator (issue #27, invariant 9: "precision comes from snapping
// and typed values, not steady fingers"). Same shape as SceneModel.svelte.ts: holds only the
// current resolved SnapResult (or null) and invalidates only when it actually changes. A snap
// change is a transient interaction (a legal invalidate() trigger per architecture issue #1), and
// the reverse matters just as much for invariant 2: pointermove fires continuously while the
// pointer is over the canvas, so a setter that invalidated unconditionally — even when the same
// vertex/edge/grid point is re-resolved on every move — would reintroduce a continuous render loop
// under the pointer. `setSnap` is therefore a no-op (no state write, no invalidate) whenever the
// incoming result is the same kind and point as the current one.
import type { SnapResult } from '$lib/input/snapping';
import { invalidateFor } from '$lib/viewport/renderLoop';

export interface SnapModel {
	readonly current: SnapResult | null;
	setSnap(result: SnapResult | null): void;
}

function sameSnap(a: SnapResult | null, b: SnapResult | null): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	return a.kind === b.kind && a.point.equals(b.point);
}

export function createSnapModel(invalidate: () => void): SnapModel {
	let current = $state.raw<SnapResult | null>(null);

	return {
		get current() {
			return current;
		},
		setSnap(result) {
			if (sameSnap(current, result)) return;
			current = result;
			invalidateFor(invalidate, 'interaction');
		}
	};
}
