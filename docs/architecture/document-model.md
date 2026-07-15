# The document model

`src/lib/scene/document.svelte.ts` — the client-side model of what the user has built. It is the **"document model" row** of the three-kinds-of-state table in [`state-and-errors.md`](./state-and-errors.md), made real.

> **Status: designed, not built.** This describes the model that replaces the hard-wired one-box-one-cylinder scene. See [`../roadmap/phases.md`](../roadmap/phases.md) — the foundation lands in Phase 3 (issue P3-1); everything in [`ui-controls.md`](./ui-controls.md) and [`agent-api.md`](./agent-api.md) depends on it.

## Why it has to exist first

Today the scene is hard-wired to exactly two solids. `src/lib/scene/params.svelte.ts` holds five scalar `$state` fields, `Scene.svelte` has two literal `<T.Mesh>` branches with two per-solid `$effect`s and a two-way `onMesh` switch, and the gizmo throws its transform away. There is no collection, no per-object transform, and no way to add or remove an object.

Both new workstreams — direct manipulation and agent integration — need to represent _N_ objects with position and dimensions. Neither can start until this exists. `KernelClient` is already N-solid-capable (all its state is keyed by `SolidId`); the limit is entirely above it, in the scene wiring. This model removes that limit.

## Shape

Everything here is **plain and structured-clone-safe** — no `three` types, no kernel import (invariants 3, 4):

```ts
type ObjectId = SolidId; // generalize the existing alias; still a string

interface Transform {
	position: [number, number, number];
	rotation: [number, number, number, number]; // quaternion
	scale: [number, number, number];
}

type ObjectDef =
	| { kind: 'box'; params: BoxParams }
	| { kind: 'cylinder'; params: CylinderParams }
	| { kind: 'imported'; name: string }; // Phase 4; the solid lives in the worker
// reserved: { kind: 'brep-script'; source: string } — see agent-api.md

interface SceneObject {
	id: ObjectId;
	def: ObjectDef;
	transform: Transform;
}
```

`def` is a **discriminated union** on purpose: adding a solid kind (imported, brep-script) forces every consumer's switch to be reconsidered, exactly as the kernel's closed unions do.

## Reactivity, and the one carried-over lesson

Hold `let objects = $state<SceneObject[]>([...])`. Svelte 5 deep-proxies the entries, so reading `obj.def.params.width` inside a per-object `$effect` subscribes at field granularity — the same fine-grained-dependency goal `params.svelte.ts` reaches today with one `$state` primitive per field, now without hand-rolling them.

**The lesson that must survive the move:** the getter that hands params to the kernel must return a **fresh plain object**, never the Svelte proxy. A proxy does not survive `structuredClone` / `postMessage` — it would throw at the worker boundary. So expose `paramsFor(id)` (or equivalent) that spreads: `{ ...obj.def.params }`. This is the same rule `state-and-errors.md` records for the current params model; it is why that rule is written down.

Clamping stays: keep or re-export `clampBoxParam` / `clampCylinderParam` and `BOX_LIMITS` / `CYLINDER_LIMITS`, so a value can never reach the kernel out of range. `params.spec.ts` continues to cover them.

## The mutation API is command-shaped from day one

All mutations route through a small closed set:

```ts
addObject(def, transform?): ObjectId;
removeObject(id): void;
setParam(id, key, value): void; // clamps, like today
setTransform(id, transform): void; // gizmo + inspector write here
```

This is deliberate. Phase 4 calls for **undo/redo on the document model, not on geometry** ([`../roadmap/phase-4-cad-depth.md`](../roadmap/phase-4-cad-depth.md)). If every mutation is expressible as one serializable command — and these four are — then undo/redo is an _additive_ `createHistory(doc)` wrapper that records inverse commands, not a refactor of the model.

**Do not build the history stack in the foundation.** The foundation's only obligation is that no mutation bypasses these four calls. History comes later (issue P4-5).

## How the scene consumes it

`Scene.svelte` stops hard-coding solids and iterates:

```svelte
{#each documentModel.objects as obj (obj.id)}
	<SolidNode {obj} client={kernelClient} onGeometry={registerPickable} />
{/each}
```

`src/lib/viewport/SolidNode.svelte` is one instance per object — the clean answer to "two hard-coded branches become a collection," and it fits the house rule of many small files. Each `SolidNode`:

- owns its own `$state.raw<BufferGeometry>` and `<T.Mesh>`, transform-bound from `obj.transform`, with `mesh.userData.objectId = obj.id` (the hook selection needs — see [`ui-controls.md`](./ui-controls.md));
- owns **one** request `$effect` scoped to its object, so a change to object A never re-requests object B (KernelClient already keys debounce/conflation on `obj.id`);
- subscribes `onMesh` filtered to its `solidId`, swaps geometry, rebuilds the BVH, disposes the outgoing geometry + BVH, and issues **exactly one** `invalidateFor(invalidate, 'model')` per settled mesh (invariant 2);
- on unmount, disposes its geometry/BVH and calls the worker's `dispose(obj.id)` — finally exercising `KernelWorkerApi.dispose`, which is unused today.

This deletes `Scene.svelte`'s two request `$effect`s, its `onMesh` `solidId` switch, and its two `$state.raw` geometry pairs. `pickableObjects` / `snapMeshes` become a `$state.raw` collection populated by `SolidNode`. The `window.__wade.boxExtents` probe retargets to "the first box object" so `orientation.e2e.ts` keeps its up-axis check.

**Why per-object components over one collection `$effect`:** a single effect iterating all objects would re-run whenever _any_ object changed and would have to diff to find which solid to re-request — reintroducing exactly the cross-solid coupling this design removes. One `SolidNode` per object keeps each object's request/​mesh/​dispose lifecycle self-contained and lets Svelte's keyed `{#each}` handle add/remove.

## Where it is created

`src/routes/+page.svelte`, swapping `createParamsModel()` for `createDocumentModel()` and passing the instance to both `<Viewport>` (→ `Scene`, inside the Threlte `<Canvas>`) and the panel (plain DOM). This is the same sibling-tree injection the current params model uses, and the reason is unchanged — see [`state-and-errors.md`](./state-and-errors.md#where-the-shared-model-is-created).

## Related

- [`state-and-errors.md`](./state-and-errors.md) — the three-kinds-of-state rule this makes concrete
- [`ui-controls.md`](./ui-controls.md) — the inspector and gizmo that drive the command API
- [`agent-api.md`](./agent-api.md) — imported and (reserved) brep-script objects
- [`kernel.md`](./kernel.md) — the per-`SolidId` machinery reused unchanged
- [`invariants.md`](./invariants.md) — 3, 4
