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
