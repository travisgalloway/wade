import { describe, expect, it } from 'vitest';
import {
	BufferGeometry,
	Float32BufferAttribute,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	Vector3
} from 'three';
import {
	allGeometriesIndexed,
	BOLT_POSITIONS,
	buildBoltGeometry,
	createBoltInstances
} from './instancing';

describe('buildBoltGeometry', () => {
	it('produces an indexed BufferGeometry (issue #48)', () => {
		const geometry = buildBoltGeometry();
		expect(geometry.index).not.toBeNull();
		expect(geometry.attributes.position).toBeDefined();
		expect(geometry.attributes.normal).toBeDefined();
	});
});

describe('createBoltInstances', () => {
	it('creates one InstancedMesh whose count matches the position list, not N separate meshes', () => {
		const material = new MeshBasicMaterial();
		const instanced = createBoltInstances(BOLT_POSITIONS, material);

		expect(instanced.count).toBe(BOLT_POSITIONS.length);
		expect(BOLT_POSITIONS.length).toBeGreaterThan(1);
	});
});

describe('allGeometriesIndexed', () => {
	it('is true when every mesh in the given roots has an indexed geometry', () => {
		const indexed = buildBoltGeometry();
		const mesh = new Mesh(indexed, new MeshBasicMaterial());

		expect(allGeometriesIndexed([mesh])).toBe(true);
	});

	it('fails when any mesh has a null index — the regression this guard exists to catch', () => {
		const nonIndexed = new BufferGeometry();
		nonIndexed.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
		const badMesh = new Mesh(nonIndexed, new MeshBasicMaterial());

		expect(nonIndexed.index).toBeNull();
		expect(allGeometriesIndexed([badMesh])).toBe(false);
	});

	it('checks nested children via traverse, not just the root object', () => {
		const nonIndexed = new BufferGeometry();
		nonIndexed.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
		const badMesh = new Mesh(nonIndexed, new MeshBasicMaterial());

		const group = new Object3D();
		group.add(badMesh);

		expect(allGeometriesIndexed([group])).toBe(false);
	});
});

// Sanity check that the fastener pattern is actually a *pattern* (more than one bolt) — otherwise
// the "single draw call" claim would be trivially true for an uninteresting reason.
describe('BOLT_POSITIONS', () => {
	it('describes more than one instance', () => {
		expect(BOLT_POSITIONS.length).toBeGreaterThan(1);
		expect(new Vector3().distanceTo(BOLT_POSITIONS[0])).toBeGreaterThan(0);
	});
});
