import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { createEngine, type Ports } from "@/core/engine";
import type { PrepareSleepResult } from "@/core/messages";
import type { LiveTab } from "@/core/policy";
import { DEFAULT_SETTINGS, type Settings } from "@/core/settings";
import { createTabStateStore } from "@/core/tab-state";
import { isYouTubeUrl } from "@/sites/youtube";

// alarms set by the test itself use this delay, so a test can tell "left
// alone" (still 7) apart from "restarted" (back to the settings value)
const SEEDED = 7;
const MUSIC = "https://music.youtube.com/watch?v=m";

function youtubeTab(id: number, overrides: Partial<LiveTab> = {}): LiveTab {
	return {
		id,
		windowId: 1,
		active: false,
		pinned: false,
		audible: false,
		discarded: false,
		url: `https://www.youtube.com/watch?v=v${id}`,
		title: `Video ${id} - YouTube`,
		status: "complete",
		...overrides,
	};
}

let settings: Settings;

function setup(initialTabs: LiveTab[]) {
	const tabs = new Map(initialTabs.map((tab) => [tab.id, { ...tab }]));
	const alarms = new Map<number, number>();
	const discarded: number[] = [];
	const prepared: number[] = [];
	const marked: number[] = [];
	const injected: number[] = [];
	const later: Array<() => Promise<void>> = [];
	// favicon waits and discards in the order they happened
	const events: string[] = [];
	let reply = (_tabId: number): PrepareSleepResult | null => ({ ok: true });
	let markReply = true;
	let preparing = 0;
	let mostPreparing = 0;
	let newIdFor = (tabId: number) => tabId;

	const ports: Ports = {
		getTab: async (tabId) => {
			const tab = tabs.get(tabId);
			return tab ? { ...tab } : null;
		},
		queryYouTubeTabs: async (windowId) =>
			[...tabs.values()]
				.filter((tab) => isYouTubeUrl(tab.url) && (windowId === undefined || tab.windowId === windowId))
				.map((tab) => ({ ...tab })),
		discard: async (tabId) => {
			const tab = tabs.get(tabId);
			if (!tab || tab.active || tab.discarded) return null;
			tab.discarded = true;
			discarded.push(tabId);
			events.push(`discard ${tabId}`);
			return newIdFor(tabId);
		},
		prepareSleep: async (tabId) => {
			prepared.push(tabId);
			preparing++;
			mostPreparing = Math.max(mostPreparing, preparing);
			// a real page answers later, which is what lets sleeps overlap
			await new Promise((resolve) => setTimeout(resolve, 0));
			preparing--;
			return reply(tabId);
		},
		markAsleep: async (tabId) => {
			marked.push(tabId);
			return markReply;
		},
		waitForSleepFavicon: async (tabId) => {
			events.push(`favicon ${tabId}`);
		},
		setAlarm: async (tabId, delayMinutes) => {
			alarms.set(tabId, delayMinutes);
		},
		clearAlarm: async (tabId) => {
			alarms.delete(tabId);
		},
		hasAlarm: async (tabId) => alarms.has(tabId),
		clearAllAlarms: async () => {
			alarms.clear();
		},
		injectContentScript: async (tabId) => {
			injected.push(tabId);
		},
		isOnline: () => true,
		later: (callback) => {
			later.push(callback);
		},
	};

	const states = createTabStateStore(fakeBrowser.storage.session);
	const engine = createEngine(ports, states, async () => settings);
	return {
		engine,
		states,
		tabs,
		alarms,
		discarded,
		prepared,
		marked,
		injected,
		later,
		events,
		setReply(fn: typeof reply) {
			reply = fn;
		},
		setMarkReply(value: boolean) {
			markReply = value;
		},
		mostPreparedAtOnce: () => mostPreparing,
		setNewIdFor(fn: typeof newIdFor) {
			newIdFor = fn;
		},
		patchTab(tabId: number, patch: Partial<LiveTab>): LiveTab {
			const tab = tabs.get(tabId);
			if (!tab) throw new Error(`no tab ${tabId}`);
			Object.assign(tab, patch);
			return { ...tab };
		},
	};
}

beforeEach(() => {
	fakeBrowser.reset();
	settings = { ...DEFAULT_SETTINGS };
});

