# Phase 4 — CAD depth

**Status: not started. Open-ended.**

Larger than the phases before it — break it into sub-tasks as you go. The [invariants](../architecture/invariants.md) hold unchanged.

Much of this phase is where the [interaction model](../architecture/input.md) finally pays off. The snapping foundation shipped in Phase 2 specifically so these interactions would have something to stand on.

## Manipulating objects

The two control surfaces — a DOM inspector for exact values, the gizmo for direct manipulation — are designed in [`../architecture/ui-controls.md`](../architecture/ui-controls.md). Both write through the document model's command API.

- **P4-1a — In-house control kit.** `src/lib/ui/controls/` (native `NumberField` with drag-scrub, `Slider`, `Section`, `Toggle`) + `tokens.css`. A headless Svelte-5 lib (Bits UI / Melt UI) is pulled in only for the hard widgets — drag-scrub focus behaviour, popovers/menus, and the feature tree — not the common case.
- **P4-1 — `SceneModel.selectedId`.** A `three`-free selected-object id (read from `mesh.userData.objectId`) so the inspector never imports `three` (invariant 3).
- **P4-2 — Selection-driven inspector.** `InspectorPanel.svelte` generalizes `ParamsPanel`: edits the selected object's params plus typed transform fields, dispatched on `def.kind`. _Depends on: P4-1, P4-1a._
- **P4-3 — Gizmo write-back (move / rotate).** On release, `setTransform` once; a rigid transform never calls the kernel. _Depends on: P3-1, P3-2._
- **P4-4 — Gizmo resize (GPU preview).** Scale previews on the GPU during the drag (no kernel call, no geometry allocation per tick); on release the scale delta becomes clamped params → one debounced re-tessellate. Acceptance: `kernelMeshCount` does not advance during the drag and advances exactly once on release. _Depends on: P4-3._
- **P4-7 — Add / remove objects.** Command-backed add/remove, wiring the worker's currently-unused `dispose(solidId)`. _Depends on: P3-1, P3-2._

## Kernel and document

The [document model](../architecture/document-model.md) and `SolidNode` generalization land in Phase 3 as the enabling refactor; the issues below build on them.

- **Feature tree UI** backed by the document model, virtualized list. (First real use of the headless-lib tree primitive — see [`../architecture/ui-controls.md`](../architecture/ui-controls.md#component-strategy-in-house-kit--a-headless-lib-for-the-hard-parts).)
- **Boolean operations and fillets** through the kernel.
- **2D sketching layer**, then a constraint solver — with common constraints (tangency, perpendicularity, concentricity, parallelism, symmetry) **inferred on the fly as the user sketches**, not merely applied afterward.
- **P4-0 / P4-6 — STEP import and export** through the kernel. Import adds an `importStep` kind to the closed wire contract and a `def.kind: 'imported'` object; it is also the bridge for agent-authored parts. See [`../architecture/agent-api.md`](../architecture/agent-api.md).
- **P4-5 — Undo and redo on the document model, not on geometry.** A `createHistory(doc)` wrapper over the document's command API (`addObject` / `removeObject` / `setParam` / `setTransform`) — additive because every mutation is already one serializable command. This is the reason the document model exists as a separate thing — see [`../architecture/document-model.md`](../architecture/document-model.md#the-mutation-api-is-command-shaped-from-day-one).

## Interaction

These are the touch-first ideas the input model was designed around:

- **Predictive command surface.** Selecting an edge offers a fillet; selecting a face offers push-pull or offset. The tool follows the selection instead of living in a toolbar.
- **Contextual radial menu** at the point of interaction, in place of fixed toolbars where it suits touch.
- **Widget-less constrained transforms.** Encode the axis or plane _and_ the operation into the gesture, backed by snapping and axis borrowing — so move and resize never depend on grabbing a small handle (invariant 9). This is the evolution of the first-cut gizmo in [`../architecture/ui-controls.md`](../architecture/ui-controls.md#the-gizmo-made-real).
- **Dimension by selection.** Tapping a line pops a length field; tapping between elements pops a distance field. No formal dimensioning mode.
- **View snapping.** Double-tap a face to square the camera to it, replacing precise manual orbit.

## Agent integration

Out-of-band, via brepjs's own Node tooling — the agent authors and verifies parts, wade imports the validated result. No live command bus into the browser kernel. Full design in [`../architecture/agent-api.md`](../architecture/agent-api.md).

- **P4-8 — Agent authoring workflow (docs).** Document the local `brep-mcp` loop and the `.brep.ts` contract. No app code — the STEP import path (P4-0 / P4-6) is the wade-side half.
- **P4-9 (deferred) — `brep-script` in-worker executor.** Transpile + evaluate `.brep.ts` in wade's own worker so the agent and the UI share one parametric source. The one delicate item (evaluating TS in the worker); reserve `def.kind: 'brep-script'` now, build the executor only when a parametric round-trip is actually needed. Must stay in the worker (invariant 1), behind `KernelClient` (invariant 4).

## Rendering

- **Selection outline** via the WebGPU-native RenderPipeline node post-processing. Keep it minimal — and remember the legacy `EffectComposer` is not an option on `WebGPURenderer`. See [`../architecture/rendering.md`](../architecture/rendering.md#shaders-are-tsl-this-is-a-hard-constraint).

## Verification

- Each operation recomputes **only affected geometry**.
- A resize drag issues **no kernel job mid-drag and exactly one on release** (`kernelMeshCount`); a move/rotate drag issues **none at all**.
- A gizmo edit then an offline reload restores the object's position, rotation, and dimensions.
- Undo restores the prior param/transform, recomputing only the affected object.
- Round-trip a STEP file in and back out; an agent-authored `.brep.ts` verified with `brep-mcp` imports and renders.
- The feature tree stays responsive at a few hundred features.
