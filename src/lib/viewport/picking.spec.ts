import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { OCCLUSION_OFFSET_PX, offsetPickPoint, toNDC, toScreen } from './picking';

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

describe('toScreen', () => {
	function straightCamera(width: number, height: number): PerspectiveCamera {
		const camera = new PerspectiveCamera(50, width / height, 0.1, 1000);
		camera.position.set(0, 0, 10);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();
		return camera;
	}

	it('is the inverse of toNDC: the camera target projects to the canvas center', () => {
		const camera = straightCamera(800, 600);
		const screen = toScreen(new Vector3(0, 0, 0), camera, 800, 600);

		expect(screen).not.toBeNull();
		expect(screen!.x).toBeCloseTo(400, 5);
		expect(screen!.y).toBeCloseTo(300, 5);
	});

	it('maps a point above and left of center to the top-left quadrant', () => {
		const camera = straightCamera(800, 600);
		const screen = toScreen(new Vector3(-2, 2, 0), camera, 800, 600);

		expect(screen).not.toBeNull();
		expect(screen!.x).toBeLessThan(400);
		expect(screen!.y).toBeLessThan(300);
	});

	it('returns null for a point behind the camera', () => {
		const camera = straightCamera(800, 600);
		const behind = toScreen(new Vector3(0, 0, 20), camera, 800, 600);

		expect(behind).toBeNull();
	});
});
