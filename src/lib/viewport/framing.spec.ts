import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { frameBox } from './framing';

describe('frameBox', () => {
	it('targets the center of the box', () => {
		const box = new Box3(new Vector3(-1, -1, -1), new Vector3(3, 5, 1));
		const { target } = frameBox({ box, fovDegrees: 50, aspect: 16 / 9 });

		expect(target.toArray()).toEqual([1, 2, 0]);
	});

	it('places the camera along the requested direction at a positive distance', () => {
		const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
		const direction = new Vector3(0, 0, 1);
		const { position, target } = frameBox({ box, fovDegrees: 50, aspect: 1, direction });

		// Position must lie exactly along +Z from the target — no X/Y drift.
		expect(position.x).toBeCloseTo(target.x, 10);
		expect(position.y).toBeCloseTo(target.y, 10);
		expect(position.z).toBeGreaterThan(target.z);
	});

	it('normalizes a non-unit direction vector', () => {
		const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
		const unit = frameBox({ box, fovDegrees: 50, aspect: 1, direction: new Vector3(0, 0, 1) });
		const scaled = frameBox({ box, fovDegrees: 50, aspect: 1, direction: new Vector3(0, 0, 10) });

		expect(scaled.position.toArray()).toEqual(
			unit.position.toArray().map((n) => n) // same result regardless of input magnitude
		);
	});

	it('increases distance monotonically as padding increases', () => {
		const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
		const tight = frameBox({ box, fovDegrees: 50, aspect: 1, padding: 1 });
		const padded = frameBox({ box, fovDegrees: 50, aspect: 1, padding: 2 });

		const tightDistance = tight.position.distanceTo(tight.target);
		const paddedDistance = padded.position.distanceTo(padded.target);

		expect(paddedDistance).toBeCloseTo(tightDistance * 2, 10);
	});

	it('uses the horizontal FOV when a narrow aspect ratio is more restrictive than the vertical FOV', () => {
		const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
		const wide = frameBox({ box, fovDegrees: 50, aspect: 2 });
		const narrow = frameBox({ box, fovDegrees: 50, aspect: 0.2 });

		const wideDistance = wide.position.distanceTo(wide.target);
		const narrowDistance = narrow.position.distanceTo(narrow.target);

		// A much narrower viewport must back the camera up further to keep the box in frame.
		expect(narrowDistance).toBeGreaterThan(wideDistance);
	});

	it('fits a bigger box from further away, for the same FOV', () => {
		const small = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
		const big = new Box3(new Vector3(-10, -10, -10), new Vector3(10, 10, 10));

		const smallResult = frameBox({ box: small, fovDegrees: 50, aspect: 16 / 9 });
		const bigResult = frameBox({ box: big, fovDegrees: 50, aspect: 16 / 9 });

		const smallDistance = smallResult.position.distanceTo(smallResult.target);
		const bigDistance = bigResult.position.distanceTo(bigResult.target);

		expect(bigDistance).toBeGreaterThan(smallDistance);
	});
});
