// Runes-based settings store. Per invariant 3, this is UI-layer state that *configures* the
// renderer at construction time (Viewport.svelte reads `settings.forceWebGL` once, inside the
// `createRenderer` factory) — it is never read on a per-frame basis.
const STORAGE_KEY = 'wade:settings';

interface StoredSettings {
	forceWebGL: boolean;
	kernel: boolean;
}

function readStored(): Partial<StoredSettings> {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		return JSON.parse(raw) as Partial<StoredSettings>;
	} catch {
		// localStorage may be unavailable (privacy mode, disabled storage) — fall back silently.
		return {};
	}
}

/** `?forceWebGL=1` wins over the stored value, which is what makes the WebGL2 fallback path
 *  trivially exercisable from Playwright without touching localStorage setup. */
function readInitialForceWebGL(): boolean {
	if (typeof window === 'undefined') return false;
	const param = new URLSearchParams(window.location.search).get('forceWebGL');
	if (param === '1') return true;
	return readStored().forceWebGL ?? false;
}

/** `?kernel=off` wins over the stored value — same precedence as `forceWebGL`. Defaulting to ON
 *  means the kernel-built parametric scene (issue #25) is what most visits see; the query param
 *  is what lets `viewport.e2e.ts`/`webgpu.e2e.ts` opt back into the fast Phase 1 scene (STL + bolts,
 *  no worker booted at all) without touching localStorage, and it doubles as a real
 *  graceful-degradation path — Scene.svelte falls back to the same STL scene at runtime if the
 *  kernel reports a fatal init error. */
function readInitialKernel(): boolean {
	if (typeof window === 'undefined') return true;
	const param = new URLSearchParams(window.location.search).get('kernel');
	if (param === 'off') return false;
	return readStored().kernel ?? true;
}

function persist(patch: Partial<StoredSettings>) {
	if (typeof window === 'undefined') return;
	try {
		const merged = { ...readStored(), ...patch } satisfies Partial<StoredSettings>;
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
	} catch {
		// Ignore write failures (e.g. storage quota, privacy mode).
	}
}

let forceWebGL = $state(readInitialForceWebGL());
let kernel = $state(readInitialKernel());

export const settings = {
	get forceWebGL() {
		return forceWebGL;
	},
	set forceWebGL(value: boolean) {
		forceWebGL = value;
		persist({ forceWebGL: value });
	},
	get kernel() {
		return kernel;
	},
	set kernel(value: boolean) {
		kernel = value;
		persist({ kernel: value });
	}
};
