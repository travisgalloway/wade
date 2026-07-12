// Converts a kernel `MeshPayload` into a render-ready `BufferGeometry` (issue #24). `three` only —
// no brepjs — so this is safe for `KernelClient`'s callers to import on the main thread without
// tripping the invariant-1 ESLint rule. Kept as its own module (rather than folded into
// `KernelClient.ts`) because `KernelClient` itself must stay `three`-free to unit-test in the
// Node-only Vitest project with no DOM/WebGL shim.
import { BufferAttribute, BufferGeometry } from 'three';
import type { MeshPayload } from './types';

/**
 * Builds an indexed `BufferGeometry` from a `MeshPayload`. Indexed *by construction* — `setIndex`
 * is always called — so the viewport's `allGeometriesIndexed()` invariant (issue #48) holds for
 * kernel-produced geometry with no extra `mergeVertices` pass, unlike the STL-sourced sample mesh.
 */
export function toBufferGeometry(payload: MeshPayload): BufferGeometry {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(payload.positions, 3));
	geometry.setAttribute('normal', new BufferAttribute(payload.normals, 3));
	geometry.setIndex(new BufferAttribute(payload.indices, 1));
	return geometry;
}
