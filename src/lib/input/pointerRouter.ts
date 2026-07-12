// Pure/unit-testable branch on Pointer Events' `pointerType`. Takes plain pointer-ish data (not
// real PointerEvents), same as gestureArbiter.ts, so it unit-tests in the node Vitest project.
//
// `touch-action: none` is already set on the canvas by Viewport.svelte (issue #12/#13's PR) — this
// module is what actually routes the events that style makes deliverable to the app instead of the
// browser's native scroll/zoom gestures.
//
// Per invariant 8, each `pointerType` gets its own never-overlapping channel:
//   - `pen` is always the precise create/edit channel — it locks to `manipulate` on first contact
//     and never navigates, regardless of how far it moves. (A gizmo drag with a pen is still an
//     edit, not an orbit.)
//   - `touch` is navigation-capable: a single finger selects/manipulates, multiple fingers drive
//     the camera. That distinction is exactly what `GestureArbiter` already computes from pointer
//     counts, so touch events are simply forwarded to a dedicated arbiter instance per router.
//   - `mouse` is the desktop path: three.js `OrbitControls` already drives navigate natively on any
//     mouse-button drag (see Scene.svelte), so this router's only job for mouse is telling the
//     caller whether a given mouse gesture ended up being a plain click (negligible movement) —
//     that's the `manipulate`/select case OrbitControls itself has no notion of.
import {
	GestureArbiter,
	type ArbiterPointer,
	type GestureDecision,
	type GestureMode
} from './gestureArbiter';

export type PointerType = 'mouse' | 'pen' | 'touch';

export type RouterEvent =
	| { type: 'down'; pointerType: PointerType; pointer: ArbiterPointer }
	| { type: 'move'; pointerType: PointerType; pointer: ArbiterPointer }
	| { type: 'up'; pointerType: PointerType; pointerId: number }
	| { type: 'cancel'; pointerType: PointerType; pointerId: number };

/** How far (in CSS pixels) a mouse pointer may drift and still count as a click, not a drag. */
export const MOUSE_CLICK_THRESHOLD_PX = 6;

interface MouseGestureState {
	start: { x: number; y: number };
	draggedPastThreshold: boolean;
}

const UNDECIDED: GestureDecision = { mode: null, locked: false };

export class PointerRouter {
	private readonly touchArbiter = new GestureArbiter();
	private readonly mouseGestures = new Map<number, MouseGestureState>();

	handle(event: RouterEvent): GestureDecision {
		switch (event.pointerType) {
			case 'pen':
				return this.handlePen();
			case 'touch':
				return this.handleTouch(event);
			case 'mouse':
				return this.handleMouse(event);
		}
	}

	/** Pen: always the precise create/edit channel. Locked to `manipulate` from first contact,
	 *  through every subsequent move/up/cancel — pen never has a navigate branch to guard against. */
	private handlePen(): GestureDecision {
		return { mode: 'manipulate', locked: true };
	}

	/** Touch: delegate entirely to the shared arbiter, which resolves single- vs multi-finger. */
	private handleTouch(event: RouterEvent): GestureDecision {
		switch (event.type) {
			case 'down':
				return this.touchArbiter.handle({ type: 'down', pointer: event.pointer });
			case 'move':
				return this.touchArbiter.handle({ type: 'move', pointer: event.pointer });
			case 'up':
				return this.touchArbiter.handle({ type: 'up', pointerId: event.pointerId });
			case 'cancel':
				return this.touchArbiter.handle({ type: 'cancel', pointerId: event.pointerId });
		}
	}

	/**
	 * Mouse: OrbitControls already drives camera navigation natively on a drag, so this only
	 * tracks whether the gesture stayed within the click threshold — the case OrbitControls has no
	 * concept of, and the one the caller needs in order to run a selection pick on release.
	 */
	private handleMouse(event: RouterEvent): GestureDecision {
		if (event.type === 'down') {
			this.mouseGestures.set(event.pointer.pointerId, {
				start: { x: event.pointer.x, y: event.pointer.y },
				draggedPastThreshold: false
			});
			return UNDECIDED;
		}

		if (event.type === 'move') {
			const state = this.mouseGestures.get(event.pointer.pointerId);
			if (!state) return UNDECIDED;

			const dx = event.pointer.x - state.start.x;
			const dy = event.pointer.y - state.start.y;
			if (Math.hypot(dx, dy) > MOUSE_CLICK_THRESHOLD_PX) {
				state.draggedPastThreshold = true;
			}
			const mode: GestureMode = state.draggedPastThreshold ? 'navigate' : 'manipulate';
			return { mode, locked: state.draggedPastThreshold };
		}

		// 'up' | 'cancel'
		const state = this.mouseGestures.get(event.pointerId);
		this.mouseGestures.delete(event.pointerId);
		if (!state) return UNDECIDED;

		const mode: GestureMode = state.draggedPastThreshold ? 'navigate' : 'manipulate';
		return { mode, locked: true };
	}
}
