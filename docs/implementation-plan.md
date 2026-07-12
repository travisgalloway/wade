# Implementation Plan for Claude Code
## CAD PWA, SvelteKit + brepjs + three.js WebGPU

This plan pairs with `cad-pwa-scope.md`. That doc holds the reasoning, this doc is the executable build order. Read the scope once, then work from this.

---

## How to use this plan

You are building the app phase by phase. Rules of engagement.

- Complete phases in order. Do not start a phase until the previous phase passes its verification checklist.
- Commit at the end of each phase with a clear message, and keep commits small within a phase.
- Keep every component small and single-purpose. Prefer many small files over few large ones.
- The architectural invariants below are non-negotiable. If a task seems to require breaking one, stop and flag it rather than working around it.
- Before installing any dependency, check its current version and API rather than trusting a version pinned in this document. The versions here are guidance, not gospel.
- After each phase, run the build and the dev server and confirm the verification items yourself before reporting the phase done.

---

## Stack

Verify latest stable versions at install time.

- SvelteKit with Svelte 5 (runes), TypeScript
- `@sveltejs/adapter-static`, app runs as a client-side SPA
- three.js imported from `three/webgpu` (WebGPURenderer)
- Threlte (`@threlte/core`, `@threlte/extras`) for the Svelte three.js integration
- brepjs plus its OpenCascade package for the geometry kernel
- Comlink for the kernel worker RPC
- three-mesh-bvh for CPU-side picking
- `@vite-pwa/sveltekit` (Workbox) for the PWA layer
- Pointer Events API for unified pen, touch, and mouse input, arbiter hand-rolled to start
- Vitest for unit tests, Playwright for a viewport smoke test
- ESLint and Prettier

---

## Architectural invariants

These must hold at every phase. Treat a violation as a build break.

1. **The kernel runs only in a Web Worker.** No brepjs or OCCT call ever executes on the main thread.
2. **Rendering is on-demand.** No continuous animation loop. The renderer draws only when the camera moves, a solid changes, or a transient interaction is active. In Threlte this is `renderMode="manual"` plus `invalidate()`.
3. **The canvas is imperative, not reactive.** Svelte reactive state drives UI panels only. Geometry and per-frame state never live in `$state` that would re-run on each frame.
4. **The kernel sits behind our own interface.** All UI and render code talks to a `KernelClient` abstraction, never to brepjs directly, so the kernel can be swapped later.
5. **WebGPU initializes async, with a WebGL2 escape hatch.** Await renderer init before the first frame. Expose a `forceWebGL` setting wired to a runtime toggle for benchmarking and fallback.
6. **Meshes cross the worker boundary as transferable typed arrays.** Positions, normals, indices are transferred, never structurally cloned.
7. **Start single-threaded on OCCT.** Do not pull in SharedArrayBuffer or cross-origin isolation. That decision is deferred to a later, separate task.
8. **Navigation and editing never share a gesture.** Multi-finger input drives the camera, single-pointer input selects and manipulates, and a pen is the precise create-and-edit channel. The gesture arbiter locks the mode on the first movement and holds it until release.
9. **Precision comes from snapping and typed values, not steady fingers.** Move and resize are driven by gestures plus snapping and inference, never by demanding a precise drag on a small handle.

---

## Interaction and input model

Traditional desktop CAD assumes a precise pointer, hover, a scroll wheel, and modifier keys. This app is desktop-first but must not emulate a mouse on touch, which is exactly what makes ported CAD feel wrong. The model separates who does what by input channel and makes precision forgiving rather than demanded.

Principles.

- **Separate navigation from editing.** Multi-finger touch drives the camera, orbit, pan, and zoom. Single-pointer input selects and manipulates. A pen, when present, is the precise create-and-edit channel. The same gesture never carries two meanings.
- **Lock the mode on first move.** The gesture arbiter reads the opening motion, chooses navigate or manipulate, and holds it until release, so orbit, pan, and select never blend mid-drag.
- **Snapping and inference are a core system, not polish.** Precision comes from snapping to vertices, edges, and guides, and from inferring constraints on the fly, so a coarse fingertip still lands exactly.
- **No dependence on tiny handles.** Move and resize use gestures that encode the axis or plane and the operation, backed by snapping, rather than grabbing small gizmo handles. A large, touch-sized gizmo is fine, precise-handle dragging is not.
- **The tool follows the selection.** Selecting an edge offers a fillet, selecting a face offers push-pull, which removes the toolbar hunting that is painful on touch.
- **Beat occlusion.** Offset the active point above the fingertip, and use contextual radial menus at the point of action rather than distant toolbars.
- **Exact values by selection then entry.** Set intent with a tap, set the number with a field, rather than demanding a precise drag.

