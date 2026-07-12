<script lang="ts">
	// Lives inside <Canvas> (mounted by Viewport.svelte), so `useThrelte()` and Threlte's own
	// context hooks are available here. Owns the camera, lights, orbit controls, and the sample
	// mesh. The geometry/camera references below are load-once, not per-frame (invariant 3) —
	// nothing here is written to on every tick.
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls, useOrbitControls } from '@threlte/extras';
	import { Box3, type BufferGeometry, type PerspectiveCamera } from 'three';
	import { MeshStandardNodeMaterial } from 'three/webgpu';
	import { frameBox } from './framing';
	import { invalidateFor } from './renderLoop';
	import { loadSampleMesh } from './sampleMesh';

	const { invalidate } = useThrelte();
	const orbitControls = useOrbitControls();

	let camera = $state.raw<PerspectiveCamera>();
	let geometry = $state.raw<BufferGeometry>();

	const material = new MeshStandardNodeMaterial({
		color: 0x9fb4c7,
		roughness: 0.55,
		metalness: 0.1
	});

	$effect(() => {
		let cancelled = false;

		loadSampleMesh().then(({ geometry: loaded }) => {
			if (cancelled) return;

			geometry = loaded;
			invalidateFor(invalidate, 'model');

			if (!camera) return;

			loaded.computeBoundingBox();
			const box = loaded.boundingBox ?? new Box3();
			const { position, target } = frameBox({ box, fovDegrees: camera.fov, aspect: camera.aspect });

			camera.position.copy(position);
			const controls = orbitControls.current;
			if (controls) {
				controls.target.copy(target);
				controls.update();
			} else {
				camera.lookAt(target);
			}
			invalidateFor(invalidate, 'camera');
		});

		return () => {
			cancelled = true;
		};
	});
</script>

<T.PerspectiveCamera
	makeDefault
	bind:ref={camera}
	position={[6, 4.5, 6]}
	fov={50}
	near={0.1}
	far={2000}
>
	<OrbitControls />
</T.PerspectiveCamera>

<T.HemisphereLight intensity={0.75} groundColor={0x3a3a3a} />
<T.DirectionalLight position={[6, 10, 4]} intensity={1.4} />

{#if geometry}
	<T.Mesh {geometry} {material} />
{/if}
