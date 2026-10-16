import type { ContentMessage, PrepareSleepMessage, PrepareSleepResult, Summary } from "@/core/messages";
import { decide, type LiveTab } from "@/core/policy";
import type { Settings } from "@/core/settings";
import { EMPTY_TAB_STATE, type TabStateStore } from "@/core/tab-state";
import { hasRealTitle, isYouTubeUrl } from "@/sites/youtube";

export const UNVISITED_FALLBACK_MS = 10_000;

export type Ports = {
	getTab(tabId: number): Promise<LiveTab | null>;
	queryYouTubeTabs(windowId?: number): Promise<LiveTab[]>;
	/** The tab's id after the discard (it can change), or null if it failed */
	discard(tabId: number): Promise<number | null>;
	/** Null when the tab has no content script listening */
	prepareSleep(tabId: number, message: PrepareSleepMessage): Promise<PrepareSleepResult | null>;
	/** Best effort, lets a page that isn't asked first still show the sleeping favicon */
	markAsleep(tabId: number): Promise<void>;
	setAlarm(tabId: number, delayMinutes: number): Promise<void>;
	clearAlarm(tabId: number): Promise<void>;
	hasAlarm(tabId: number): Promise<boolean>;
	clearAllAlarms(): Promise<void>;
	injectContentScript(tabId: number): Promise<void>;
	isOnline(): boolean;
	later(callback: () => Promise<void>, ms: number): void;
};

export type TabChange = {
	status?: string;
	title?: string;
	url?: string;
	audible?: boolean;
	pinned?: boolean;
	discarded?: boolean;
};

export type Engine = ReturnType<typeof createEngine>;

