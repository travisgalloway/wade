// Touch-sized transform gizmo (issue #19). The `<TransformControls>` element itself lives in
// Scene.svelte (Threlte components must be mounted as children of <Canvas>) — this module holds
// the sizing constant and stays the one place that documents the gizmo's constraints.
//
// Widget-less constrained transforms (typed/snapped values instead of a dragged handle, per
// architecture issue #1's "precision comes from snapping and typed values, not steady fingers")
// are planned for Phase 4 and are deliberately NOT implemented here — #19's acceptance criteria are
// only "appears on selection" and "dragging transforms the object."

/**
 * three.js's default `TransformControls` handle size is `1`, sized for a mouse cursor. Invariant 9
 * ("no dependence on tiny handles") requires touch-sized targets, so this scales the whole gizmo
 * helper up noticeably.
 */
export const GIZMO_SIZE = 2;
