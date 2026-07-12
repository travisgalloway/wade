// One-off generator for the Phase 1 sample asset. Not part of the app build — run manually with
// `node scripts/make-sample-part.ts` whenever the bracket geometry needs to change, then commit
// the regenerated static/models/sample-part.stl.
//
// STL (not glTF) is deliberate: brepjs's importSTL() can ingest this same file in Phase 2, so the
// sample asset carries forward past the render-core PR instead of being throwaway.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	BoxGeometry,
	BufferGeometry,
	CylinderGeometry,
	Mesh,
	MeshStandardMaterial,
	Object3D
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Vec3 = [number, number, number];

/** Bakes a local position/rotation into a primitive's vertices so plain `mergeGeometries` can combine it with the rest of the part. */
function place(
	geometry: BufferGeometry,
	position: Vec3,
	rotation: Vec3 = [0, 0, 0]
): BufferGeometry {
	const proxy = new Object3D();
	proxy.position.set(...position);
	proxy.rotation.set(...rotation);
	proxy.updateMatrix();
	geometry.applyMatrix4(proxy.matrix);
	return geometry;
}

// An asymmetric L-bracket: a base plate, a single upright wall (only one side, unlike a
// symmetric U-channel), an off-center diagonal gusset, and two mounting bosses of different
// sizes in different corners. Asymmetric enough that "centered and framed" and picking are
// visibly meaningful from any orbit angle — nothing here is a plane or point of symmetry.
const HALF_PI = Math.PI / 2;

const parts: BufferGeometry[] = [
	// Base plate, top face at y = 0.
	place(new BoxGeometry(120, 8, 70), [0, -4, 0]),

	// Upright wall at the left end only.
	place(new BoxGeometry(8, 90, 70), [-56, 45, 0]),

	// Diagonal gusset bracing the wall, offset toward the back (+z), not centered.
	place(new BoxGeometry(6, 50, 16), [-40, 22, 22], [0, 0, Math.PI / 4]),

	// Primary mounting boss, sticking out from the outward face of the wall near the top,
	// offset toward the front (-z).
	place(new CylinderGeometry(10, 10, 14, 24), [-67, 65, -18], [0, 0, HALF_PI]),

	// Secondary mounting boss, smaller, standing up from the base plate near the right end.
	place(new CylinderGeometry(6, 6, 10, 24), [40, 5, -25])
];

const merged = mergeGeometries(parts, false);
if (!merged) {
	throw new Error('mergeGeometries returned null — check that all primitives share attributes');
}

const indexed = mergeVertices(merged);
indexed.computeVertexNormals();

const mesh = new Mesh(indexed, new MeshStandardMaterial());
mesh.updateMatrixWorld(true);

const exporter = new STLExporter();
const stl = exporter.parse(mesh, { binary: true }) as DataView;

const outPath = resolve(__dirname, '../static/models/sample-part.stl');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.from(stl.buffer, stl.byteOffset, stl.byteLength));

console.log(`Wrote ${outPath} (${indexed.attributes.position.count} vertices, indexed)`);
