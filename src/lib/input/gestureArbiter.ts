// A pure state machine — zero DOM dependency, takes plain pointer-ish data structures rather than
// real PointerEvents, so it unit-tests directly in the node Vitest project. Implements invariant 8
// (architecture issue #1): navigation and editing never share a gesture. It watches the pointers
// participating in a single gesture (from the first one down to the last one released) and decides
// once, irreversibly, whether that gesture is a camera `navigate` or a `manipulate` (select/edit).
//
// The decision rule is pointer-count based: if more than one pointer is ever concurrently down
// during the gesture, it's `navigate`; a lone pointer is `manipulate`. The tricky part is *when* to
// decide and lock:
//   - Deciding on the very first `down` would be wrong: two fingers landing a few milliseconds
//     apart must still resolve to `navigate`, so the arbiter stays undecided while pointers are
//     merely landing.
//   - The decision locks in at the first `move` (using however many pointers are down at that
//     instant), because that's the first moment the gesture actually *does* something — this is
//     the "opening pointer motion" the decision reads.
//   - A pure tap (down, then up, with no move in between) never reaches a `move`, so the decision
//     is instead made at the final `up`/`cancel` — using the *peak* concurrent pointer count seen
//     during the whole gesture, not just what remains at that instant. Without tracking the peak, a
//     two-finger tap where the fingers release one at a time would wrongly look single-pointer by
//     the time the last one lifts.
// Once locked, the mode never changes for the rest of the gesture: a second finger arriving after a
// single-pointer drag has already locked `manipulate` must not flip it to `navigate`, and losing a
// finger from a locked `navigate` (leaving one pointer that now merely looks like a tap) must not
// flip it to `manipulate`. The gesture only resets once every pointer has released.
export type GestureMode = 'navigate' | 'manipulate';

export interface ArbiterPointer {
	pointerId: number;
	x: number;
	y: number;
}

export type GestureEvent =
	| { type: 'down'; pointer: ArbiterPointer }
	| { type: 'move'; pointer: ArbiterPointer }
	| { type: 'up'; pointerId: number }
	| { type: 'cancel'; pointerId: number };

export interface GestureDecision {
	/** `null` while the current gesture (if any) hasn't locked a mode yet. */
	mode: GestureMode | null;
	/** Once true, `mode` is final for the rest of this gesture, until every pointer releases. */
	locked: boolean;
}

const UNDECIDED: GestureDecision = { mode: null, locked: false };

export class GestureArbiter {
	private readonly pointers = new Map<number, ArbiterPointer>();
	private peakConcurrent = 0;
	private mode: GestureMode | null = null;
	private locked = false;

	/** Feed the next pointer event and get back the gesture's current (possibly just-locked) mode. */
	handle(event: GestureEvent): GestureDecision {
		switch (event.type) {
			case 'down':
				this.pointers.set(event.pointer.pointerId, event.pointer);
				this.peakConcurrent = Math.max(this.peakConcurrent, this.pointers.size);
				return this.snapshot();

			case 'move':
				if (this.pointers.has(event.pointer.pointerId)) {
					this.pointers.set(event.pointer.pointerId, event.pointer);
				}
				this.peakConcurrent = Math.max(this.peakConcurrent, this.pointers.size);
				if (!this.locked) this.lock();
				return this.snapshot();

			case 'up':
			case 'cancel': {
				this.pointers.delete(event.pointerId);
				if (this.pointers.size > 0) return this.snapshot();

				// Last pointer of the gesture released. A pure tap never triggered a `move`, so this
				// is the last chance to decide before the gesture resets to idle.
				if (!this.locked) this.lock();
				const decision = this.snapshot();
				this.reset();
				return decision;
			}
		}
	}

	/** The current decision without feeding an event — safe to poll at any time. */
	current(): GestureDecision {
		return this.snapshot();
	}

	private lock(): void {
		this.mode = this.peakConcurrent > 1 ? 'navigate' : 'manipulate';
		this.locked = true;
	}

	private snapshot(): GestureDecision {
		if (this.mode === null) return UNDECIDED;
		return { mode: this.mode, locked: this.locked };
	}

	private reset(): void {
		this.peakConcurrent = 0;
		this.mode = null;
		this.locked = false;
	}
}
