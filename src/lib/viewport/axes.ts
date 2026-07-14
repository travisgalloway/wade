// The origin axes indicator: three colored lines at the center of the ground grid, each labelled
// with its axis letter, so the world's Z-up convention (see orientation.ts) is something you can
// *read* off the viewport rather than infer from which way a slider grows a solid.
//
// Colors follow three.js's `AxesHelper`, which is also Blender's: X red, Y green, Z blue.
//
// The labels are canvas-drawn textures on camera-facing sprites, not a text-mesh library. Two
// reasons: no font asset is fetched (troika/`Text` pulls one over the network, which would put a
// hole in Phase 3's offline PWA story), and `SpriteNodeMaterial` is a node material, so this stays
// inside the repo's TSL-only constraint — no `ShaderMaterial`, which `WebGPURenderer` does not
// support. Sprites always face the camera, so the letters stay upright and legible at any orbit
// angle, which a text mesh baked into a plane would not.
import { AxesHelper, CanvasTexture, Group, Sprite, SRGBColorSpace, Vector3 } from 'three';
import { SpriteNodeMaterial } from 'three/webgpu';

/** Length of each axis line, in scene units. Long enough to read against the 300-unit grid, short
 *  enough not to compete with the solids (whose params top out at 90 — see params.svelte.ts). */
const AXIS_LENGTH = 50;

/** Edge of the square canvas each label is drawn onto. A power of two, and comfortably larger than
 *  the glyph needs, so the letter stays crisp when the camera dollies in close. */
const LABEL_TEXTURE_SIZE = 128;

/** On-screen size of a label, in scene units. Sprites are sized in world units, so this is what
 *  keeps the letter proportionate to `AXIS_LENGTH` rather than to the canvas above. */
const LABEL_SCALE = 10;

/** Where each label sits, and what color it's drawn in — one entry per axis, positioned just past
 *  the tip of its line so the glyph never overlaps the line it names. Colors match `AxesHelper`. */
const LABELS: ReadonlyArray<{ text: string; color: string; position: Vector3 }> = [
	{ text: 'X', color: '#ff3653', position: new Vector3(AXIS_LENGTH + LABEL_SCALE * 0.6, 0, 0) },
	{ text: 'Y', color: '#39ff14', position: new Vector3(0, AXIS_LENGTH + LABEL_SCALE * 0.6, 0) },
	{ text: 'Z', color: '#2c8fff', position: new Vector3(0, 0, AXIS_LENGTH + LABEL_SCALE * 0.6) }
];

/** Draws one axis letter onto an offscreen canvas. Touches `document`, so it must only ever run on
 *  the client — `createAxesIndicator` is called from an `$effect`, never at module scope, for the
 *  same reason `new Worker` is (see Scene.svelte). */
function createLabelTexture(text: string, color: string): CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = LABEL_TEXTURE_SIZE;
	canvas.height = LABEL_TEXTURE_SIZE;

	const context = canvas.getContext('2d');
	if (!context) throw new Error('2d canvas context unavailable for the axis label texture');

	context.font = `bold ${LABEL_TEXTURE_SIZE * 0.7}px system-ui, sans-serif`;
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.fillStyle = color;
	context.fillText(text, LABEL_TEXTURE_SIZE / 2, LABEL_TEXTURE_SIZE / 2);

	const texture = new CanvasTexture(canvas);
	// A 2d canvas holds sRGB bytes, but CanvasTexture assumes linear unless told otherwise — leaving
	// this unset renders every label washed out (a muddy pink X instead of a red one).
	texture.colorSpace = SRGBColorSpace;
	return texture;
}

/** An axes indicator, plus the disposal its caller owes. */
export interface AxesIndicator {
	object: Group;
	/** Releases the helper's line geometry/material and every label's sprite material and texture.
	 *  The caller must call this on unmount — same disposal discipline as the bolt geometry and the
	 *  snap marker in Scene.svelte. */
	dispose(): void;
}

/**
 * Builds the labelled triad, centered on the world origin. Not a Threlte component: it's plain
 * imperative three.js (invariant 3 — nothing here is per-frame state), mounted through `<T is={}>`
 * exactly like the instanced bolts are.
 */
export function createAxesIndicator(): AxesIndicator {
	const group = new Group();

	const helper = new AxesHelper(AXIS_LENGTH);
	// The X and Y lines lie *in* the ground plane, coplanar with the grid, so by default they
	// z-fight with it and read as barely-there smudges. Drawing them with the depth test off, after
	// everything else, makes the triad unconditionally legible — which is the whole point of an
	// orientation cue.
	for (const material of [helper.material].flat()) material.depthTest = false;
	helper.renderOrder = 1;
	group.add(helper);

	const sprites = LABELS.map(({ text, color, position }) => {
		const texture = createLabelTexture(text, color);
		// `depthTest: false` keeps a label readable when a solid is between it and the camera — an
		// orientation cue is only useful if it can't be hidden by the thing you're orienting against.
		const material = new SpriteNodeMaterial({ map: texture, transparent: true, depthTest: false });
		const sprite = new Sprite(material);
		sprite.position.copy(position);
		sprite.scale.setScalar(LABEL_SCALE);
		// Drawn after the opaque scene, so the disabled depth test above doesn't let a label be
		// overwritten by geometry rasterized later in the same pass.
		sprite.renderOrder = 2;
		group.add(sprite);
		return { material, texture };
	});

	return {
		object: group,
		dispose() {
			helper.geometry.dispose();
			// three types every object's `material` as one-or-many, even where (as here) it is always
			// the single LineBasicMaterial AxesHelper builds for itself.
			for (const material of [helper.material].flat()) material.dispose();
			for (const { material, texture } of sprites) {
				material.dispose();
				texture.dispose();
			}
		}
	};
}
