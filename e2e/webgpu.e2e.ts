import { expect, test, type Page } from '@playwright/test';

// Runs under the 'webgpu' Playwright project, which launches Chromium with --enable-unsafe-webgpu.
// That flag alone is enough even on a GPU-less CI runner: Chrome ships a SwiftShader WebGPU
// backend, so requestAdapter() resolves to a software adapter. These tests are what actually prove
// invariant 5 — the sibling viewport.e2e.ts suite only proves "a frame rendered", which is equally
// true on the WebGL2 fallback and so cannot catch a silent, permanent drop to WebGL2.

type WadeWindow = { __wade?: { renderCount: number; backend?: 'webgpu' | 'webgl2' } };

async function bootAndGetBackend(page: Page, url = '/') {
	await page.goto(url);
	await page.waitForFunction(() => {
		const wade = (window as WadeWindow).__wade;
		return wade?.backend !== undefined && wade.renderCount > 0;
	});
	return page.evaluate(() => (window as WadeWindow).__wade!.backend);
}

test('WebGPU is the active backend by default, and it renders', async ({ page }) => {
	expect(await bootAndGetBackend(page)).toBe('webgpu');
	expect(await page.evaluate(() => (window as WadeWindow).__wade!.renderCount)).toBeGreaterThan(0);
});

test('forceWebGL still overrides to the WebGL2 backend even when WebGPU is available', async ({
	page
}) => {
	// The escape hatch has to win over an available WebGPU adapter, otherwise the toggle is a no-op
	// on exactly the machines it exists to let you benchmark against.
	expect(await bootAndGetBackend(page, '/?forceWebGL=1')).toBe('webgl2');
});

test('WebGPU adapter is hardware-accelerated', async ({ page }) => {
	// CI runners have no GPU, so the adapter there is Chrome's SwiftShader software fallback — real
	// enough to exercise the WebGPU code path, but it cannot prove hardware acceleration. That claim
	// is only checkable on a developer machine, so this test asserts it there and skips in CI rather
	// than pretending the software adapter is the real thing.
	test.skip(!!process.env.CI, 'no GPU on CI runners — software SwiftShader adapter only');

	await page.goto('/');
	const architecture = await page.evaluate(async () => {
		const adapter = await navigator.gpu.requestAdapter();
		return adapter?.info?.architecture ?? 'none';
	});

	expect(architecture).not.toBe('none');
	expect(architecture).not.toBe('swiftshader');
});
