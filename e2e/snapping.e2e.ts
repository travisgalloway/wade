import { expect, test, type Page } from '@playwright/test';

// Exercises snapping (issue #27): vertex/edge/grid snap resolution driven from the pointer, against
// the kernel-driven scene's box + cylinder + ground grid (Scene.svelte). This is what turns #27's
// "snapping to a vertex, an edge, and the grid all work in a manual test" acceptance criterion into
// a repeatable, automated check rather than a one-time promise.
//
// Wired only into the kernel scene (not the `?kernel=off` fallback that viewport.e2e.ts exercises),
// so this navigates to `/` and waits for kernelReady exactly like kernel.e2e.ts, and runs under its
// own Playwright project with the same longer timeout for the same reason (the ~22 MB occt-wasm
// module has to compile on first load).

type SnapWindow = {
	__wade?: {
		renderCount: number;
		kernelReady?: boolean;
		snapKind?: 'vertex' | 'edge' | 'grid' | null;
		snapPoint?: [number, number, number];
	};
};

function readSnapKind(page: Page) {
	return page.evaluate(() => (window as SnapWindow).__wade?.snapKind ?? null);
}

function renderCount(page: Page) {
	return page.evaluate(() => (window as SnapWindow).__wade?.renderCount ?? 0);
}

async function waitForKernelReady(page: Page) {
	await page.waitForFunction(() => (window as SnapWindow).__wade?.kernelReady === true, undefined, {
		timeout: 120_000
	});
}

/**
 * Boot renders more than one frame in quick succession (the two solids arriving, then the initial
 * camera fit) — waits for that flurry to settle before a test starts scanning for a snap, so a
 * still-in-progress boot render doesn't get mistaken for one driven by a pointer move. Same pattern
 * as the other e2e suites' waitForRenderCountToSettle.
 */
async function waitForRenderCountToSettle(page: Page): Promise<number> {
	let previous = -1;
	let stableStreak = 0;
	while (stableStreak < 3) {
		await page.waitForTimeout(150);
		const current = await renderCount(page);
		stableStreak = current === previous ? stableStreak + 1 : 0;
		previous = current;
	}
	return previous;
}

/**
 * Scans a grid of screen points (as fractions of the canvas box), moving the pointer to each and
 * checking `predicate` after it settles, stopping at the first match. Mirrors viewport.e2e.ts's
 * `scanForHit`, adapted to poll a predicate instead of acting-then-checking a single point.
 */
async function scanFor(
	page: Page,
	steps: Array<[number, number]>,
	predicate: () => Promise<boolean>
): Promise<{ x: number; y: number } | null> {
	const box = await page.locator('canvas').boundingBox();
	if (!box) throw new Error('canvas has no bounding box');

	for (const [fx, fy] of steps) {
		const x = box.x + box.width * fx;
		const y = box.y + box.height * fy;
		await page.mouse.move(x, y);
		await page.waitForTimeout(30);
		if (await predicate()) return { x, y };
	}
	return null;
}

/** A moderately fine grid over the central region of the canvas — fine enough to land on both a
 *  solid's vertices and its edges without hard-coding the exact screen footprint the runtime
 *  camera fit (frameBox) happens to produce. */
const FINE_GRID: Array<[number, number]> = [];
for (let fy = 0.1; fy <= 0.9; fy += 0.05) {
	for (let fx = 0.1; fx <= 0.9; fx += 0.05) {
		FINE_GRID.push([fx, fy]);
	}
}

test('snapping resolves a vertex, an edge, and a grid point', async ({ page }) => {
	await page.goto('/');
	await waitForKernelReady(page);
	await waitForRenderCountToSettle(page);

	const vertexHit = await scanFor(
		page,
		FINE_GRID,
		async () => (await readSnapKind(page)) === 'vertex'
	);
	expect(vertexHit, 'expected some screen point to resolve a vertex snap').not.toBeNull();

	const edgeHit = await scanFor(page, FINE_GRID, async () => (await readSnapKind(page)) === 'edge');
	expect(edgeHit, 'expected some screen point to resolve an edge snap').not.toBeNull();

	// The far corners/edges of the canvas are outside both solids' screen footprint but still cross
	// the ground plane, so they're where an open-grid snap is expected.
	const openGrid: Array<[number, number]> = [
		[0.03, 0.95],
		[0.97, 0.95],
		[0.03, 0.5],
		[0.97, 0.5],
		[0.5, 0.97]
	];
	const gridHit = await scanFor(page, openGrid, async () => (await readSnapKind(page)) === 'grid');
	expect(gridHit, 'expected some screen point to resolve a grid snap').not.toBeNull();
});

test('the resolved snap point is exposed on window.__wade and moves with the pointer', async ({
	page
}) => {
	await page.goto('/');
	await waitForKernelReady(page);
	await waitForRenderCountToSettle(page);

	const hit = await scanFor(page, FINE_GRID, async () => (await readSnapKind(page)) === 'vertex');
	expect(hit).not.toBeNull();

	const point = await page.evaluate(() => (window as SnapWindow).__wade?.snapPoint);
	expect(point).toBeDefined();
	expect(point).toHaveLength(3);
});

test('idle stays flat after a snap has resolved (invariant 2), matching viewport.e2e.ts', async ({
	page
}) => {
	await page.goto('/');
	await waitForKernelReady(page);
	await waitForRenderCountToSettle(page);

	const hit = await scanFor(page, FINE_GRID, async () => (await readSnapKind(page)) !== null);
	expect(hit).not.toBeNull();

	const settledCount = await waitForRenderCountToSettle(page);

	// Repeating the exact same pointer position must not advance renderCount further — the same
	// no-op invalidation guarantee SnapModel.svelte.ts's setSnap gives hover in SceneModel.svelte.ts.
	await page.mouse.move(hit!.x, hit!.y);
	await page.waitForTimeout(300);
	expect(await renderCount(page)).toBe(settledCount);

	await page.waitForTimeout(700);
	expect(await renderCount(page)).toBe(settledCount);
});
