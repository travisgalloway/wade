# Web CAD PWA Architecture Scope

## Decisions locked in

- **Framework** SvelteKit run as a client-side SPA (not SSR)
- **Geometry kernel** brepjs on OpenCascade compiled to WASM
- **Renderer** three.js WebGPU (`three/webgpu`, WebGPURenderer)
- **Delivery** installable PWA, offline-capable
- **Primary target** desktop, with automatic WebGL2 fallback for coverage
- **Overhead goals** cut render-loop cost, keep the WASM kernel off the main thread, keep the framework layer thin, and shrink startup and WASM load

## Threading model (the spine)

Everything else hangs off getting this right. Three separable execution contexts.

| Context | Owns | Never does |
|---|---|---|
| Main thread | SvelteKit UI, panels, input, render orchestration | Heavy geometry math, continuous redraw |
| Kernel worker | brepjs + OCCT-WASM, booleans, fillets, tessellation | Touch the DOM |
| Render (main, or a render worker via OffscreenCanvas) | three.js WebGPU scene, GPU uploads, drawing | Block on kernel work |

Data flow is one direction. A UI intent goes to the kernel worker, the worker computes exact B-rep and tessellates only what changed, then transfers mesh buffers (positions, normals, indices as typed arrays) back using Transferable objects for zero-copy handoff. The render side uploads those buffers to the GPU and requests exactly one frame.

Wrap the kernel worker with Comlink so the main thread calls it like a normal async API instead of hand-writing postMessage plumbing.

## Axis 1, viewport render loop and GPU cost

The single biggest win, and it is not optional for CAD.

- **On-demand rendering.** A CAD scene is static until the user acts. Do not run a continuous requestAnimationFrame loop. Render one frame only when the camera moves, a solid changes, or a transient interaction is active. In Threlte set `renderMode="manual"` and call `invalidate()`. In vanilla three.js, drop `setAnimationLoop` and call `renderer.renderAsync()` from an invalidate flag.
- **WebGPU binding model** already lowers CPU draw-call overhead versus WebGL, which is the main reason WebGPU helps here rather than raw shader speed.
- **Batch and instance.** Use InstancedMesh or BatchedMesh for repeated hardware like bolts and fasteners, and indexed BufferGeometry everywhere. This collapses draw calls.
- **Re-tessellate only changed solids**, never the whole assembly, on each parametric edit.
- **Cap pixel ratio.** Retina desktop panels report devicePixelRatio 2. Clamp with `setPixelRatio(Math.min(devicePixelRatio, 2))`, drop to 1.5 if you want more headroom.
- **Keep post-processing minimal.** If you need selection outlines or SSAO, use the WebGPU-native RenderPipeline node stack, not the legacy EffectComposer, which WebGPURenderer does not support.
- **Picking and snapping** run CPU-side through three-mesh-bvh on the BufferGeometry, independent of the renderer, so this stays cheap and precise.

## Axis 2, main-thread blocking from the WASM kernel

- **Run brepjs and OCCT entirely in the kernel worker.** No kernel call ever executes on the main thread.
- **Transfer, do not clone.** Return meshes as typed arrays marked Transferable so there is no structured-clone copy cost on large parts.
- **Debounce and cancel.** During slider drags on a parametric value, debounce kernel calls and cancel stale jobs so the worker is not computing geometry the user already moved past.
- **Threading tradeoff.** The multithreaded OCCT build is faster but needs SharedArrayBuffer, which requires cross-origin isolation (COOP same-origin, COEP require-corp). Start with the single-threaded build to avoid that constraint, and move to threaded only if meshing shows up as a bottleneck. If you go threaded on a static host, a service-worker shim can inject the COEP header.

## Axis 3, framework and DOM layer

SvelteKit is already the right tool here, since Svelte compiles away and carries no virtual DOM. The work is keeping 3D out of reactivity.

