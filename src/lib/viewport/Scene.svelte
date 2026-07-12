<script lang="ts">
	// Lives inside <Canvas> (mounted by Viewport.svelte), so `useThrelte()` and Threlte's own
	// context hooks are available here. Owns the camera, lights, orbit controls, the scene's
	// geometry sources, and (issues #16-#19, #48) input routing, picking, the gizmo and instancing.
	// The geometry/camera references below are load-once, not per-frame (invariant 3) — nothing
	// here is written to on every tick.
	//
	// Two geometry sources, chosen by `settings.kernel` (issue #25):
	//   - kernel ON (default): a KernelClient-driven box + cylinder, computed off-thread by
	//     kernel.worker.ts and streamed back as `MeshPayload`s. The KernelClient is created inside
	//     an `$effect`, never at module scope — `new Worker` doesn't exist during SvelteKit's
	//     SSR/shell pass.
	//   - kernel OFF (`?kernel=off`, or a fatal kernel init error at runtime): exactly the Phase 1
	//     scene — the STL sample part, no worker booted at all. This is what keeps
	//     `viewport.e2e.ts`/`webgpu.e2e.ts` fast and untouched, and is a real graceful-degradation
	//     path, not just a test convenience.
	// Both scenes keep the instanced bolts (issue #48) — they're procedural decoration, not tied to
	// either geometry source.
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls, TransformControls, useOrbitControls } from '@threlte/extras';
	import {
		Box3,
		TOUCH,
		type BufferGeometry,
		type Mesh,
		type InstancedMesh,
		type Object3D,
		type PerspectiveCamera
	} from 'three';
	import type { TransformControls as TransformControlsImpl } from 'three/examples/jsm/controls/TransformControls.js';
	import { MeshStandardNodeMaterial } from 'three/webgpu';
	import { createKernelClient } from '$lib/kernel/createKernelClient';
	import type { KernelClient } from '$lib/kernel/KernelClient';
	import { toBufferGeometry } from '$lib/kernel/geometry';
	import { BOX_SOLID_ID, CYLINDER_SOLID_ID, type ParamsModel } from '$lib/scene/params.svelte';
	import { settings } from '$lib/settings/settings.svelte';
	import { frameBox } from './framing';
	import { GIZMO_SIZE } from './gizmo';
	import { allGeometriesIndexed, BOLT_POSITIONS, createBoltInstances } from './instancing';
	import { invalidateFor } from './renderLoop';
	import { loadSampleMesh } from './sampleMesh';
	import { buildBoundsTree, installBVHAcceleration, Picker, type PointerKind } from './picking';
	import { PointerRouter, type PointerType } from '$lib/input/pointerRouter';
	import { createSceneModel } from '$lib/scene/SceneModel.svelte';

	let { paramsModel }: { paramsModel: ParamsModel } = $props();

	// One-time global prototype patch (idempotent) — see picking.ts.
	installBVHAcceleration();

	const { invalidate, dom, size } = useThrelte();
	const orbitControls = useOrbitControls();
	const sceneModel = createSceneModel(invalidate);
	const router = new PointerRouter();
	const picker = new Picker();

	let camera = $state.raw<PerspectiveCamera>();

	// The `?kernel=off` / Phase 1 fallback scene.
	let geometry = $state.raw<BufferGeometry>();
	let mesh = $state.raw<Mesh>();

	// The kernel-driven scene (issue #25). `kernelFatal` is what turns a kernel init failure into a
	// live fallback to the STL scene above, rather than a permanently blank viewport.
	let boxGeometry = $state.raw<BufferGeometry>();
	let boxMesh = $state.raw<Mesh>();
	let cylinderGeometry = $state.raw<BufferGeometry>();
	let cylinderMesh = $state.raw<Mesh>();
	let kernelClient = $state.raw<KernelClient>();
	let kernelFatal = $state(false);
	let useKernel = $derived(settings.kernel && !kernelFatal);

	let boltMesh = $state.raw<InstancedMesh>();
	let transformControls = $state.raw<TransformControlsImpl>();
	let gizmoDragging = $state(false);

	// A stable local binding for the template's {#if} to narrow against, and for the pointer
	// handlers below to read without going through the SceneModel getter twice.
	let selectedObject = $derived(sceneModel.selected);

	// Whichever objects are actually pickable right now — one mesh in the fallback scene, up to two
	// in the kernel scene. Both `Picker.pick()` and hover/selection highlighting key off this.
	let pickableObjects = $derived<Object3D[]>(
		useKernel
			? ([boxMesh, cylinderMesh].filter((o): o is Mesh => o !== undefined) as Object3D[])
			: mesh
				? [mesh]
				: []
	);

	const material = new MeshStandardNodeMaterial({
		color: 0x9fb4c7,
		roughness: 0.55,
		metalness: 0.1
	});

	const boxMaterial = new MeshStandardNodeMaterial({
		color: 0x9fb4c7,
		roughness: 0.55,
		metalness: 0.1
	});

	const cylinderMaterial = new MeshStandardNodeMaterial({
		color: 0x8a9fb0,
		roughness: 0.5,
		metalness: 0.15
	});

	// Distinct finish from the bracket/kernel solids so the repeated hardware (issue #48) reads as
	// separate parts, not more of the bracket/solids themselves.
	const boltMaterial = new MeshStandardNodeMaterial({
		color: 0x51565c,
		roughness: 0.35,
		metalness: 0.85
	});

	/** Applies the selected/hovered emissive tint (or none) to `mat`, matching whether `object` is
	 *  the scene model's current selection/hover target. */
	function applyHighlight(mat: MeshStandardNodeMaterial, object: Object3D | undefined) {
		const isSelected = object !== undefined && sceneModel.selected === object;
		const isHovered = object !== undefined && sceneModel.hovered === object;
		if (isSelected) {
			mat.emissive.setRGB(0.32, 0.22, 0.02);
		} else if (isHovered) {
			mat.emissive.setRGB(0.14, 0.14, 0.14);
		} else {
			mat.emissive.setRGB(0, 0, 0);
		}
	}

	// Selection/hover feedback is a plain material tweak — no ShaderMaterial/onBeforeCompile, so it
	// stays within the TSL-only constraint. Runs whenever the view-model changes; SceneModel's own
	// setters already invalidated for this transient interaction, so this doesn't invalidate again.
	$effect(() => {
		let isSelected: boolean;
		let isHovered: boolean;

		if (useKernel) {
			applyHighlight(boxMaterial, boxMesh);
			applyHighlight(cylinderMaterial, cylinderMesh);
			isSelected =
				(boxMesh !== undefined && sceneModel.selected === boxMesh) ||
				(cylinderMesh !== undefined && sceneModel.selected === cylinderMesh);
			isHovered =
				(boxMesh !== undefined && sceneModel.hovered === boxMesh) ||
				(cylinderMesh !== undefined && sceneModel.hovered === cylinderMesh);
		} else {
			applyHighlight(material, mesh);
			isSelected = mesh !== undefined && sceneModel.selected === mesh;
			isHovered = mesh !== undefined && sceneModel.hovered === mesh;
		}

		// Exposed for the e2e selection test, same pattern as renderCount/backend in renderLoop.ts.
		if (typeof window !== 'undefined' && window.__wade) {
			window.__wade.selected = isSelected;
			window.__wade.hovered = isHovered;
		}
	});

	// The `?kernel=off` / fallback scene: the Phase 1 STL sample part. Only runs while the kernel
	// scene isn't in play — either because `settings.kernel` was off from the start, or because
	// `kernelFatal` flipped true after a kernel init failure (see the kernel `$effect` below).
	$effect(() => {
		if (useKernel) return;

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

	// The kernel-driven scene (issues #25, #26). Creating the client here — inside an `$effect`,
	// never at module scope — is what keeps `new Worker` out of the SSR/shell pass. Only runs when
	// the kernel is enabled at all; a later `kernelFatal` flip doesn't tear this down (there is
	// nothing more for it to do once it has already reported the fatal error), it only redirects
	// the fallback `$effect` above into loading the STL scene instead.
	$effect(() => {
		if (!settings.kernel) return;

		const client = createKernelClient();
		kernelClient = client;

		let meshCount = 0;
		if (typeof window !== 'undefined' && window.__wade) {
			window.__wade.kernelReady = false;
			window.__wade.kernelMeshCount = 0;
		}

		const offMesh = client.onMesh((solidId, payload) => {
			const nextGeometry = toBufferGeometry(payload);
			buildBoundsTree(nextGeometry);

			// Dispose the outgoing geometry (and its BVH) once replaced — a slider drag would
			// otherwise leak one BufferGeometry per tick.
			if (solidId === BOX_SOLID_ID) {
				const previous = boxGeometry;
				boxGeometry = nextGeometry;
				previous?.disposeBoundsTree();
				previous?.dispose();
			} else if (solidId === CYLINDER_SOLID_ID) {
				const previous = cylinderGeometry;
				cylinderGeometry = nextGeometry;
				previous?.disposeBoundsTree();
				previous?.dispose();
			}

			meshCount += 1;
			if (typeof window !== 'undefined' && window.__wade) {
				window.__wade.kernelMeshCount = meshCount;
			}

			// Exactly one invalidate() per completed update (invariant 2, issue #25's AC) — the
			// debounce/conflation in KernelClient is what guarantees onMesh fires once per settled,
			// non-superseded request rather than once per input event.
			invalidateFor(invalidate, 'model');
		});

		const offError = client.onError((error) => {
			if (typeof window !== 'undefined' && window.__wade) {
				window.__wade.kernelError = error.message;
			}
			// The only fatal case: OCCT itself never booted. Anything else (e.g. invalid slider
			// params) is a per-request failure, not a reason to abandon the kernel scene.
			if (error.code === 'kernel-init-failed') {
				kernelFatal = true;
			}
		});

		client.warmup().then(() => {
			// `KernelClient.warmup()` never rejects on a typed kernel failure (it routes that
			// through `onError`, awaited above in the same microtask chain before this resolves) —
			// only reaching here with `kernelFatal` still false means it actually succeeded.
			if (kernelFatal) return;
			if (typeof window !== 'undefined' && window.__wade) {
				window.__wade.kernelReady = true;
			}
		});

		return () => {
			offMesh();
			offError();
			client.dispose();
			if (kernelClient === client) kernelClient = undefined;

			// KernelClient.dispose() only tears down this client's own bookkeeping/listeners, not
			// the worker-side solids (see its docstring) — this demo scene never actually removes a
			// solid mid-session, so no `KernelWorkerApi.dispose(solidId)` call is needed here; the
			// whole worker is torn down along with `client`.
			if (boxGeometry) {
				boxGeometry.disposeBoundsTree();
				boxGeometry.dispose();
				boxGeometry = undefined;
			}
			if (cylinderGeometry) {
				cylinderGeometry.disposeBoundsTree();
				cylinderGeometry.dispose();
				cylinderGeometry = undefined;
			}
		};
	});

	// Sends the box solid's current params whenever they change, once the client exists. Runs once
	// immediately when `kernelClient` first becomes defined (sending the initial params), and again
	// on every subsequent slider edit — debounced/conflated inside KernelClient itself (issue #26).
	$effect(() => {
		const client = kernelClient;
		if (!client) return;
		client.request({ type: 'box', solidId: BOX_SOLID_ID, params: paramsModel.box });
	});

	$effect(() => {
		const client = kernelClient;
		if (!client) return;
		client.request({ type: 'cylinder', solidId: CYLINDER_SOLID_ID, params: paramsModel.cylinder });
	});

	// Frames the camera on the kernel scene exactly once, the first time all three of the box,
	// cylinder and bolts have mounted — never again after, so later slider-driven updates stay at
	// exactly one invalidate() each (issue #25's AC) instead of also re-triggering a camera fit.
	let hasFramedKernelScene = false;
	$effect(() => {
		if (!useKernel || hasFramedKernelScene) return;
		if (!camera || !boxMesh || !cylinderMesh || !boltMesh) return;

		hasFramedKernelScene = true;
		const box = new Box3();
		box.expandByObject(boxMesh);
		box.expandByObject(cylinderMesh);
		box.expandByObject(boltMesh);
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
		if (!boltMesh) return;
		if (typeof window === 'undefined' || !window.__wade) return;
		window.__wade.boltCount = BOLT_POSITIONS.length;

		const roots: Object3D[] = useKernel
			? [boxMesh, cylinderMesh, boltMesh].filter((o) => o !== undefined)
			: [mesh, boltMesh].filter((o) => o !== undefined);
		window.__wade.allIndexed = allGeometriesIndexed(roots);
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
		if (!camera || pickableObjects.length === 0) return null;
		const { x, y } = localPoint(event);
		const { width, height } = size.current;
		return picker.pick({ x, y, pointerKind, width, height, camera, objects: pickableObjects });
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

{#if useKernel}
	{#if boxGeometry}
		<T.Mesh
			bind:ref={boxMesh}
			geometry={boxGeometry}
			material={boxMaterial}
			position={[-60, 0, 0]}
		/>
	{/if}
	{#if cylinderGeometry}
		<T.Mesh
			bind:ref={cylinderMesh}
			geometry={cylinderGeometry}
			material={cylinderMaterial}
			position={[60, 0, 0]}
		/>
	{/if}
{:else if geometry}
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
