# Phase 3 — PWA hardening

**Status: next up, not started.** No `@vite-pwa/sveltekit`, no manifest, no service worker exist yet.

**Goal:** installable, offline-capable, fast to first interaction, with the kernel loaded lazily.

## The problem this phase solves

The OCCT binary is the heavy item — on the order of **~22 MB** as currently built. Today the app waits on it. The point of this phase is that it should not have to: the shell and viewport should be interactive while OCCT is still downloading in the background.

The good news is that the fallback path this depends on **already exists and is already exercised**. `?kernel=off` renders the full Phase 1 scene with no worker booted, and a fatal `kernel-init-failed` takes the same branch. Phase 3 turns that from a degradation path into the _normal boot sequence_.

## Tasks

### Manifest and installability

- Add `@vite-pwa/sveltekit` (Workbox under the hood).
- Generate the web app manifest with icons and `display: standalone`.
- Add an install prompt via `beforeinstallprompt`.

### Caching

- Precache the app shell.
- **Runtime-cache the OCCT WASM with a CacheFirst, versioned strategy.** The kernel already imports the WASM through Vite's content-hashed `?url` import — that hashing is what makes this cache safe, and it is one of the reasons `kernel.worker.ts` does not call brepjs's own `init()`. See [`../architecture/kernel.md`](../architecture/kernel.md#kernel-init).
- NetworkFirst for any future API.

### Load performance

- **Lazy-load the kernel worker after first paint**, so the shell and viewport are interactive before OCCT finishes downloading. Show a non-blocking kernel-loading state. Note that `KernelClient`'s `connect()` is already lazy — constructing a client does not boot the WASM — so the groundwork is in place.
- Serve the WASM with `WebAssembly.instantiateStreaming`; confirm Brotli at the host layer.
- Code-split the renderer and the kernel so neither sits in the initial bundle.
- **Investigate a slim OCCT build.** OpenCascade custom builds can include only the modules brepjs actually calls, which cuts the binary substantially. Adopt it only if it reduces payload materially.

## Verification

- Lighthouse installability passes.
- After a first load, a **full offline reload** still boots the app and the viewport.
- The shell is interactive **before** the kernel finishes loading — confirm under throttled network, not on a fast connection.
- The WASM binary is fetched once, then served from cache on subsequent loads.

## Constraints

Invariant 7 still holds: **do not pull in `SharedArrayBuffer` or cross-origin isolation** as part of this work. If threaded OCCT is ever adopted, the COOP/COEP headers — or a service-worker COEP shim on a static host — become a separate, deliberate task. See [`../risks.md`](../risks.md).