export function createEngine(ports: Ports, states: TabStateStore, loadSettings: () => Promise<Settings>) {
	async function evaluate(tab: LiveTab, restart: boolean): Promise<void> {
		const settings = await loadSettings();
		const state = await states.get(tab.id);
		if (!decide(tab, state, settings, ports.isOnline()).sleep) {
			await ports.clearAlarm(tab.id);
			return;
		}
		if (restart || !(await ports.hasAlarm(tab.id))) {
			await ports.setAlarm(tab.id, settings.idleMinutes);
		}
	}

	async function forget(tabId: number): Promise<void> {
		await ports.clearAlarm(tabId);
		await states.remove(tabId);
	}

	async function reevaluate(tabId: number, restart = false): Promise<void> {
		const tab = await ports.getTab(tabId);
		if (!tab) {
			await forget(tabId);
			return;
		}
		await evaluate(tab, restart);
	}

	async function sleep(tab: LiveTab, settings: Settings, askPage: boolean): Promise<boolean> {
		if (askPage) {
			const result = await ports.prepareSleep(tab.id, {
				type: "prepare-sleep",
				rememberPosition: settings.rememberPosition,
				keepDrafts: settings.keepDrafts,
			});
			if (result && !result.ok) {
				if (result.reason === "playing") {
					await states.update(tab.id, { playing: true });
				} else if (result.reason === "draft") {
					await states.update(tab.id, { draft: true });
				} else if (result.reason === "timeout") {
					await ports.setAlarm(tab.id, settings.idleMinutes);
				}
				return false;
			}
		} else {
			await ports.markAsleep(tab.id);
		}
		await ports.clearAlarm(tab.id);
		const newId = await ports.discard(tab.id);
		if (newId === null) return false;
		if (newId !== tab.id) await states.move(tab.id, newId);
		await states.update(newId, { unvisited: false, playing: false });
		return true;
	}

	async function sleepUnvisited(tabId: number): Promise<void> {
		const tab = await ports.getTab(tabId);
		if (!tab) return;
		const state = await states.get(tabId);
		const settings = await loadSettings();
		if (!state.unvisited || !settings.sleepUnvisited) return;
		if (!decide(tab, state, settings, ports.isOnline()).sleep) return;
		await sleep(tab, settings, false);
	}

	return {
		reevaluate,

		async onActivated(tabId: number, windowId: number): Promise<void> {
			await ports.clearAlarm(tabId);
			if ((await states.get(tabId)).unvisited) {
				await states.update(tabId, { unvisited: false });
			}
			// Chrome doesn't say which tab was active before, but an active tab
			// never has an alarm, so "create if missing" only starts the timer
			// of the tab I just left
			for (const tab of await ports.queryYouTubeTabs(windowId)) {
				if (tab.id !== tabId) await evaluate(tab, false);
			}
		},

		async onCreated(tab: LiveTab): Promise<void> {
			if (!tab.active) await states.update(tab.id, { unvisited: true });
		},

		async onUpdated(tabId: number, change: TabChange, tab: LiveTab): Promise<void> {
			if (!isYouTubeUrl(tab.url)) return;
			if (!tab.active && (await states.get(tabId)).unvisited) {
				if (tab.status === "complete" && hasRealTitle(tab.title, tab.url)) {
					await sleepUnvisited(tabId);
					return;
				}
				if (change.status === "complete") {
					ports.later(() => sleepUnvisited(tabId), UNVISITED_FALLBACK_MS);
				}
			}
			if (change.audible !== undefined || change.pinned !== undefined || change.url !== undefined) {
				await reevaluate(tabId);
			}
		},

		async onRemoved(tabId: number): Promise<void> {
			await forget(tabId);
		},

		async onContentMessage(tabId: number, message: ContentMessage): Promise<void> {
			switch (message.type) {
				case "visible":
				case "activity":
					await ports.clearAlarm(tabId);
					return;
				case "hidden":
					await states.update(tabId, {
						playing: message.playing,
						draft: message.draft,
					});
					await reevaluate(tabId, true);
					return;
				case "playback":
					await states.update(tabId, { playing: message.playing });
					await reevaluate(tabId, !message.playing);
					return;
				case "draft":
					await states.update(tabId, { draft: message.draft });
					await reevaluate(tabId, !message.draft);
					return;
			}
		},

		async onAlarm(tabId: number): Promise<void> {
			const tab = await ports.getTab(tabId);
			if (!tab) {
				await forget(tabId);
				return;
			}
			const settings = await loadSettings();
			const state = await states.get(tabId);
			if (!decide(tab, state, settings, ports.isOnline()).sleep) return;
			await sleep(tab, settings, true);
		},

		async onStartup(): Promise<void> {
			// tab ids start over every session, so last session's alarms could
			// point at unrelated tabs
			await ports.clearAllAlarms();
			const settings = await loadSettings();
			const online = ports.isOnline();
			const tabs = await ports.queryYouTubeTabs();
			await Promise.all(
				tabs
					.filter((tab) => decide(tab, EMPTY_TAB_STATE, settings, online).sleep)
					.map((tab) => sleep(tab, settings, false)),
			);
		},

		async onInstalled(): Promise<void> {
			for (const tab of await ports.queryYouTubeTabs()) {
				if (!tab.discarded) await ports.injectContentScript(tab.id);
				await evaluate(tab, true);
			}
		},

		async onSettingsChanged(): Promise<void> {
			for (const tab of await ports.queryYouTubeTabs()) {
				await evaluate(tab, true);
			}
		},

		async sleepAll(): Promise<number> {
			const settings = await loadSettings();
			const online = ports.isOnline();
			let slept = 0;
			for (const tab of await ports.queryYouTubeTabs()) {
				const state = await states.get(tab.id);
				if (!decide(tab, state, settings, online).sleep) continue;
				if (await sleep(tab, settings, true)) slept++;
			}
			return slept;
		},

		async setKeepAwake(tabId: number, keepAwake: boolean): Promise<void> {
			await states.update(tabId, { keepAwake });
			await reevaluate(tabId);
		},

		async isKeptAwake(tabId: number): Promise<boolean> {
			return (await states.get(tabId)).keepAwake;
		},

		async summary(currentTabId?: number): Promise<Summary> {
			const tabs = await ports.queryYouTubeTabs();
			const summary: Summary = {
				total: tabs.length,
				asleep: 0,
				idle: 0,
				playing: 0,
				currentTab: null,
			};
			for (const tab of tabs) {
				const state = await states.get(tab.id);
				if (tab.discarded) summary.asleep++;
				else if (state.playing || tab.audible) summary.playing++;
				else summary.idle++;
				if (tab.id === currentTabId) {
					summary.currentTab = {
						id: tab.id,
						keepAwake: state.keepAwake,
					};
				}
			}
			return summary;
		},
	};
}
