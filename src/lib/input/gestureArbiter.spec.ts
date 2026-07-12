import { describe, expect, it } from 'vitest';
import { GestureArbiter, type ArbiterPointer } from './gestureArbiter';

function p(pointerId: number, x = 0, y = 0): ArbiterPointer {
	return { pointerId, x, y };
}

describe('GestureArbiter', () => {
	it('is undecided before any pointer is down', () => {
		const arbiter = new GestureArbiter();
		expect(arbiter.current()).toEqual({ mode: null, locked: false });
	});

	it('stays undecided while a single pointer is merely down, before it moves', () => {
		const arbiter = new GestureArbiter();
		const decision = arbiter.handle({ type: 'down', pointer: p(1) });
		expect(decision).toEqual({ mode: null, locked: false });
	});

	it('locks to manipulate on the first move of a single pointer', () => {
		const arbiter = new GestureArbiter();
		arbiter.handle({ type: 'down', pointer: p(1) });
		const decision = arbiter.handle({ type: 'move', pointer: p(1, 5, 5) });
		expect(decision).toEqual({ mode: 'manipulate', locked: true });
	});

	it('locks to navigate on the first move once a second pointer has joined', () => {
		const arbiter = new GestureArbiter();
		arbiter.handle({ type: 'down', pointer: p(1) });
		arbiter.handle({ type: 'down', pointer: p(2) });
		const decision = arbiter.handle({ type: 'move', pointer: p(1, 1, 1) });
		expect(decision).toEqual({ mode: 'navigate', locked: true });
	});

	it('resolves a pure single-pointer tap (down, up, no move) as manipulate', () => {
		const arbiter = new GestureArbiter();
		arbiter.handle({ type: 'down', pointer: p(1) });
		const decision = arbiter.handle({ type: 'up', pointerId: 1 });
		expect(decision).toEqual({ mode: 'manipulate', locked: true });
	});

	it('resolves a two-finger tap (both down, released one at a time, no move) as navigate', () => {
		const arbiter = new GestureArbiter();
		arbiter.handle({ type: 'down', pointer: p(1) });
		arbiter.handle({ type: 'down', pointer: p(2) });
		// First finger releases, leaving only one pointer — the *peak* of 2 must still be honored.
		const midRelease = arbiter.handle({ type: 'up', pointerId: 1 });
		expect(midRelease).toEqual({ mode: null, locked: false });
		const finalRelease = arbiter.handle({ type: 'up', pointerId: 2 });
		expect(finalRelease).toEqual({ mode: 'navigate', locked: true });
	});

	it('resets to idle once every pointer of a gesture has released', () => {
		const arbiter = new GestureArbiter();
		arbiter.handle({ type: 'down', pointer: p(1) });
		arbiter.handle({ type: 'up', pointerId: 1 });
		expect(arbiter.current()).toEqual({ mode: null, locked: false });
	});

	describe('the lock', () => {
		it('keeps a gesture that started as an orbit locked to navigate for its whole duration, even after a finger lifts and the remaining single pointer looks like a tap', () => {
			const arbiter = new GestureArbiter();
			arbiter.handle({ type: 'down', pointer: p(1) });
			arbiter.handle({ type: 'down', pointer: p(2) });
			const locked = arbiter.handle({ type: 'move', pointer: p(1, 10, 10) });
			expect(locked).toEqual({ mode: 'navigate', locked: true });

			// Second finger lifts — only one pointer remains, unmoving, which in isolation would
			// look exactly like the start of a tap-to-select.
			const afterLift = arbiter.handle({ type: 'up', pointerId: 2 });
			expect(afterLift).toEqual({ mode: 'navigate', locked: true });

			// The remaining pointer stays still and then releases — must still read as navigate,
			// never reinterpreted as a select tap.
			const finalRelease = arbiter.handle({ type: 'up', pointerId: 1 });
			expect(finalRelease).toEqual({ mode: 'navigate', locked: true });
		});

		it('does not let a second finger arriving mid-gesture flip an already-locked manipulate into navigate', () => {
			const arbiter = new GestureArbiter();
			arbiter.handle({ type: 'down', pointer: p(1) });
			const locked = arbiter.handle({ type: 'move', pointer: p(1, 3, 0) });
			expect(locked).toEqual({ mode: 'manipulate', locked: true });

			// A second finger now joins the already-locked single-pointer gesture.
			const afterSecondDown = arbiter.handle({ type: 'down', pointer: p(2) });
			expect(afterSecondDown).toEqual({ mode: 'manipulate', locked: true });

			const afterSecondMove = arbiter.handle({ type: 'move', pointer: p(2, 50, 50) });
			expect(afterSecondMove).toEqual({ mode: 'manipulate', locked: true });

			arbiter.handle({ type: 'up', pointerId: 2 });
			const finalRelease = arbiter.handle({ type: 'up', pointerId: 1 });
			expect(finalRelease).toEqual({ mode: 'manipulate', locked: true });
		});

		it('does not let a pointer cancel mid-gesture change an already-locked mode', () => {
			const arbiter = new GestureArbiter();
			arbiter.handle({ type: 'down', pointer: p(1) });
			arbiter.handle({ type: 'down', pointer: p(2) });
			arbiter.handle({ type: 'move', pointer: p(1, 4, 4) });

			const afterCancel = arbiter.handle({ type: 'cancel', pointerId: 2 });
			expect(afterCancel).toEqual({ mode: 'navigate', locked: true });
		});
	});

	it('starts a fresh, independent decision for the gesture after a full release', () => {
		const arbiter = new GestureArbiter();

		// First gesture: two-finger orbit.
		arbiter.handle({ type: 'down', pointer: p(1) });
		arbiter.handle({ type: 'down', pointer: p(2) });
		arbiter.handle({ type: 'move', pointer: p(1, 20, 20) });
		arbiter.handle({ type: 'up', pointerId: 1 });
		arbiter.handle({ type: 'up', pointerId: 2 });

		// Second, unrelated gesture: a single-finger tap. Must not inherit the prior navigate lock.
		arbiter.handle({ type: 'down', pointer: p(3) });
		const decision = arbiter.handle({ type: 'up', pointerId: 3 });
		expect(decision).toEqual({ mode: 'manipulate', locked: true });
	});

	it('ignores a move from a pointer id that was never pressed down', () => {
		const arbiter = new GestureArbiter();
		arbiter.handle({ type: 'down', pointer: p(1) });
		const decision = arbiter.handle({ type: 'move', pointer: p(99, 5, 5) });
		// The unknown pointer is not tracked, so the concurrent count is still 1 — locks manipulate.
		expect(decision).toEqual({ mode: 'manipulate', locked: true });
	});

	it('ignores an up for a pointer id that is not currently down', () => {
		const arbiter = new GestureArbiter();
		arbiter.handle({ type: 'down', pointer: p(1) });
		const decision = arbiter.handle({ type: 'up', pointerId: 42 });
		// Pointer 1 is still down afterwards, so the gesture has not ended and stays undecided.
		expect(decision).toEqual({ mode: null, locked: false });
		expect(arbiter.current()).toEqual({ mode: null, locked: false });
	});

	it('handles three or more concurrent pointers as navigate', () => {
		const arbiter = new GestureArbiter();
		arbiter.handle({ type: 'down', pointer: p(1) });
		arbiter.handle({ type: 'down', pointer: p(2) });
		arbiter.handle({ type: 'down', pointer: p(3) });
		const decision = arbiter.handle({ type: 'move', pointer: p(2, 1, 1) });
		expect(decision).toEqual({ mode: 'navigate', locked: true });
	});
});
