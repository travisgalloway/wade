import { expect, test, type Page } from '@playwright/test';

// Exercises the kernel-driven scene (issues #25, #26): a parametric box + cylinder, computed
// off-thread by kernel.worker.ts and streamed back through KernelClient. Runs under its own
// 'kernel' Playwright project (see playwright.config.ts) with a longer default timeout than the
// other e2e suites, because the ~22 MB occt-wasm module has to compile on first load. Every test
// here waits for window.__wade.kernelReady before making any settle/idle assertion — the same role
// renderCount plays as a "boot finished" gate in the other suites.

type KernelWindow = {
	__wade?: {
		renderCount: number;
		kernelReady?: boolean;
		kernelMeshCount?: number;
		allIndexed?: boolean;
	};
};

function readWade(page: Page) {
	return page.evaluate(() => (window as KernelWindow).__wade);
}

async function waitForKernelReady(page: Page) {
	await page.waitForFunction(
		() => (window as KernelWindow).__wade?.kernelReady === true,
		undefined,
		{
			timeout: 120_000
		}
	);
}

/**
 * Boot renders more than one frame in quick succession (the two solids arriving, then the initial
 * camera fit) — waits for that flurry to settle (renderCount unchanged across a few consecutive
 * polls) before a test asserts anything about a *single* subsequent update, so the assertion isn't
 * racing the boot sequence. Same pattern as waitForRenderCountToSettle in viewport.e2e.ts.
 */
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

/** Sets a slider's value and fires a real `input` event, exactly what ParamsPanel's `oninput`
 *  handler listens for — bypasses simulating a physical drag for determinism, which matters most
 *  in the rapid-drag test below where many values need to land inside one debounce window. */
function setSlider(page: Page, testId: string, value: number) {
	return page.locator(`[data-testid="${testId}"]`).evaluate((el, v) => {
		const input = el as HTMLInputElement;
		input.value = String(v);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}, value);
}

test('the parametric box and cylinder render once the kernel is ready', async ({ page }) => {
	await page.goto('/');
	await waitForKernelReady(page);
	await waitForRenderCountToSettle(page);

	const wade = await readWade(page);
	expect(wade?.renderCount).toBeGreaterThan(0);
	// Both solids have produced at least one mesh each by the time the boot flurry has settled.
	expect(wade?.kernelMeshCount).toBeGreaterThanOrEqual(2);
	expect(wade?.allIndexed).toBe(true);
});

test('a single slider change increments kernelMeshCount by 1 and renderCount by exactly 1 (#25)', async ({
	page
}) => {
	await page.goto('/');
	await waitForKernelReady(page);
	await waitForRenderCountToSettle(page);

	const before = await readWade(page);
	const meshCountBefore = before?.kernelMeshCount ?? 0;
	const renderCountBefore = before?.renderCount ?? 0;

	await setSlider(page, 'box-width', 55);

	await page.waitForFunction(
		(expected) => (window as KernelWindow).__wade?.kernelMeshCount === expected,
		meshCountBefore + 1,
		{ timeout: 20_000 }
	);

	const afterSettle = await waitForRenderCountToSettle(page);
	expect(afterSettle).toBe(renderCountBefore + 1);

	const after = await readWade(page);
	expect(after?.kernelMeshCount).toBe(meshCountBefore + 1);
});

test('a rapid slider drag produces fewer meshes than input events (debounce/conflation, #26)', async ({
	page
}) => {
	await page.goto('/');
	await waitForKernelReady(page);
	await waitForRenderCountToSettle(page);

	const meshCountBefore = (await readWade(page))?.kernelMeshCount ?? 0;

	const values = Array.from({ length: 20 }, (_, i) => 20 + i * 3);
	for (const value of values) {
		await setSlider(page, 'cylinder-radius', value);
	}

	// Past the debounce window, the conflated tail end of the drag should have been sent and
	// resolved by now.
	await page.waitForTimeout(1000);
	const meshesProduced = ((await readWade(page))?.kernelMeshCount ?? 0) - meshCountBefore;

	expect(meshesProduced).toBeGreaterThan(0);
	expect(meshesProduced).toBeLessThan(values.length);
});

test('no main-thread long task is recorded while the kernel recomputes (#25 — no jank)', async ({
	page
}) => {
	await page.goto('/');
	await waitForKernelReady(page);
	await waitForRenderCountToSettle(page);

	await page.evaluate(() => {
		(window as unknown as { __longTaskDurations: number[] }).__longTaskDurations = [];
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				(window as unknown as { __longTaskDurations: number[] }).__longTaskDurations.push(
					entry.duration
				);
			}
		});
		observer.observe({ entryTypes: ['longtask'] });
	});

	const meshCountBefore = (await readWade(page))?.kernelMeshCount ?? 0;
	await setSlider(page, 'box-height', 70);
	await page.waitForFunction(
		(expected) => (window as KernelWindow).__wade?.kernelMeshCount === expected,
		meshCountBefore + 1,
		{ timeout: 20_000 }
	);

	// The worker's WASM recompute runs off the main thread by construction (invariant 1), so it
	// correctly never shows up here — a regression that somehow ran OCCT on the main thread would
	// be exactly the kind of long task this catches.
	const longTaskDurations = await page.evaluate(
		() => (window as unknown as { __longTaskDurations: number[] }).__longTaskDurations
	);
	expect(longTaskDurations).toEqual([]);
});
