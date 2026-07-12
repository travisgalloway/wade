import { describe, expect, it } from 'vitest';
import { BOX_LIMITS, CYLINDER_LIMITS, clampBoxParam, clampCylinderParam } from './params.svelte';

// Only the pure clamping logic is exercised here — `createParamsModel()` itself uses `$state` and
// is exercised end-to-end via e2e/kernel.e2e.ts instead, matching the convention already set by
// SceneModel.svelte.ts/settings.svelte.ts (neither has a colocated unit spec either).

describe('clampBoxParam', () => {
	it('passes a value already within range through unchanged', () => {
		expect(clampBoxParam('width', 40)).toBe(40);
	});

	it('clamps a value below the minimum up to the minimum', () => {
		expect(clampBoxParam('depth', -5)).toBe(BOX_LIMITS.depth.min);
	});

	it('clamps a value above the maximum down to the maximum', () => {
		expect(clampBoxParam('height', 10_000)).toBe(BOX_LIMITS.height.max);
	});

	it('falls back to the minimum for NaN input (e.g. a malformed slider value)', () => {
		expect(clampBoxParam('width', Number.NaN)).toBe(BOX_LIMITS.width.min);
	});
});

describe('clampCylinderParam', () => {
	it('passes a value already within range through unchanged', () => {
		expect(clampCylinderParam('radius', 15)).toBe(15);
	});

	it('clamps a value below the minimum up to the minimum', () => {
		expect(clampCylinderParam('radius', -1)).toBe(CYLINDER_LIMITS.radius.min);
	});

	it('clamps a value above the maximum down to the maximum', () => {
		expect(clampCylinderParam('height', 10_000)).toBe(CYLINDER_LIMITS.height.max);
	});

	it('falls back to the minimum for NaN input', () => {
		expect(clampCylinderParam('radius', Number.NaN)).toBe(CYLINDER_LIMITS.radius.min);
	});
});
