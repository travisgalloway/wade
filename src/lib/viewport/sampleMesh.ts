// Loads the Phase 1 sample asset (see scripts/make-sample-part.ts) into a render-ready,
// indexed BufferGeometry.
//
// Shaped as a seam (invariant 4): this returns a plain geometry payload, not a three.js Mesh tied
// to a particular material, so that in Phase 2 a `MeshPayload` produced by `KernelClient` (see
// `src/lib/kernel/types.ts` — that's the kernel's wire type now; this one was renamed to
// `SampleMesh` to free the name up, issue #23) can be swapped in behind the same `{ geometry }`
// shape without touching the render path in Viewport.svelte.
import { base } from '$app/paths';
import type { BufferGeometry } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface SampleMesh {
	geometry: BufferGeometry;
}

const SAMPLE_PART_URL = `${base}/models/sample-part.stl`;

/**
 * STLLoader yields a non-indexed triangle soup (STL has no concept of shared vertices), so this
 * runs it through `mergeVertices()` to weld coincident vertices into an indexed BufferGeometry —
 * satisfying issue #48's "all viewport geometry is indexed" requirement — then recomputes vertex
 * normals across the now-shared vertices for correct smooth shading.
 *
 * The asset itself is authored Y-up (scripts/make-sample-part.ts predates this app choosing an
 * up axis), so it is rotated onto Z-up here, at the boundary, rather than regenerating the
 * committed STL — see viewport/orientation.ts. The kernel's own meshes need no such rotation:
 * OCCT is already right-handed Z-up, which is exactly why that convention was chosen.
 */
export async function loadSampleMesh(): Promise<SampleMesh> {
	const loader = new STLLoader();
	const raw = await loader.loadAsync(SAMPLE_PART_URL);

	const geometry = mergeVertices(raw);
	geometry.rotateX(Math.PI / 2); // the asset's +Y (up) -> this world's +Z (up)
	geometry.computeVertexNormals();

	return { geometry };
}