describe("switching tabs", () => {
	it("clears the new tab's alarm and starts one for the tab I left", async () => {
		const t = setup([youtubeTab(1, { active: true }), youtubeTab(2)]);
		t.alarms.set(2, SEEDED);
		t.patchTab(1, { active: false });
		t.patchTab(2, { active: true });
		await t.engine.onActivated(2, 1);
		expect(t.alarms.has(2)).toBe(false);
		expect(t.alarms.get(1)).toBe(30);
	});

	it("leaves the running alarms of other tabs alone", async () => {
		const t = setup([youtubeTab(1, { active: true }), youtubeTab(3)]);
		t.alarms.set(3, SEEDED);
		await t.engine.onActivated(1, 1);
		expect(t.alarms.get(3)).toBe(SEEDED);
	});

	it("only looks at tabs in the same window", async () => {
		const t = setup([youtubeTab(1, { active: true }), youtubeTab(2, { windowId: 2 })]);
		await t.engine.onActivated(1, 1);
		expect(t.alarms.has(2)).toBe(false);
	});
});

describe("content script messages", () => {
	it("hidden restarts the timer", async () => {
		const t = setup([youtubeTab(1)]);
		t.alarms.set(1, SEEDED);
		await t.engine.onContentMessage(1, {
			type: "hidden",
			playing: false,
			draft: false,
		});
		expect(t.alarms.get(1)).toBe(30);
	});

	it("hidden while playing doesn't start a timer", async () => {
		const t = setup([youtubeTab(1)]);
		await t.engine.onContentMessage(1, {
			type: "hidden",
			playing: true,
			draft: false,
		});
		expect(t.alarms.has(1)).toBe(false);
	});

	it("a pause while hidden restarts the timer", async () => {
		const t = setup([youtubeTab(1)]);
		await t.states.update(1, { playing: true });
		t.alarms.set(1, SEEDED);
		await t.engine.onContentMessage(1, {
			type: "playback",
			playing: false,
		});
		expect(t.alarms.get(1)).toBe(30);
	});

	it("playing clears the alarm", async () => {
		const t = setup([youtubeTab(1)]);
		t.alarms.set(1, SEEDED);
		await t.engine.onContentMessage(1, { type: "playback", playing: true });
		expect(t.alarms.has(1)).toBe(false);
	});

	it.each(["visible", "activity"] as const)("%s clears the alarm", async (type) => {
		const t = setup([youtubeTab(1)]);
		t.alarms.set(1, SEEDED);
		await t.engine.onContentMessage(1, { type });
		expect(t.alarms.has(1)).toBe(false);
	});

	it("a draft clears the alarm and clearing it restarts the timer", async () => {
		const t = setup([youtubeTab(1)]);
		t.alarms.set(1, SEEDED);
		await t.engine.onContentMessage(1, { type: "draft", draft: true });
		expect(t.alarms.has(1)).toBe(false);
		await t.engine.onContentMessage(1, { type: "draft", draft: false });
		expect(t.alarms.get(1)).toBe(30);
	});
});

describe("when an alarm fires", () => {
	it("asks the content script, then discards and clears the alarm", async () => {
		const t = setup([youtubeTab(1)]);
		t.alarms.set(1, SEEDED);
		await t.engine.onAlarm(1);
		expect(t.prepared).toEqual([1]);
		expect(t.discarded).toEqual([1]);
		expect(t.alarms.has(1)).toBe(false);
		// the page marks itself while it prepares, no second message needed
		expect(t.marked).toEqual([]);
	});

	it("doesn't discard a tab that became active", async () => {
		const t = setup([youtubeTab(1, { active: true })]);
		await t.engine.onAlarm(1);
		expect(t.prepared).toEqual([]);
		expect(t.discarded).toEqual([]);
	});

	it("doesn't discard when the content script refuses", async () => {
		const t = setup([youtubeTab(1)]);
		t.setReply(() => ({ ok: false, reason: "visible" }));
		await t.engine.onAlarm(1);
		expect(t.discarded).toEqual([]);
	});

	it("remembers a playing refusal so no new timer starts", async () => {
		const t = setup([youtubeTab(1)]);
		t.setReply(() => ({ ok: false, reason: "playing" }));
		await t.engine.onAlarm(1);
		expect((await t.states.get(1)).playing).toBe(true);
		await t.engine.reevaluate(1);
		expect(t.alarms.has(1)).toBe(false);
	});

	it("tries again later when the content script times out", async () => {
		const t = setup([youtubeTab(1)]);
		t.setReply(() => ({ ok: false, reason: "timeout" }));
		await t.engine.onAlarm(1);
		expect(t.discarded).toEqual([]);
		expect(t.alarms.get(1)).toBe(30);
	});

	it("still discards when there's no content script", async () => {
		const t = setup([youtubeTab(1)]);
		t.setReply(() => null);
		await t.engine.onAlarm(1);
		expect(t.discarded).toEqual([1]);
	});

	it("forgets a tab that was closed", async () => {
		const t = setup([]);
		await t.states.update(9, { keepAwake: true });
		t.alarms.set(9, SEEDED);
		await t.engine.onAlarm(9);
		expect(t.alarms.has(9)).toBe(false);
		expect((await t.states.get(9)).keepAwake).toBe(false);
	});

	it("moves the state when the discarded tab gets a new id", async () => {
		settings.keepDrafts = false;
		const t = setup([youtubeTab(2)]);
		await t.states.update(2, { draft: true });
		t.setNewIdFor((tabId) => tabId + 100);
		await t.engine.onAlarm(2);
		expect((await t.states.get(102)).draft).toBe(true);
		expect((await t.states.get(2)).draft).toBe(false);
	});
});

