import { expect, test, type Page } from '@playwright/test';

// Pins down the world's up-axis convention: right-handed Z-up, matching AutoCAD/SketchUp/Blender
// and — the reason it was chosen — OCCT itself, so world space *is* kernel space (see
// src/lib/viewport/orientation.ts).
//
// This suite exists because the rest of the e2e suite was blind to the bug that prompted it. The
// viewport rendered, snaps resolved, draw calls were counted, meshes were indexed — and all of it
// stayed green while the box's Height param grew the box *sideways*, because the kernel emits Z-up
// geometry into what was then a Y-up scene. Every assertion below is one that fails against that
// bug, which is the whole bar for a regression test: passing on the fix is not enough, it has to
// fail on the defect.
//
// Runs against the kernel scene (`/`), so it waits on the same ~22 MB occt-wasm compile as
// kernel.e2e.ts and gets the same longer timeout via its own Playwright project.

type OrientationWindow = {
	__wade?: {
		renderCount: number;
		kernelReady?: boolean;
		kernelMeshCount?: number;
		drawCalls?: number;
		axesPresent?: boolean;
		boxExtents?: [number, number, number];
		projectToNdc?: (point: [number, number, number]) => [number, number];
		snapKind?: 'vertex' | 'edge' | 'grid' | null;
		snapPoint?: [number, number, number];
	};
};

function readWade(page: Page) {
	return page.evaluate(() => (window as OrientationWindow).__wade);
}

async function waitForKernelReady(page: Page) {
	await page.waitForFunction(
		() => (window as OrientationWindow).__wade?.kernelReady === true,
		undefined,
		{ timeout: 120_000 }
	);
}

/** Same settle-the-boot-flurry gate the other kernel-scene suites use before asserting on a single
 *  subsequent update — see kernel.e2e.ts. */
async function waitForRenderCountToSettle(page: Page): Promise<number> {
	let previous = -1;
	let stableStreak = 0;
	while (stableStreak < 3) {
		await page.waitForTimeout(150);
		const current = (await readWade(page))?.renderCount ?? 0;
		stableStreak = current === previous ? stableStreak + 1 : 0;
		previous = current;
	}
	return previous;
}

/** Sets a slider and fires the real `input` event ParamsPanel listens for — same helper as
 *  kernel.e2e.ts. */
function setSlider(page: Page, testId: string, value: number) {
	return page.locator(`[data-testid="${testId}"]`).evaluate((el, v) => {
		const input = el as HTMLInputElement;
		input.value = String(v);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}, value);
}

/**
 * The regression test for the reported bug: "Height 56" rendering as a long horizontal beam.
 *
 * It has to be a *screen-space* assertion. The tempting world-space check — "does Height grow the
 * box's Z extent" — passes even on the broken build, because the kernel always emitted a correct
 * Z-up box; it was the camera that thought +Y was up, so the box's height ran across the screen
 * rather than up it. Projecting the world's +Z axis and asserting it points up the screen is what
 * actually distinguishes the two worlds.
 */
test('the world +Z axis projects to screen-up: the ground grid is the ground', async ({ page }) => {
	await page.goto('/');
	await waitForKernelReady(page);
	await waitForRenderCountToSettle(page);

	const axis = await page.evaluate(() => {
		const project = (window as OrientationWindow).__wade?.projectToNdc;
		if (!project) return null;
		const origin = project([0, 0, 0]);
		const zTip = project([0, 0, 50]);
		const yTip = project([0, 50, 0]);
		return {
			z: [zTip[0] - origin[0], zTip[1] - origin[1]],
			y: [yTip[0] - origin[0], yTip[1] - origin[1]]
		};
	});
	expect(axis, 'expected the projection hook to be published').not.toBeNull();

	// NDC y points up the screen. Moving along world +Z must move *up* the screen...
	expect(axis!.z[1]).toBeGreaterThan(0);
	// ...and predominantly so, rather than mostly sideways. This is the clause that fails on the
	// Y-up build, where +Z projected almost horizontally.
	expect(Math.abs(axis!.z[1])).toBeGreaterThan(Math.abs(axis!.z[0]));

	// And the converse: +Y is depth, so it must read as mostly horizontal, not as the up direction.
	expect(Math.abs(axis!.y[1])).toBeLessThan(Math.abs(axis!.z[1]));
});

/**
 * Complements the projection test above rather than duplicating it: this one pins the *kernel's*
 * param-to-axis mapping (that `box(width, depth, height)` puts height on Z and not, say, on Y),
 * which is a different failure than the scene being oriented wrongly. Worth stating plainly: this
 * assertion would have passed on the build that shipped the bug — swapping two arguments in
 * kernel.worker.ts is the regression it actually guards.
 */