Desktop-first means the mouse and trackpad paths stay primary, but every viewport interaction is built on Pointer Events so pen and touch are first-class from day one rather than retrofitted later.

---

## Target structure

```
src/
  lib/
    kernel/
      kernel.worker.ts      # brepjs + OCCT, Comlink-exposed
      KernelClient.ts        # main-thread interface, the only kernel entry point
      types.ts               # MeshPayload, KernelRequest, KernelResult
    viewport/
      Viewport.svelte        # owns the Threlte Canvas + renderer
      renderLoop.ts          # invalidate + on-demand orchestration
      picking.ts             # three-mesh-bvh raycasting
      gizmo.ts               # transform controls
    input/
      pointerRouter.ts       # branch on pointerType pen/touch/mouse
      gestureArbiter.ts      # lock nav vs edit mode on first move
      snapping.ts            # snap targets and constraint inference hooks
      radialMenu.svelte      # contextual command menu at point of action
    scene/
      SceneModel.ts          # lightweight view models, not geometry
    ui/                      # panels, tree, toolbars (reactive)
    pwa/                      # manifest, sw registration helpers
  routes/
    +layout.ts              # ssr = false, prerender
    +page.svelte            # app shell
static/                     # icons, manifest assets
tests/
```

---

## Phase 0, project foundation

Tasks
- Scaffold SvelteKit with TypeScript, Svelte 5.
- Install and configure `adapter-static`. Set `ssr = false` and `prerender = true` in the root layout. Confirm SPA output.
- Add ESLint, Prettier, Vitest, Playwright.
- Add a placeholder route that renders a full-viewport container.

Verification
- `pnpm build` produces a static SPA with no SSR.
- `pnpm dev` serves the shell.
- Lint, format, and an empty test run all pass.

---

## Phase 1, viewport MVP

Goal, a WebGPU viewport that renders a mesh, orbits, picks, and transforms, drawing only on demand. No kernel yet, load a static asset (glTF or STL).

Tasks
- Build `Viewport.svelte` using Threlte with a WebGPU renderer via the `createRenderer` factory, `forceWebGL: false`. Handle async init.
- Set `renderMode="manual"`. Implement `renderLoop.ts` so `invalidate()` is called on camera change, resize, and model change only.
- Add OrbitControls, wire them to `invalidate()`.
- Load and display a sample mesh. Center and frame it.
- Cap pixel ratio at `Math.min(devicePixelRatio, 2)`.
- Implement `picking.ts` with three-mesh-bvh, hover and click selection. Offset the active pick point slightly above the pointer so a fingertip does not occlude the target.
- Add the input layer. `pointerRouter.ts` branches on `pointerType`, so pen is precise create and edit, touch is navigation, and mouse is the desktop path. Set `touch-action: none` on the canvas so the app owns every gesture.
- Add `gestureArbiter.ts`. It decides navigation versus manipulation from the first pointer movement and locks that mode until pointerup, so orbit, pan, and select never blend. Multi-finger input drives the camera, single-pointer input selects or manipulates.
- Add a transform gizmo for the selected object, sized for touch, with a widget-less path noted for Phase 4.
- Add a settings store with a `forceWebGL` toggle that recreates the renderer.

Verification
- The scene renders and orbits smoothly, and a GPU frame is issued only on interaction, confirmed by logging render calls.
- Selection and gizmo work.
- Touch, pen, and mouse all work. Multi-finger orbits and pans, a single tap selects, and the two never fire together.
- A gesture that starts as an orbit stays an orbit until release.
- Toggling `forceWebGL` switches backends without other regressions.
- Confirm WebGPU is active by default in a Chromium browser, and the WebGL2 fallback renders when forced.

---

## Phase 2, kernel worker

Goal, brepjs runs in a worker behind `KernelClient`, and the viewport renders a live parametric primitive.