describe("browser startup", () => {
	it("sleeps every non-active, eligible YouTube tab without asking the page", async () => {
		const t = setup([
			youtubeTab(1, { active: true }),
			youtubeTab(2),
			youtubeTab(3, { pinned: true }),
			youtubeTab(4, { url: MUSIC }),
			youtubeTab(5, { audible: true }),
			youtubeTab(6, { url: undefined }),
			youtubeTab(7, { windowId: 2 }),
		]);
		t.alarms.set(42, SEEDED);
		await t.engine.onStartup();
		expect([...t.discarded].sort()).toEqual([2, 7]);
		expect(t.prepared).toEqual([]);
		expect([...t.marked].sort()).toEqual([2, 7]);
		expect(t.alarms.size).toBe(0);
	});

	it("does nothing when the extension is off", async () => {
		settings.enabled = false;
		const t = setup([youtubeTab(2)]);
		await t.engine.onStartup();
		expect(t.discarded).toEqual([]);
	});
});

describe("the sleeping favicon", () => {
	it("is in the tab strip before a page that got ready is discarded", async () => {
		const t = setup([youtubeTab(1)]);
		await t.engine.onAlarm(1);
		expect(t.events).toEqual(["favicon 1", "discard 1"]);
	});

	it("is in the tab strip before a marked page is discarded", async () => {
		const t = setup([youtubeTab(2), youtubeTab(7, { windowId: 2 })]);
		await t.engine.onStartup();
		// startup sleeps its tabs in parallel, so only each tab's own order counts
		for (const id of [2, 7]) {
			expect(t.events.indexOf(`favicon ${id}`)).toBeGreaterThan(-1);
			expect(t.events.indexOf(`favicon ${id}`)).toBeLessThan(t.events.indexOf(`discard ${id}`));
		}
	});

	it("isn't waited for when no page swapped it", async () => {
		const t = setup([youtubeTab(1), youtubeTab(2)]);
		t.setReply(() => null);
		await t.engine.onAlarm(1);
		t.setMarkReply(false);
		await t.engine.onStartup();
		expect(t.events).toEqual(["discard 1", "discard 2"]);
	});
});

describe("tabs opened in the background", () => {
	it("sleep once they have a real title, without asking the page", async () => {
		const loading = youtubeTab(5, { status: "loading", title: undefined });
		const t = setup([loading]);
		await t.engine.onCreated(loading);
		await t.engine.onUpdated(5, { status: "loading" }, loading);
		expect(t.discarded).toEqual([]);
		const loaded = t.patchTab(5, {
			status: "complete",
			title: "Video - YouTube",
		});
		await t.engine.onUpdated(5, { title: "Video - YouTube" }, loaded);
		expect(t.discarded).toEqual([5]);
		expect(t.prepared).toEqual([]);
		expect(t.marked).toEqual([5]);
	});

	it("sleep after the fallback delay when the title stays generic", async () => {
		const tab = youtubeTab(5, { title: "YouTube" });
		const t = setup([tab]);
		await t.engine.onCreated({ ...tab, status: "loading" });
		await t.engine.onUpdated(5, { status: "complete" }, tab);
		expect(t.discarded).toEqual([]);
		expect(t.later).toHaveLength(1);
		await t.later[0]?.();
		expect(t.discarded).toEqual([5]);
	});

	it("get the normal timer when the setting is off", async () => {
		settings.sleepUnvisited = false;
		const tab = youtubeTab(5);
		const t = setup([tab]);
		await t.engine.onCreated({ ...tab, status: "loading" });
		await t.engine.onUpdated(5, { status: "complete" }, tab);
		expect(t.discarded).toEqual([]);
		await t.engine.onContentMessage(5, {
			type: "hidden",
			playing: false,
			draft: false,
		});
		expect(t.alarms.get(5)).toBe(30);
	});

	it("aren't treated as unvisited once I switch to them", async () => {
		const tab = youtubeTab(5, { status: "loading", title: undefined });
		const t = setup([tab]);
		await t.engine.onCreated(tab);
		t.patchTab(5, { active: true });
		await t.engine.onActivated(5, 1);
		expect((await t.states.get(5)).unvisited).toBe(false);
	});

	it("ignores tabs created in the foreground", async () => {
		const t = setup([]);
		await t.engine.onCreated(youtubeTab(5, { active: true }));
		expect((await t.states.get(5)).unvisited).toBe(false);
	});
});

