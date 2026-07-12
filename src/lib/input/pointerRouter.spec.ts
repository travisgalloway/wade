import { describe, expect, it } from 'vitest';
import { MOUSE_CLICK_THRESHOLD_PX, PointerRouter, type PointerType } from './pointerRouter';

function down(pointerType: PointerType, pointerId: number, x = 0, y = 0) {
	return { type: 'down' as const, pointerType, pointer: { pointerId, x, y } };
}
function move(pointerType: PointerType, pointerId: number, x: number, y: number) {
	return { type: 'move' as const, pointerType, pointer: { pointerId, x, y } };
}
function up(pointerType: PointerType, pointerId: number) {
	return { type: 'up' as const, pointerType, pointerId };
}
function cancel(pointerType: PointerType, pointerId: number) {
	return { type: 'cancel' as const, pointerType, pointerId };
}

describe('PointerRouter', () => {
	describe('pen', () => {
		it('locks to manipulate immediately on contact', () => {
			const router = new PointerRouter();
			const decision = router.handle(down('pen', 1));
			expect(decision).toEqual({ mode: 'manipulate', locked: true });
		});

		it('never navigates, no matter how far the pen travels', () => {
			const router = new PointerRouter();
			router.handle(down('pen', 1));
			const decision = router.handle(move('pen', 1, 500, 500));
			expect(decision).toEqual({ mode: 'manipulate', locked: true });
		});

		it('stays manipulate through release', () => {
			const router = new PointerRouter();
			router.handle(down('pen', 1));
			router.handle(move('pen', 1, 500, 500));
			const decision = router.handle(up('pen', 1));
			expect(decision).toEqual({ mode: 'manipulate', locked: true });
		});
	});

	describe('touch', () => {
		it('routes a single finger to manipulate (delegated to the gesture arbiter)', () => {
			const router = new PointerRouter();
			router.handle(down('touch', 1));
			const decision = router.handle(move('touch', 1, 10, 10));
			expect(decision).toEqual({ mode: 'manipulate', locked: true });
		});

		it('routes two fingers to navigate (delegated to the gesture arbiter)', () => {
			const router = new PointerRouter();
			router.handle(down('touch', 1));
			router.handle(down('touch', 2));
			const decision = router.handle(move('touch', 1, 10, 10));
			expect(decision).toEqual({ mode: 'navigate', locked: true });
		});

		it('keeps a touch gesture that locked navigate locked through a pointercancel', () => {
			const router = new PointerRouter();
			router.handle(down('touch', 1));
			router.handle(down('touch', 2));
			router.handle(move('touch', 1, 10, 10));
			const decision = router.handle(cancel('touch', 2));
			expect(decision).toEqual({ mode: 'navigate', locked: true });
		});
	});

	describe('mouse', () => {
		it('is undecided on mousedown alone', () => {
			const router = new PointerRouter();
			const decision = router.handle(down('mouse', 1, 100, 100));
			expect(decision).toEqual({ mode: null, locked: false });
		});

		it('stays manipulate (and unlocked) for movement within the click threshold', () => {
			const router = new PointerRouter();
			router.handle(down('mouse', 1, 100, 100));
			const decision = router.handle(move('mouse', 1, 100 + MOUSE_CLICK_THRESHOLD_PX - 1, 100));
			expect(decision).toEqual({ mode: 'manipulate', locked: false });
		});

		it('locks to navigate once movement exceeds the click threshold', () => {
			const router = new PointerRouter();
			router.handle(down('mouse', 1, 100, 100));
			const decision = router.handle(move('mouse', 1, 100 + MOUSE_CLICK_THRESHOLD_PX + 5, 100));
			expect(decision).toEqual({ mode: 'navigate', locked: true });
		});

		it('resolves a plain click (down, up, no significant movement) as manipulate', () => {
			const router = new PointerRouter();
			router.handle(down('mouse', 1, 100, 100));
			const decision = router.handle(up('mouse', 1));
			expect(decision).toEqual({ mode: 'manipulate', locked: true });
		});

		it('does not un-flip navigate back to manipulate after the threshold was crossed and the mouse settles back near the start', () => {
			const router = new PointerRouter();
			router.handle(down('mouse', 1, 100, 100));
			router.handle(move('mouse', 1, 100 + MOUSE_CLICK_THRESHOLD_PX + 20, 100));
			const backNearStart = router.handle(move('mouse', 1, 101, 100));
			expect(backNearStart).toEqual({ mode: 'navigate', locked: true });

			const decision = router.handle(up('mouse', 1));
			expect(decision).toEqual({ mode: 'navigate', locked: true });
		});

		it('tracks independent gestures per pointer id', () => {
			const router = new PointerRouter();
			router.handle(down('mouse', 1, 0, 0));
			router.handle(down('mouse', 2, 500, 500));

			router.handle(move('mouse', 1, 200, 0));
			const decisionForPointer2 = router.handle(move('mouse', 2, 501, 500));
			expect(decisionForPointer2).toEqual({ mode: 'manipulate', locked: false });
		});
	});

	it('never blends channels: a pen gesture and a touch gesture tracked concurrently do not interfere', () => {
		const router = new PointerRouter();
		router.handle(down('touch', 1));
		router.handle(down('touch', 2));
		const touchDecision = router.handle(move('touch', 1, 10, 10));
		expect(touchDecision).toEqual({ mode: 'navigate', locked: true });

		const penDecision = router.handle(down('pen', 3));
		expect(penDecision).toEqual({ mode: 'manipulate', locked: true });
	});
});