Tasks
- Create `kernel.worker.ts` that loads brepjs with the single-threaded OCCT build and exposes an API over Comlink (for example `makeBox(params)`, `tessellate(shapeId)`).
- Define `types.ts` with a `MeshPayload` of transferable typed arrays.
- Implement `KernelClient.ts` as the sole main-thread entry point. It calls the worker, receives transferable meshes, and hands them to the viewport.
- Render a parametric box or cylinder driven by UI controls. On parameter change, call the kernel, receive the new mesh, upload, and `invalidate()` once.
- Debounce parameter changes and cancel superseded kernel jobs so the worker is never computing stale geometry.
- Re-tessellate only the changed solid.
- Stand up `snapping.ts` with snapping to vertices, edges, and a grid, so precise placement does not demand a precise fingertip. This is the foundation the Phase 4 interactions build on.

Verification
- Dragging a parameter slider updates the solid with no main-thread jank, confirmed by an unblocked UI during recompute.
- No brepjs symbol is reachable from the main thread except through `KernelClient`.
- Meshes are transferred, verified by checking the source buffer is detached after send.

---

## Phase 3, PWA hardening

Goal, installable, offline-capable, fast to first interaction, kernel loaded lazily.

Tasks
- Add `@vite-pwa/sveltekit`. Generate the manifest with icons and standalone display.
- Configure Workbox, precache the app shell, runtime-cache the OCCT WASM with a CacheFirst, versioned strategy, NetworkFirst for any future API.
- Lazy-load the kernel worker after first paint so the shell and viewport are interactive before OCCT finishes downloading. Show a non-blocking kernel-loading state.
- Serve WASM with streaming instantiation, confirm Brotli at the host layer.
- Investigate a slim OCCT build that includes only the modules brepjs uses, and adopt it if it reduces payload materially.
- Add an install prompt via `beforeinstallprompt`.

Verification
- Lighthouse installability passes.
- After first load, a full offline reload still boots the app and viewport.
- The shell is interactive before the kernel finishes loading, confirmed by throttled-network testing.
- The WASM binary is served once then served from cache on subsequent loads.

---

## Phase 4, CAD depth

Larger and open-ended, break into sub-tasks as you go. Keep the same invariants.

Tasks
- Feature tree UI backed by a document model, virtualized list.
- Boolean operations and fillets through the kernel.
- 2D sketching layer, then a constraint solver, with common constraints (tangency, perpendicularity, concentricity, parallelism, symmetry) inferred on the fly as the user sketches, not only applied after.
- STEP import and export through the kernel.
- Undo and redo on the document model, not on geometry.
- Selection outline via the WebGPU-native RenderPipeline node post-processing, kept minimal.
- Predictive command surface. Selecting an edge offers a fillet, selecting a face offers push-pull or offset, so the tool follows the selection instead of living in a toolbar.
- Contextual radial menu at the point of interaction, in place of fixed toolbars where it suits touch.
- Widget-less constrained transforms. Encode the axis or plane and the operation into the gesture, backed by snapping and axis borrowing, so move and resize do not depend on grabbing a small handle.
- Dimension by selection. Tapping a line pops a length field and tapping between elements pops a distance field, rather than a formal dimensioning mode.
- View snapping. Double-tap a face to square the camera to it, replacing precise manual orbit.

Verification
- Each operation recomputes only affected geometry.
- Round-trip a STEP file in and back out.
- The feature tree stays responsive at a few hundred features.

---

## Cross-cutting requirements

- **State architecture.** A document model holds parametric definitions and history. The GPU holds meshes. Svelte holds view models. These three never merge.
- **Error handling.** Kernel operations return typed results, surfaced as recoverable UI errors, never thrown across the worker boundary uncaught.
- **Performance budget.** Track first-interaction time and idle GPU frames. A regression that reintroduces a continuous render loop fails review.
- **Input and precision.** Design multitouch for navigation and coarse manipulation, and treat a pen or pointer as the first-class channel for precise work. Precision comes from snapping and typed values, not steady fingers.
- **Testing.** Unit-test `KernelClient`, the gesture arbiter, and the document model with Vitest. One Playwright smoke test boots the app and confirms a rendered frame.

---

## Risks and deferred decisions

- **Threaded OCCT.** Revisit only if meshing is a measured bottleneck. It requires cross-origin isolation, so it is a deliberate separate task, not an incidental change.
- **brepjs maturity.** It is young and single-maintainer, which is exactly why invariant 4 exists. Keep the surface you use small.
- **WebGPU maturity.** Keep the WebGL2 fallback exercised in CI or manual testing, not just theoretically available.
- **Touch precision ceiling.** Fingertips occlude and lack precision, a known limit of touch CAD. Mitigate with snapping, inference, offset picking, and typed values, and do not promise mouse-level precision from bare touch.