describe("tab updates", () => {
	it("audible clears the alarm and silence starts it again", async () => {
		const t = setup([youtubeTab(1)]);
		t.alarms.set(1, SEEDED);
		const loud = t.patchTab(1, { audible: true });
		await t.engine.onUpdated(1, { audible: true }, loud);
		expect(t.alarms.has(1)).toBe(false);
		const quiet = t.patchTab(1, { audible: false });
		await t.engine.onUpdated(1, { audible: false }, quiet);
		expect(t.alarms.get(1)).toBe(30);
	});

	it("moving to YouTube Music clears the alarm", async () => {
		const t = setup([youtubeTab(1)]);
		t.alarms.set(1, SEEDED);
		const music = t.patchTab(1, { url: MUSIC });
		await t.engine.onUpdated(1, { url: MUSIC }, music);
		expect(t.alarms.has(1)).toBe(false);
	});

	it("closing a tab forgets it", async () => {
		const t = setup([youtubeTab(1)]);
		await t.states.update(1, { keepAwake: true });
		t.alarms.set(1, SEEDED);
		await t.engine.onRemoved(1);
		expect(t.alarms.has(1)).toBe(false);
		expect((await t.states.get(1)).keepAwake).toBe(false);
	});
});

describe("keep awake", () => {
	it("clears the alarm, and turning it off starts one", async () => {
		const t = setup([youtubeTab(1)]);
		t.alarms.set(1, SEEDED);
		await t.engine.setKeepAwake(1, true);
		expect(t.alarms.has(1)).toBe(false);
		expect(await t.engine.isKeptAwake(1)).toBe(true);
		await t.engine.setKeepAwake(1, false);
		expect(t.alarms.get(1)).toBe(30);
	});
});

describe("settings changes", () => {
	it("restart timers with the new timeout", async () => {
		const t = setup([youtubeTab(1), youtubeTab(2)]);
		t.alarms.set(1, SEEDED);
		t.alarms.set(2, SEEDED);
		settings.idleMinutes = 45;
		await t.engine.onSettingsChanged();
		expect(t.alarms.get(1)).toBe(45);
		expect(t.alarms.get(2)).toBe(45);
	});

	it("clear every alarm when the extension is turned off", async () => {
		const t = setup([youtubeTab(1), youtubeTab(2)]);
		t.alarms.set(1, SEEDED);
		t.alarms.set(2, SEEDED);
		settings.enabled = false;
		await t.engine.onSettingsChanged();
		expect(t.alarms.size).toBe(0);
	});
});

describe("sleep all", () => {
	it("sleeps hidden idle tabs and skips active and playing ones", async () => {
		const t = setup([youtubeTab(1, { active: true }), youtubeTab(2), youtubeTab(3)]);
		await t.states.update(3, { playing: true });
		expect(await t.engine.sleepAll()).toBe(1);
		expect(t.discarded).toEqual([2]);
	});

	it("sleeps tabs ten at a time", async () => {
		const ids = Array.from({ length: 25 }, (_, i) => i + 1);
		const t = setup(ids.map((id) => youtubeTab(id)));
		expect(await t.engine.sleepAll()).toBe(25);
		expect([...t.discarded].sort((a, b) => a - b)).toEqual(ids);
		expect(t.mostPreparedAtOnce()).toBe(10);
	});
});

describe("install", () => {
	it("injects into awake YouTube tabs and starts their timers", async () => {
		const t = setup([youtubeTab(1), youtubeTab(2, { discarded: true }), youtubeTab(3, { active: true })]);
		await t.engine.onInstalled();
		expect(t.injected).toEqual([1, 3]);
		expect(t.alarms.get(1)).toBe(30);
		expect(t.alarms.has(2)).toBe(false);
		expect(t.alarms.has(3)).toBe(false);
	});
});

describe("summary", () => {
	it("counts asleep, playing and idle tabs", async () => {
		const t = setup([
			youtubeTab(1, { active: true }),
			youtubeTab(2, { discarded: true }),
			youtubeTab(3),
			youtubeTab(4, { audible: true }),
		]);
		await t.states.update(3, { playing: true });
		expect(await t.engine.summary(1)).toEqual({
			total: 4,
			asleep: 1,
			playing: 2,
			idle: 1,
			currentTab: { id: 1, keepAwake: false },
		});
		expect((await t.engine.summary(99)).currentTab).toBeNull();
	});
});
