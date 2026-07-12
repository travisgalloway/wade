import { defineConfig } from '@playwright/test';

// Two projects, because "a frame rendered" is true on *either* graphics backend and so cannot by
// itself prove invariant 5 (WebGPU by default, WebGL2 as the escape hatch). Each project pins down
// one half of it:
//
//   chromium — no WebGPU flag, so navigator.gpu is absent and the renderer takes its automatic
//              WebGL2 fallback. Keeps that fallback exercised rather than merely theoretical.
//   webgpu   — --enable-unsafe-webgpu, which is sufficient on its own: Chrome ships a SwiftShader
//              WebGPU backend, so a headless CI runner with no GPU still gets a real adapter — no
//              Vulkan driver install and no GPU runner required.
//
// --enable-gpu is what decides *which* adapter you get. Headless Chromium disables the GPU by
// default and hands back SwiftShader even on a machine with a perfectly good one; with the flag, a
// developer machine resolves to real hardware (metal-3 on Apple silicon) while a GPU-less CI runner
// still degrades to SwiftShader. That is why the hardware-acceleration assertion in webgpu.e2e.ts
// can pass locally and skip on CI rather than being impossible everywhere.
//
// WebGPU requires a secure context; http://localhost:4173 qualifies.
export default defineConfig({
	webServer: { command: 'npm run build && npm run preview', port: 4173 },
	projects: [
		{
			name: 'chromium',
			testMatch: '**/viewport.e2e.ts'
		},
		{
			name: 'webgpu',
			testMatch: '**/webgpu.e2e.ts',
			use: { launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-gpu'] } }
		}
	]
});