- **Client-side SPA.** Set `ssr = false` and `prerender` the shell, use `adapter-static`. SSR gives you nothing when the app is one big GPU surface.
- **The canvas is imperative, not reactive.** One Canvas component owns the renderer and scene directly. Svelte state drives only the UI panels and the feature tree, never the per-frame render path. Never bind reactive state that would re-run Svelte work every frame.
- **Svelte 5 runes** give fine-grained updates. Keep geometry in the worker and on the GPU, and hold only lightweight view models in `$state`.
- **Virtualize** long panels like the feature or assembly tree, and apply CSS containment to isolate layout.
- **Threlte** is the natural Svelte integration for three.js and supports the WebGPU renderer plus manual render mode. Use it for ergonomics, or go vanilla three.js in a single component if you want absolute control and the thinnest possible layer.

## Axis 4, startup and WASM load size

The OCCT binary is the heavy item, on the order of 15MB before trimming.

- **Lazy-load the kernel.** Paint the shell and viewport first, then spin up the kernel worker in the background. The app should feel interactive before OCCT finishes loading.
- **Ship a slim OCCT build.** OpenCascade custom builds let you include only the modules brepjs actually calls, which cuts the binary substantially.
- **Stream and compress.** Serve the WASM with Brotli and instantiate with `WebAssembly.instantiateStreaming`.
- **Cache once.** Precache the app shell and runtime-cache the WASM with a CacheFirst, versioned strategy in the service worker, so after first load it is instant and available offline.
- **Code-split** the renderer and kernel so neither is in the initial bundle.

## three.js WebGPU specifics

- Import from `three/webgpu`. WebGPURenderer has been production-ready since r171 and defaults to a WebGPU backend with automatic WebGL2 fallback, so desktop coverage is roughly 95 percent with the rest degrading gracefully.
- **Initialization is async.** Await `renderer.init()` (or use `renderAsync`) before your first frame. This interacts with OffscreenCanvas and worker setup, so plan the boot sequence around it.
- **Shaders are TSL.** Node materials and TSL replace GLSL. ShaderMaterial, RawShaderMaterial, and onBeforeCompile are not supported on this renderer, so any custom shading is authored in TSL, which also compiles to the WebGL2 fallback.
- **Benchmark honestly.** The renderer is still labelled experimental and some scenes are still faster on WebGL. Keep the `forceWebGL` escape hatch wired to a setting so you can compare on real hardware.
- **Render-in-worker** with OffscreenCanvas is supported on desktop Chromium and frees the main thread entirely from drawing. Treat it as a phase-two lever and verify behavior on your non-Chromium fallback targets.

## PWA setup

- `@vite-pwa/sveltekit` (Workbox under the hood) for the manifest, service worker, and caching
- `adapter-static` with `ssr = false` on the app route, shell prerendered
- Caching, precache the shell, CacheFirst for the versioned WASM, NetworkFirst for any API
- Web app manifest with icons and standalone display for installability
- If you adopt threaded OCCT later, add the cross-origin isolation headers or the service-worker COEP shim

## Recommended stack

| Concern | Pick |
|---|---|
| Framework | SvelteKit, SPA mode, Svelte 5 runes |
| 3D integration | Threlte (or vanilla three.js) |
| Renderer | three.js WebGPU with WebGL2 fallback |
| Kernel | brepjs + OCCT-WASM in a worker |
| Worker RPC | Comlink |
| Picking | three-mesh-bvh |
| PWA | @vite-pwa/sveltekit + Workbox |

## Suggested build phases

1. **Viewport MVP.** SvelteKit SPA shell, WebGPU canvas, load and render a mesh, OrbitControls, on-demand rendering, BVH picking, transform gizmo.
2. **Kernel wired in.** brepjs in a worker behind a small kernel interface of your own, render a parametric primitive you can tweak, transfer meshes zero-copy.
3. **PWA hardening.** Service worker, WASM caching, offline shell, install manifest, lazy kernel load.
4. **CAD depth.** Sketches and constraints, booleans and fillets, STEP import and export, feature tree.

## Open risks worth tracking

- **brepjs is young and single-maintainer.** Hide it behind your own kernel interface so you can swap in replicad or raw OCCT without touching the UI.
- **WebGPU still maturing.** Keep the WebGL2 fallback path exercised, not just theoretical.
- **Cross-origin isolation** only becomes a concern if you go multithreaded, so defer that decision.
