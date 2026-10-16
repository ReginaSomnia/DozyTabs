import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from "@/core/settings";

beforeEach(() => {
	fakeBrowser.reset();
});

describe("normalizeSettings", () => {
	it("returns the defaults when nothing is stored", () => {
		expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it("keeps valid stored values", () => {
		expect(normalizeSettings({ idleMinutes: 45, keepMusic: false })).toEqual({
			...DEFAULT_SETTINGS,
			idleMinutes: 45,
			keepMusic: false,
		});
	});

	it("drops values of the wrong type and unknown keys", () => {
		expect(normalizeSettings({ enabled: "yes", idleMinutes: "5", foo: 1 })).toEqual(DEFAULT_SETTINGS);
	});

	it.each([
		[0, 1],
		[-5, 1],
		[2.6, 3],
		[5000, 1440],
		[Number.NaN, 30],
		[Number.POSITIVE_INFINITY, 30],
	])("turns idleMinutes %s into %s", (stored, expected) => {
		expect(normalizeSettings({ idleMinutes: stored }).idleMinutes).toBe(expected);
	});
});

describe("loadSettings and saveSettings", () => {
	it("loads the defaults from empty storage", async () => {
		expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
	});

	it("saves each patch on top of what's stored", async () => {
		await saveSettings({ idleMinutes: 5 });
		await saveSettings({ keepPinned: false });
		expect(await loadSettings()).toEqual({
			...DEFAULT_SETTINGS,
			idleMinutes: 5,
			keepPinned: false,
		});
	});
});
