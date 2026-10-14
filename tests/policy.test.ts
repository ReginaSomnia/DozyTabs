import { describe, expect, it } from "vitest";
import { decide, type LiveTab, type StayAwakeReason } from "@/core/policy";
import { DEFAULT_SETTINGS, type Settings } from "@/core/settings";
import { EMPTY_TAB_STATE, type TabState } from "@/core/tab-state";

const tab = (overrides: Partial<LiveTab> = {}): LiveTab => ({
	id: 1,
	windowId: 1,
	active: false,
	pinned: false,
	audible: false,
	discarded: false,
	url: "https://www.youtube.com/watch?v=abc",
	title: "Video - YouTube",
	status: "complete",
	...overrides,
});
const state = (overrides: Partial<TabState> = {}): TabState => ({
	...EMPTY_TAB_STATE,
	...overrides,
});
const settings = (overrides: Partial<Settings> = {}): Settings => ({
	...DEFAULT_SETTINGS,
	...overrides,
});

describe("decide", () => {
	it("sleeps a hidden, idle YouTube tab", () => {
		expect(decide(tab(), state(), settings(), true)).toEqual({
			sleep: true,
		});
	});

	it.each<[string, LiveTab, TabState, Settings, boolean, StayAwakeReason]>([
		["the extension is off", tab(), state(), settings({ enabled: false }), true, "disabled"],
		["not YouTube", tab({ url: undefined }), state(), settings(), true, "not-youtube"],
		["YouTube Music", tab({ url: "https://music.youtube.com/watch?v=abc" }), state(), settings(), true, "music"],
		["active", tab({ active: true }), state(), settings(), true, "active"],
		["already asleep", tab({ discarded: true }), state(), settings(), true, "asleep"],
		["playing", tab(), state({ playing: true }), settings(), true, "playing"],
		["audible", tab({ audible: true }), state(), settings(), true, "playing"],
		["pinned", tab({ pinned: true }), state(), settings(), true, "pinned"],
		["a draft", tab(), state({ draft: true }), settings(), true, "draft"],
		["kept awake", tab(), state({ keepAwake: true }), settings(), true, "kept-awake"],
		["offline", tab(), state(), settings({ keepWhileOffline: true }), false, "offline"],
	])("stays awake when %s", (_name, t, s, se, online, reason) => {
		expect(decide(t, s, se, online)).toEqual({ sleep: false, reason });
	});

	it.each<[string, LiveTab, TabState, Settings, boolean]>([
		["pinned", tab({ pinned: true }), state(), settings({ keepPinned: false }), true],
		["YouTube Music", tab({ url: "https://music.youtube.com/" }), state(), settings({ keepMusic: false }), true],
		["a draft", tab(), state({ draft: true }), settings({ keepDrafts: false }), true],
		["offline", tab(), state(), settings(), false],
	])("sleeps when %s if that setting is off", (_name, t, s, se, online) => {
		expect(decide(t, s, se, online)).toEqual({ sleep: true });
	});
});
