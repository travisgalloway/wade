# Phase 4 — CAD depth

**Status: not started. Open-ended.**

Larger than the phases before it — break it into sub-tasks as you go. The [invariants](../architecture/invariants.md) hold unchanged.

Much of this phase is where the [interaction model](../architecture/input.md) finally pays off. The snapping foundation shipped in Phase 2 specifically so these interactions would have something to stand on.

## Kernel and document

- **Feature tree UI** backed by a document model, virtualized list.
- **Boolean operations and fillets** through the kernel.
- **2D sketching layer**, then a constraint solver — with common constraints (tangency, perpendicularity, concentricity, parallelism, symmetry) **inferred on the fly as the user sketches**, not merely applied afterward.
- **STEP import and export** through the kernel.
- **Undo and redo on the document model, not on geometry.** This is the reason the document model exists as a separate thing — see [`../architecture/state-and-errors.md`](../architecture/state-and-errors.md).

## Interaction

These are the touch-first ideas the input model was designed around:

- **Predictive command surface.** Selecting an edge offers a fillet; selecting a face offers push-pull or offset. The tool follows the selection instead of living in a toolbar.
- **Contextual radial menu** at the point of interaction, in place of fixed toolbars where it suits touch.
- **Widget-less constrained transforms.** Encode the axis or plane _and_ the operation into the gesture, backed by snapping and axis borrowing — so move and resize never depend on grabbing a small handle (invariant 9).
- **Dimension by selection.** Tapping a line pops a length field; tapping between elements pops a distance field. No formal dimensioning mode.
- **View snapping.** Double-tap a face to square the camera to it, replacing precise manual orbit.

## Rendering

- **Selection outline** via the WebGPU-native RenderPipeline node post-processing. Keep it minimal — and remember the legacy `EffectComposer` is not an option on `WebGPURenderer`. See [`../architecture/rendering.md`](../architecture/rendering.md#shaders-are-tsl-this-is-a-hard-constraint).

## Verification

- Each operation recomputes **only affected geometry**.
- Round-trip a STEP file in and back out.
- The feature tree stays responsive at a few hundred features.
