<script lang="ts">
	// Lives inside <Canvas> (mounted by Viewport.svelte), so `useThrelte()` and Threlte's own
	// context hooks are available here. Owns the camera, lights, orbit controls, the sample mesh,
	// and now (issues #16-#18) input routing and picking. The geometry/camera references below are
	// load-once, not per-frame (invariant 3) — nothing here is written to on every tick.
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls, TransformControls, useOrbitControls } from '@threlte/extras';
	import {
		Box3,
		TOUCH,
		type BufferGeometry,
		type InstancedMesh,
		type Mesh,
		type Object3D,
		type PerspectiveCamera
	} from 'three';
	import type { TransformControls as TransformControlsImpl } from 'three/examples/jsm/controls/TransformControls.js';
	import { MeshStandardNodeMaterial } from 'three/webgpu';
	import { frameBox } from './framing';
	import { GIZMO_SIZE } from './gizmo';
	import { allGeometriesIndexed, BOLT_POSITIONS, createBoltInstances } from './instancing';
	import { invalidateFor } from './renderLoop';
	import { loadSampleMesh } from './sampleMesh';
	import { buildBoundsTree, installBVHAcceleration, Picker, type PointerKind } from './picking';
	import { PointerRouter, type PointerType } from '$lib/input/pointerRouter';
	import { createSceneModel } from '$lib/scene/SceneModel.svelte';

	// One-time global prototype patch (idempotent) — see picking.ts.
	installBVHAcceleration();

	const { invalidate, dom, size } = useThrelte();
	const orbitControls = useOrbitControls();
	const sceneModel = createSceneModel(invalidate);
	const router = new PointerRouter();
	const picker = new Picker();

	let camera = $state.raw<PerspectiveCamera>();
	let geometry = $state.raw<BufferGeometry>();
	let mesh = $state.raw<Mesh>();
	let boltMesh = $state.raw<InstancedMesh>();
	let transformControls = $state.raw<TransformControlsImpl>();
	let gizmoDragging = $state(false);

	// A stable local binding for the template's {#if} to narrow against, and for the pointer
	// handlers below to read without going through the SceneModel getter twice.
	let selectedObject = $derived(sceneModel.selected);

	const material = new MeshStandardNodeMaterial({
		color: 0x9fb4c7,
		roughness: 0.55,
		metalness: 0.1
	});

	// Distinct finish from the bracket so the repeated hardware (issue #48) reads as separate
	// parts, not more of the bracket itself.
	const boltMaterial = new MeshStandardNodeMaterial({
		color: 0x51565c,
		roughness: 0.35,
		metalness: 0.85
	});

	// Selection/hover feedback is a plain material tweak — no ShaderMaterial/onBeforeCompile, so it
	// stays within the TSL-only constraint. Runs whenever the view-model changes; SceneModel's own
	// setters already invalidated for this transient interaction, so this doesn't invalidate again.
	$effect(() => {
		const isSelected = mesh !== undefined && sceneModel.selected === mesh;
		const isHovered = mesh !== undefined && sceneModel.hovered === mesh;
		if (isSelected) {
			material.emissive.setRGB(0.32, 0.22, 0.02);
		} else if (isHovered) {
			material.emissive.setRGB(0.14, 0.14, 0.14);
		} else {
			material.emissive.setRGB(0, 0, 0);
		}

		// Exposed for the e2e selection test, same pattern as renderCount/backend in renderLoop.ts.
		if (typeof window !== 'undefined' && window.__wade) {
			window.__wade.selected = isSelected;
			window.__wade.hovered = isHovered;
		}
	});

	$effect(() => {
		let cancelled = false;

		loadSampleMesh().then(({ geometry: loaded }) => {
			if (cancelled) return;

			buildBoundsTree(loaded);
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

	// Bolts are procedural (issue #48), so unlike the sample mesh above they need no async load —
	// built once on mount, and it's a legitimate "model changed" invalidation like the mesh load.
	$effect(() => {
		const instanced = createBoltInstances(BOLT_POSITIONS, boltMaterial);
		boltMesh = instanced;
		invalidateFor(invalidate, 'model');

		return () => {
			instanced.geometry.dispose();
		};
	});

	// <TransformControls>'s own autoPauseControls (default true) already disables the registered
	// OrbitControls for as long as `dragging` is true — that alone is what stops a gizmo drag from
	// also orbiting the camera (invariant 8). This listener tracks the same flag locally so the
	// pointer handlers below can treat an in-progress gizmo drag as the `manipulate` gesture it is,
	// instead of reacting to whatever mode the router computed for the underlying mouse/touch drag
	// (see onPointerMove/onPointerRelease).
	$effect(() => {
		const controls = transformControls;
		if (!controls) return;

		const onDraggingChanged = (event: { value: unknown }) => {
			gizmoDragging = Boolean(event.value);
		};
		controls.addEventListener('dragging-changed', onDraggingChanged);
		return () => controls.removeEventListener('dragging-changed', onDraggingChanged);
	});

	// Exposed for e2e (issues #19, #48), same pattern as renderCount/backend in renderLoop.ts.
	$effect(() => {
		if (typeof window === 'undefined' || !window.__wade) return;
		window.__wade.gizmoVisible = selectedObject !== null;
	});

	$effect(() => {
		if (!mesh || !boltMesh) return;
		if (typeof window === 'undefined' || !window.__wade) return;
		window.__wade.boltCount = BOLT_POSITIONS.length;
		window.__wade.allIndexed = allGeometriesIndexed([mesh, boltMesh]);
	});

	function toPointerType(pointerType: string): PointerType {
		if (pointerType === 'pen') return 'pen';
		if (pointerType === 'touch') return 'touch';
		return 'mouse';
	}

	function localPoint(event: PointerEvent): { x: number; y: number } {
		const rect = dom.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function pick(event: PointerEvent, pointerKind: PointerKind): Object3D | null {
		if (!camera || !mesh) return null;
		const { x, y } = localPoint(event);
		const { width, height } = size.current;
		return picker.pick({ x, y, pointerKind, width, height, camera, objects: [mesh] });
	}

	// Invariant 8 (navigation and editing never share a gesture): three.js's OrbitControls treats
	// pen exactly like mouse (both go through its `_onMouseDown` path), which would let a pen drag
	// orbit the camera — pen must always be the precise create/edit channel instead. Registering our
	// own listener on `dom` with `capture: true` guarantees it runs during the capture phase, before
	// OrbitControls' own (bubble-phase) listener on the same element ever sees the event — capture
	// always completes, top-down through ancestors of the real target (the canvas), before bubbling
	// begins, regardless of listener registration order. Calling `stopPropagation()` there for pen
	// pointers means OrbitControls never receives them at all; touch and mouse are left untouched so
	// OrbitControls keeps driving camera navigation for them exactly as it already does (with
	// single-finger touch orbit disabled below, since that must go to selection/manipulation instead).
	function onPointerDown(event: PointerEvent) {
		const pointerType = toPointerType(event.pointerType);
		if (pointerType === 'pen') event.stopPropagation();

		const { x, y } = localPoint(event);
		router.handle({ type: 'down', pointerType, pointer: { pointerId: event.pointerId, x, y } });
	}

	function onPointerMove(event: PointerEvent) {
		const pointerType = toPointerType(event.pointerType);
		if (pointerType === 'pen') event.stopPropagation();

		const { x, y } = localPoint(event);
		const decision = router.handle({
			type: 'move',
			pointerType,
			pointer: { pointerId: event.pointerId, x, y }
		});

		// A gizmo drag is the `manipulate` gesture in progress (invariant 8) — never let it also
		// drive hover picking against the underlying mesh, regardless of what mode the router
		// computed for the mouse/touch drag that's operating the gizmo.
		if (gizmoDragging) return;

		// Hover is only meaningful while nothing has locked to navigate — an active orbit/pan must
		// never also drive hover picking (invariant 8), and this is also what keeps a plain
		// mouse-move-with-no-buttons-down (decision.mode stays null) able to hover at all.
		sceneModel.setHovered(decision.mode === 'navigate' ? null : pick(event, pointerType));
	}

	function onPointerRelease(type: 'up' | 'cancel') {
		return (event: PointerEvent) => {
			const pointerType = toPointerType(event.pointerType);
			if (pointerType === 'pen') event.stopPropagation();

			const decision = router.handle({ type, pointerType, pointerId: event.pointerId });

			// A gizmo drag ending is a manipulate gesture finishing, not a selection click — running
			// the selection pick here (which only tests the bare mesh, not the gizmo) could wrongly
			// deselect the object right after transforming it.
			if (gizmoDragging) return;

			if (type === 'up' && decision.mode === 'manipulate') {
				sceneModel.setSelected(pick(event, pointerType));
			}
		};
	}

	$effect(() => {
		const onUp = onPointerRelease('up');
		const onCancel = onPointerRelease('cancel');
		const opts = { capture: true } as const;

		dom.addEventListener('pointerdown', onPointerDown, opts);
		dom.addEventListener('pointermove', onPointerMove, opts);
		dom.addEventListener('pointerup', onUp, opts);
		dom.addEventListener('pointercancel', onCancel, opts);

		return () => {
			dom.removeEventListener('pointerdown', onPointerDown, opts);
			dom.removeEventListener('pointermove', onPointerMove, opts);
			dom.removeEventListener('pointerup', onUp, opts);
			dom.removeEventListener('pointercancel', onCancel, opts);
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
	<!-- touches.ONE disabled: a single finger must select/manipulate, never orbit (invariant 8).
	     Two fingers keep the native dolly+pan navigate behavior. Mouse buttons are left at their
	     three.js defaults (desktop drag-to-orbit). -->
	<OrbitControls touches={{ ONE: null, TWO: TOUCH.DOLLY_PAN }} />
</T.PerspectiveCamera>

<T.HemisphereLight intensity={0.75} groundColor={0x3a3a3a} />
<T.DirectionalLight position={[6, 10, 4]} intensity={1.4} />

{#if geometry}
	<T.Mesh bind:ref={mesh} {geometry} {material} />
{/if}

{#if boltMesh}
	<T is={boltMesh} />
{/if}

{#if selectedObject}
	<TransformControls
		object={selectedObject}
		size={GIZMO_SIZE}
		bind:controls={transformControls}
		onobjectChange={() => invalidateFor(invalidate, 'interaction')}
	/>
{/if}
