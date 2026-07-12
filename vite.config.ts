import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	// `format: 'es'` is required for `new Worker(new URL(...), { type: 'module' })` (issue #22) —
	// Vite's classic/IIFE worker output can't `import` the wasm asset URL at all. The other two
	// entries are occt-wasm's own documented Vite requirements: esbuild's dep pre-bundling rewrites
	// the emscripten glue in ways that break it (`optimizeDeps.exclude`), and the wasm features /
	// top-level await it relies on need a modern build target (`build.target`).
	worker: { format: 'es' },
	optimizeDeps: { exclude: ['occt-wasm'] },
	build: { target: 'esnext' },
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