test('the box Height param grows the box along +Z, and leaves width/depth alone', async ({
	page
}) => {
	await page.goto('/');
	await waitForKernelReady(page);
	await waitForRenderCountToSettle(page);

	const before = (await readWade(page))?.boxExtents;
	expect(before, 'expected the box extents to be published').toBeDefined();
	const meshCountBefore = (await readWade(page))?.kernelMeshCount ?? 0;

	const NEW_HEIGHT = 90;
	await setSlider(page, 'box-height', NEW_HEIGHT);
	await page.waitForFunction(
		(expected) => (window as OrientationWindow).__wade?.kernelMeshCount === expected,
		meshCountBefore + 1,
		{ timeout: 120_000 }
	);

	const after = (await readWade(page))?.boxExtents;
	expect(after).toBeDefined();

	// Height is Z, and moves nothing else.
	expect(after![2]).toBeCloseTo(NEW_HEIGHT, 1);
	expect(after![0]).toBeCloseTo(before![0], 1); // width unchanged
	expect(after![1]).toBeCloseTo(before![1], 1); // depth unchanged
	expect(after![2]).toBeGreaterThan(before![2]);
});

test('the box Width and Depth params move X and Y respectively', async ({ page }) => {
	await page.goto('/');
	await waitForKernelReady(page);
	await waitForRenderCountToSettle(page);

	const before = (await readWade(page))?.boxExtents;
	expect(before).toBeDefined();
	let meshCount = (await readWade(page))?.kernelMeshCount ?? 0;

	const waitForNextMesh = async () => {
		meshCount += 1;
		await page.waitForFunction(
			(expected) => (window as OrientationWindow).__wade?.kernelMeshCount === expected,
			meshCount,
			{ timeout: 120_000 }
		);
	};

	const NEW_WIDTH = 80;
	await setSlider(page, 'box-width', NEW_WIDTH);
	await waitForNextMesh();
	let extents = (await readWade(page))?.boxExtents;
	expect(extents![0]).toBeCloseTo(NEW_WIDTH, 1); // width is X
	expect(extents![2]).toBeCloseTo(before![2], 1); // height (Z) untouched

	const NEW_DEPTH = 70;
	await setSlider(page, 'box-depth', NEW_DEPTH);
	await waitForNextMesh();
	extents = (await readWade(page))?.boxExtents;
	expect(extents![1]).toBeCloseTo(NEW_DEPTH, 1); // depth is Y
	expect(extents![2]).toBeCloseTo(before![2], 1); // height (Z) still untouched
});

test('a grid snap lands on the Z = 0 ground plane, with X and Y quantized', async ({ page }) => {
	await page.goto('/');
	await waitForKernelReady(page);
	await waitForRenderCountToSettle(page);

	// The far corners of the canvas are outside both solids' screen footprint but still cross the
	// ground plane, so they're where an open-grid snap resolves — same points snapping.e2e.ts uses.
	const openGrid: Array<[number, number]> = [
		[0.03, 0.95],
		[0.97, 0.95],
		[0.03, 0.5],
		[0.97, 0.5],
		[0.5, 0.97]
	];

	const box = await page.locator('canvas').boundingBox();
	if (!box) throw new Error('canvas has no bounding box');

	let point: [number, number, number] | undefined;
	for (const [fx, fy] of openGrid) {
		await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
		await page.waitForTimeout(30);
		const wade = await readWade(page);
		if (wade?.snapKind === 'grid') {
			point = wade.snapPoint;
			break;
		}
	}

	expect(point, 'expected some screen point to resolve a grid snap').toBeDefined();

	// The scene's grid and snapping.ts's GROUND_PLANE have to agree on which plane the ground *is*.
	// A unit test can't catch them disagreeing; this can.
	const [x, y, z] = point!;
	expect(z).toBe(0);
	expect(x % 10).toBeCloseTo(0, 6);
	expect(y % 10).toBeCloseTo(0, 6);
});

test('the axes indicator is mounted in the kernel scene and absent from the ?kernel=off fallback', async ({
	page
}) => {
	await page.goto('/');
	await waitForKernelReady(page);
	await waitForRenderCountToSettle(page);

	expect((await readWade(page))?.axesPresent).toBe(true);

	// And *not* in the fallback scene. This is load-bearing rather than cosmetic: viewport.e2e.ts
	// asserts an exact draw-call count against that scene, so an axes indicator leaking into it
	// would break an unrelated suite — which is a confusing failure to debug from the other end.
	await page.goto('/?kernel=off');
	await page.waitForFunction(() => ((window as OrientationWindow).__wade?.renderCount ?? 0) > 0);
	await waitForRenderCountToSettle(page);

	expect((await readWade(page))?.axesPresent).toBe(false);
});
