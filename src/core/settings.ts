import { browser } from "wxt/browser";

export type Settings = {
	enabled: boolean;
	idleMinutes: number;
	sleepUnvisited: boolean;
	rememberPosition: boolean;
	pauseOnRestart: boolean;
	keepPinned: boolean;
	keepMusic: boolean;
	keepDrafts: boolean;
	keepWhileOffline: boolean;
};

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
	enabled: true,
	idleMinutes: 30,
	sleepUnvisited: true,
	rememberPosition: true,
	pauseOnRestart: true,
	keepPinned: true,
	keepMusic: true,
	keepDrafts: true,
	keepWhileOffline: false,
});

const STORAGE_KEY = "settings";
const MIN_IDLE_MINUTES = 1;
const MAX_IDLE_MINUTES = 1440;

export function normalizeSettings(stored: unknown): Settings {
	const raw = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
	const settings: Settings = { ...DEFAULT_SETTINGS };
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
		const value = raw[key];
		if (typeof value === typeof DEFAULT_SETTINGS[key]) {
			Object.assign(settings, { [key]: value });
		}
	}
	settings.idleMinutes = Number.isFinite(settings.idleMinutes)
		? Math.min(MAX_IDLE_MINUTES, Math.max(MIN_IDLE_MINUTES, Math.round(settings.idleMinutes)))
		: DEFAULT_SETTINGS.idleMinutes;
	return settings;
}

export async function loadSettings(): Promise<Settings> {
	const stored = await browser.storage.sync.get(STORAGE_KEY);
	return normalizeSettings(stored[STORAGE_KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
	const next = normalizeSettings({ ...(await loadSettings()), ...patch });
	await browser.storage.sync.set({ [STORAGE_KEY]: next });
	return next;
}

export function onSettingsChanged(listener: (settings: Settings) => void): void {
	browser.storage.onChanged.addListener((changes, areaName) => {
		const change = changes[STORAGE_KEY];
		if (areaName === "sync" && change) {
			listener(normalizeSettings(change.newValue));
		}
	});
}
