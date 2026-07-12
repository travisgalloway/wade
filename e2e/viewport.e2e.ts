import { expect, test, type Page } from '@playwright/test';

// Runs under the 'chromium' Playwright project, which launches *without* --enable-unsafe-webgpu:
// navigator.gpu is absent, so the renderer takes its automatic WebGL2 fallback. That makes this
// suite the one that keeps the fallback path exercised. Its assertions are therefore deliberately
// backend-agnostic — "a frame was rendered" (window.__wade.renderCount, from
// src/lib/viewport/renderLoop.ts) plus the on-demand invariant. Proving WebGPU is the *default*
// backend is webgpu.e2e.ts's job, under the sibling 'webgpu' project.

function renderCount(page: Page) {
	return page.evaluate(
		() => (window as { __wade?: { renderCount: number } }).__wade?.renderCount ?? 0
	);
}

async function waitForFirstFrame(page: Page) {
	await page.waitForFunction(
		() =>
			(window as { __wade?: { renderCount: number } }).__wade?.renderCount !== undefined &&
			(window as { __wade?: { renderCount: number } }).__wade!.renderCount > 0
	);
}

/**
 * Boot renders more than one frame in quick succession — the sample mesh loads asynchronously,
 * then the camera reframes to it, then the mesh mounts into the scene — each a legitimate
 * "model changed" / "camera changed" invalidation. Waits for that initial flurry to settle
 * (renderCount unchanged across a few consecutive polls) before the test asserts true idle
 * flatness, so the assertion isn't racing the boot sequence.
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

async function dragOrbit(page: Page) {
	const canvas = page.locator('canvas');
	const box = await canvas.boundingBox();
	if (!box) throw new Error('canvas has no bounding box');

	const centerX = box.x + box.width / 2;
	const centerY = box.y + box.height / 2;

	await page.mouse.move(centerX, centerY);
	await page.mouse.down();
	await page.mouse.move(centerX + 120, centerY + 60, { steps: 12 });
	await page.mouse.up();
}

test('boots and renders a frame', async ({ page }) => {
	await page.goto('/');
	await waitForFirstFrame(page);

	expect(await renderCount(page)).toBeGreaterThan(0);
});

test('renders on demand: idle stays flat, an orbit drag advances it', async ({ page }) => {
	await page.goto('/');
	await waitForFirstFrame(page);
	const idleCount = await waitForRenderCountToSettle(page);

	await page.waitForTimeout(1000);
	const afterIdleCount = await renderCount(page);
	expect(afterIdleCount).toBe(idleCount);

	await dragOrbit(page);
	await page.waitForFunction(
		(before) => (window as { __wade?: { renderCount: number } }).__wade!.renderCount > before,
		afterIdleCount
	);
	const afterDragCount = await renderCount(page);
	expect(afterDragCount).toBeGreaterThan(afterIdleCount);
});

test('?forceWebGL=1 still renders (WebGL2 fallback path)', async ({ page }) => {
	await page.goto('/?forceWebGL=1');
	await waitForFirstFrame(page);

	expect(await renderCount(page)).toBeGreaterThan(0);
});

// Selection/hover (issues #16-#18): picking is CPU-side raycasting against the BVH built in
// src/lib/viewport/picking.ts and is unaffected by which graphics backend is active, so exercising
// it under the WebGL2-fallback 'chromium' project alone is sufficient — no need to duplicate this
// in webgpu.e2e.ts.

type SelectionWindow = { __wade?: { selected?: boolean; hovered?: boolean } };

function readSelected(page: Page) {
	return page.evaluate(() => (window as SelectionWindow).__wade?.selected ?? false);
}

function readHovered(page: Page) {
	return page.evaluate(() => (window as SelectionWindow).__wade?.hovered ?? false);
}

/**
 * The sample part (scripts/make-sample-part.ts) is a deliberately *asymmetric* L-bracket, so the
 * exact center of its framed bounding box — where frameBox.ts points the camera — is not
 * guaranteed to land on solid material (it may fall in the open space next to the upright wall).
 * Rather than bake the bracket's internal shape into this test, scan a grid over the central
 * region of the canvas (framing's own padding keeps some margin around the object, so the grid
 * stays inside `[0.2, 0.8]` of each axis) using `probe`, stopping at the first point that reads
 * true. Used for both click-to-select and hover, which share the same underlying pick.
 */
async function scanForHit(
	page: Page,
	act: (x: number, y: number) => Promise<void>,
	probe: (page: Page) => Promise<boolean>
): Promise<{ x: number; y: number }> {
	const box = await page.locator('canvas').boundingBox();
	if (!box) throw new Error('canvas has no bounding box');

	const steps = [0.2, 0.35, 0.5, 0.65, 0.8];
	for (const fy of steps) {
		for (const fx of steps) {
			const x = box.x + box.width * fx;
			const y = box.y + box.height * fy;
			await act(x, y);
			if (await probe(page)) return { x, y };
		}
	}
	throw new Error('no grid point over the canvas hit the sample part');
}

test('clicking the framed model selects it; clicking empty space deselects it', async ({
	page
}) => {
	await page.goto('/');
	await waitForFirstFrame(page);
	await waitForRenderCountToSettle(page);

	// A single mouse pointer with negligible movement resolves to the router's `manipulate`
	// channel, which runs a selection pick on release.
	await scanForHit(page, (x, y) => page.mouse.click(x, y), readSelected);

	// A corner well outside the framed (and padded) model's screen footprint misses it entirely.
	const box = await page.locator('canvas').boundingBox();
	if (!box) throw new Error('canvas has no bounding box');
	await page.mouse.click(box.x + box.width * 0.02, box.y + box.height * 0.02);
	await page.waitForFunction(() => (window as SelectionWindow).__wade?.selected === false);
});

test('hovering the model sets hover state without selecting it, and is idempotent for invalidation', async ({
	page
}) => {
	await page.goto('/');
	await waitForFirstFrame(page);
	const idleCount = await waitForRenderCountToSettle(page);

	// A plain mouse move with no button held never reaches the router's mouse-gesture tracking
	// (there is no matching 'down'), so `decision.mode` stays `null` — not `navigate` — and hover
	// picking runs, without ever selecting anything.
	const hit = await scanForHit(page, (x, y) => page.mouse.move(x, y), readHovered);
	expect(await readSelected(page)).toBe(false);

	// Hover picking must not invalidate on every pointermove, only when the hovered object
	// actually changes (invariant 2): once settled, repeating the same move must not advance
	// renderCount further.
	const settledCount = await waitForRenderCountToSettle(page);
	expect(settledCount).toBeGreaterThanOrEqual(idleCount);

	await page.mouse.move(hit.x, hit.y);
	await page.waitForTimeout(200);
	expect(await renderCount(page)).toBe(settledCount);
});
