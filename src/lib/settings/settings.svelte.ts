// Runes-based settings store. Per invariant 3, this is UI-layer state that *configures* the
// renderer at construction time (Viewport.svelte reads `settings.forceWebGL` once, inside the
// `createRenderer` factory) — it is never read on a per-frame basis.
const STORAGE_KEY = 'wade:settings';

interface StoredSettings {
	forceWebGL: boolean;
}

function readStoredForceWebGL(): boolean | undefined {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return undefined;
		return (JSON.parse(raw) as Partial<StoredSettings>).forceWebGL;
	} catch {
		// localStorage may be unavailable (privacy mode, disabled storage) — fall back silently.
		return undefined;
	}
}

/** `?forceWebGL=1` wins over the stored value, which is what makes the WebGL2 fallback path
 *  trivially exercisable from Playwright without touching localStorage setup. */
function readInitialForceWebGL(): boolean {
	if (typeof window === 'undefined') return false;
	const param = new URLSearchParams(window.location.search).get('forceWebGL');
	if (param === '1') return true;
	return readStoredForceWebGL() ?? false;
}

function persist(forceWebGL: boolean) {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ forceWebGL } satisfies StoredSettings)
		);
	} catch {
		// Ignore write failures (e.g. storage quota, privacy mode).
	}
}

let forceWebGL = $state(readInitialForceWebGL());

export const settings = {
	get forceWebGL() {
		return forceWebGL;
	},
	set forceWebGL(value: boolean) {
		forceWebGL = value;
		persist(value);
	}
};
