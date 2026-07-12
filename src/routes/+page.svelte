<script lang="ts">
	// The params model is created here (not inside Scene.svelte) because it is shared by two
	// sibling component trees: ParamsPanel (plain DOM, rendered below) and Scene.svelte (inside
	// Viewport's Threlte <Canvas>). Svelte context only flows down a single tree, so a shared
	// instance has to be created above both and passed down as a prop — not held as local state
	// inside either sibling (issue #25).
	import Viewport from '$lib/viewport/Viewport.svelte';
	import ParamsPanel from '$lib/ui/ParamsPanel.svelte';
	import { createParamsModel } from '$lib/scene/params.svelte';
	import { settings } from '$lib/settings/settings.svelte';

	const paramsModel = createParamsModel();
</script>

<Viewport {paramsModel} />
{#if settings.kernel}
	<ParamsPanel model={paramsModel} />
{/if}
