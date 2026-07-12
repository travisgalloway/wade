// Loads the Phase 1 sample asset (see scripts/make-sample-part.ts) into a render-ready,
// indexed BufferGeometry.
//
// Shaped as a seam (invariant 4): this returns a plain geometry payload, not a three.js Mesh tied
// to a particular material, so that in Phase 2 a `MeshPayload` produced by `KernelClient` can be
// swapped in behind the same `{ geometry }` shape without touching the render path in
// Viewport.svelte.
import { base } from '$app/paths';
import type { BufferGeometry } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface MeshPayload {
	geometry: BufferGeometry;
}

const SAMPLE_PART_URL = `${base}/models/sample-part.stl`;

/**
 * STLLoader yields a non-indexed triangle soup (STL has no concept of shared vertices), so this
 * runs it through `mergeVertices()` to weld coincident vertices into an indexed BufferGeometry —
 * satisfying issue #48's "all viewport geometry is indexed" requirement — then recomputes vertex
 * normals across the now-shared vertices for correct smooth shading.
 */
export async function loadSampleMesh(): Promise<MeshPayload> {
	const loader = new STLLoader();
	const raw = await loader.loadAsync(SAMPLE_PART_URL);

	const geometry = mergeVertices(raw);
	geometry.computeVertexNormals();

	return { geometry };
}
