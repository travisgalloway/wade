// Repeated hardware, batched (issue #48). A bolt/fastener pattern is built once as a single
// procedurally-generated indexed BufferGeometry, then drawn through one InstancedMesh so N
// repeated instances cost exactly one GPU draw call — never a call per instance. The geometry is
// generated in-process (two fused CylinderGeometry primitives); no downloaded asset is added.
import {
	CylinderGeometry,
	InstancedMesh,
	Matrix4,
	Mesh,
	Vector3,
	type BufferGeometry,
	type Material,
	type Object3D
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const SHAFT_RADIUS = 3;
const SHAFT_HEIGHT = 8;
const HEAD_RADIUS = 5.5;
const HEAD_HEIGHT = 3;
const HEAD_SEGMENTS = 6; // hex head

/**
 * One bolt: a hex-head cylinder fused to a shaft cylinder. three.js's primitive geometries are
 * already indexed, but `mergeGeometries` + `mergeVertices` welds the two into a single indexed
 * `BufferGeometry` rather than leaving it as an implicit accident of the primitives used.
 */
export function buildBoltGeometry(): BufferGeometry {
	const shaft = new CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_HEIGHT, 16);
	shaft.translate(0, SHAFT_HEIGHT / 2, 0);

	const head = new CylinderGeometry(HEAD_RADIUS, HEAD_RADIUS, HEAD_HEIGHT, HEAD_SEGMENTS);
	head.translate(0, SHAFT_HEIGHT + HEAD_HEIGHT / 2, 0);

	const merged = mergeGeometries([shaft, head], false);
	if (!merged) {
		throw new Error('mergeGeometries returned null building the bolt geometry');
	}

	const indexed = mergeVertices(merged);
	indexed.computeVertexNormals();
	return indexed;
}

/**
 * World-space positions for the bracket's fastener pattern: two rows of three along the base
 * plate, whose 120x70 footprint (see scripts/make-sample-part.ts) is centered on the origin with
 * its top face at y = 0.
 */
export const BOLT_POSITIONS: readonly Vector3[] = [
	new Vector3(-30, 0, -20),
	new Vector3(0, 0, -20),
	new Vector3(30, 0, -20),
	new Vector3(-30, 0, 20),
	new Vector3(0, 0, 20),
	new Vector3(30, 0, 20)
];

/**
 * Builds the bolt pattern as one `InstancedMesh` — one geometry, one material, one draw call
 * regardless of how many positions are supplied (#48's "repeated instances render as a single draw
 * call"). The caller owns disposal of both the returned mesh and its geometry.
 */
export function createBoltInstances(
	positions: readonly Vector3[],
	material: Material
): InstancedMesh {
	const geometry = buildBoltGeometry();
	const instanced = new InstancedMesh(geometry, material, positions.length);

	const matrix = new Matrix4();
	positions.forEach((position, index) => {
		matrix.makeTranslation(position.x, position.y, position.z);
		instanced.setMatrixAt(index, matrix);
	});
	instanced.instanceMatrix.needsUpdate = true;

	return instanced;
}

/**
 * Guard for #48's "all geometry in the viewport uses indexed BufferGeometry": traverses the given
 * roots and reports whether every mesh-like object's geometry has a non-null index. Deliberately
 * scoped to the objects this app adds (the sample part, the bolts) rather than the whole Threlte
 * scene — third-party controls helpers (e.g. TransformControls' gizmo) build their own internal,
 * non-indexed line geometries, which are outside this app's asset pipeline and not what #48 is
 * about. A regression here (e.g. a future asset load that skips mergeVertices) is meant to fail
 * this check, not silently pass.
 */
export function allGeometriesIndexed(roots: readonly Object3D[]): boolean {
	let allIndexed = true;
	for (const root of roots) {
		root.traverse((object) => {
			if ((object as Mesh).isMesh && (object as Mesh).geometry.index === null) {
				allIndexed = false;
			}
		});
	}
	return allIndexed;
}
