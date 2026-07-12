import { describe, expect, it } from 'vitest';
import { OCCLUSION_OFFSET_PX, offsetPickPoint, toNDC } from './picking';

describe('offsetPickPoint', () => {
	it('leaves a mouse point untouched', () => {
		expect(offsetPickPoint({ x: 100, y: 200, pointerKind: 'mouse' })).toEqual({ x: 100, y: 200 });
	});

	it('lifts a touch point above the contact point, to beat finger occlusion', () => {
		const result = offsetPickPoint({ x: 100, y: 200, pointerKind: 'touch' });
		expect(result.x).toBe(100);
		expect(result.y).toBe(200 - OCCLUSION_OFFSET_PX);
	});

	it('lifts a pen point the same way as touch', () => {
		const result = offsetPickPoint({ x: 50, y: 50, pointerKind: 'pen' });
		expect(result).toEqual({ x: 50, y: 50 - OCCLUSION_OFFSET_PX });
	});
});

describe('toNDC', () => {
	it('maps the canvas center to the NDC origin', () => {
		const ndc = toNDC(400, 300, 800, 600);
		expect(ndc.x).toBeCloseTo(0, 10);
		expect(ndc.y).toBeCloseTo(0, 10);
	});

	it('maps the top-left corner to (-1, 1)', () => {
		const ndc = toNDC(0, 0, 800, 600);
		expect(ndc.x).toBeCloseTo(-1, 10);
		expect(ndc.y).toBeCloseTo(1, 10);
	});

	it('maps the bottom-right corner to (1, -1)', () => {
		const ndc = toNDC(800, 600, 800, 600);
		expect(ndc.x).toBeCloseTo(1, 10);
		expect(ndc.y).toBeCloseTo(-1, 10);
	});
});
