// The only place `Comlink.wrap` and `new Worker(...)` are allowed to live (issue #24) — everything
// in `KernelClient.ts` itself is pure and DI'd, so it can be unit-tested with no real Worker. This
// factory is what wires the real thing together for the browser, and it's why `KernelClientOptions
// .connect()` is lazy: constructing a `KernelClient` here does not boot the worker or start
// downloading the 22 MB wasm — only the first `request()`/`warmup()` call does, via `connect()`.
import * as Comlink from 'comlink';
import { KernelClient, type KernelApi } from './KernelClient';
import type { KernelWorkerApi } from './types';

/** Builds a `KernelClient` wired to a real `kernel.worker.ts` instance. Call once per app session
 *  (e.g. in Scene.svelte's `$effect`, per invariant 3 — never at module scope, since `new Worker`
 *  doesn't exist during SvelteKit's SSR/shell pass). */
export function createKernelClient(): KernelClient {
	return new KernelClient({
		connect(): Promise<KernelApi> {
			const worker = new Worker(new URL('./kernel.worker.ts', import.meta.url), { type: 'module' });
			// `Remote<KernelWorkerApi>` collapses back to `KernelWorkerApi` itself for a plain
			// async-method interface like this one (every method already returns a `Promise`), so
			// the wrapped proxy is assignable directly as the `KernelApi` shape `KernelClient` expects.
			return Promise.resolve(Comlink.wrap<KernelWorkerApi>(worker) as unknown as KernelApi);
		}
	});
}
