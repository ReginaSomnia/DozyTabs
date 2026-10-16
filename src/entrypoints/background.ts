import { browser, type Browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createEngine, type Ports } from "@/core/engine";
import {
	isContentMessage,
	isPageRequest,
	isPopupRequest,
	type MarkAsleepMessage,
	type PageRequest,
	type PageState,
	type PopupRequest,
	type PrepareSleepResult,
} from "@/core/messages";
import type { LiveTab } from "@/core/policy";
import { loadSettings, onSettingsChanged } from "@/core/settings";
import { createTabStateStore } from "@/core/tab-state";
import { isSleepFavicon } from "@/sites/sleep-favicon";
import { YOUTUBE_MATCH_PATTERNS } from "@/sites/youtube";

const ALARM_PREFIX = "sleep:";
const PREPARE_TIMEOUT_MS = 1000;
const MARK_TIMEOUT_MS = 300;
// Firefox showed it within 150 ms in the probe, so this only runs out when
// something went wrong, and the tab still sleeps
const FAVICON_TIMEOUT_MS = 500;
const MENU_KEEP_AWAKE = "keep-awake";
const MENU_SLEEP_ALL = "sleep-all";

type MenuContexts = [Browser.contextMenus.ContextType, ...Browser.contextMenus.ContextType[]];

function toLiveTab(tab: Browser.tabs.Tab): LiveTab | null {
	if (tab.id === undefined) return null;
	return {
		id: tab.id,
		windowId: tab.windowId,
		active: tab.active,
		pinned: tab.pinned,
		audible: tab.audible ?? false,
		discarded: tab.discarded ?? false,
		url: tab.url,
		title: tab.title,
		status: tab.status,
	};
}

const alarmName = (tabId: number) => `${ALARM_PREFIX}${tabId}`;

function isExtensionPage(url: string | undefined): boolean {
	if (!url) return false;
	try {
		return new URL(url).origin === self.location.origin;
	} catch {
		return false;
	}
}

function logError(error: unknown): void {
	console.error("[dozy-tabs]", error);
}

function createBrowserPorts(): Ports {
	return {
		async getTab(tabId) {
			try {
				return toLiveTab(await browser.tabs.get(tabId));
			} catch {
				return null;
			}
		},
		async queryYouTubeTabs(windowId) {
			const tabs = await browser.tabs.query(
				windowId === undefined ? { url: YOUTUBE_MATCH_PATTERNS } : { url: YOUTUBE_MATCH_PATTERNS, windowId },
			);
			return tabs.map(toLiveTab).filter((tab) => tab !== null);
		},
		async discard(tabId) {
			try {
				const result: Browser.tabs.Tab | undefined = await browser.tabs.discard(tabId);
				if (result?.id !== undefined) return result.id;
				// Firefox resolves with nothing, so check the tab itself
				const after = await browser.tabs.get(tabId);
				return after.discarded ? tabId : null;
			} catch {
				return null;
			}
		},
		async prepareSleep(tabId, message) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<PrepareSleepResult>((resolve) => {
				timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), PREPARE_TIMEOUT_MS);
			});
			try {
				const reply = browser.tabs.sendMessage(tabId, message) as Promise<PrepareSleepResult | undefined>;
				return (await Promise.race([reply, timeout])) ?? null;
			} catch {
				return null;
			} finally {
				clearTimeout(timer);
			}
		},
		async markAsleep(tabId) {
			const message: MarkAsleepMessage = { type: "mark-asleep" };
			// no content script yet (still loading or not restored) means the
			// tab just keeps its normal favicon
			const reply = browser.tabs.sendMessage(tabId, message).then(
				(answer) => answer === true,
				() => false,
			);
			return Promise.race([
				reply,
				new Promise<boolean>((resolve) => setTimeout(() => resolve(false), MARK_TIMEOUT_MS)),
			]);
		},
		waitForSleepFavicon(tabId) {
			return new Promise<void>((resolve) => {
				const done = () => {
					clearTimeout(timer);
					browser.tabs.onUpdated.removeListener(onUpdated);
					resolve();
				};
				const onUpdated = (id: number, change: Browser.tabs.OnUpdatedInfo) => {
					if (id === tabId && isSleepFavicon(change.favIconUrl)) done();
				};
				const timer = setTimeout(done, FAVICON_TIMEOUT_MS);
				browser.tabs.onUpdated.addListener(onUpdated);
				// Chrome usually shows it before this even starts listening
				browser.tabs.get(tabId).then((tab) => {
					if (isSleepFavicon(tab.favIconUrl)) done();
				}, done);
			});
		},
		async setAlarm(tabId, delayMinutes) {
			await browser.alarms.create(alarmName(tabId), {
				delayInMinutes: delayMinutes,
			});
		},
		async clearAlarm(tabId) {
			await browser.alarms.clear(alarmName(tabId));
		},
		async hasAlarm(tabId) {
			return Boolean(await browser.alarms.get(alarmName(tabId)));
		},
		async clearAllAlarms() {
			await browser.alarms.clearAll();
		},
		async injectContentScript(tabId) {
			try {
				await browser.scripting.executeScript({
					target: { tabId },
					files: ["/content-scripts/youtube.js"],
				});
			} catch (error) {
				logError(error);
			}
		},
		isOnline: () => navigator.onLine,
		later(callback, ms) {
			setTimeout(() => {
				callback().catch(logError);
			}, ms);
		},
	};
}

export default defineBackground(() => {
	const engine = createEngine(createBrowserPorts(), createTabStateStore(), loadSettings);
	const run = (task: Promise<unknown>) => {
		task.catch(logError);
	};

	async function createMenus(): Promise<void> {
		await browser.contextMenus.removeAll();
		const contexts = (import.meta.env.FIREFOX ? ["page", "video", "tab"] : ["page", "video"]) as MenuContexts;
		browser.contextMenus.create({
			id: MENU_KEEP_AWAKE,
			type: "checkbox",
			checked: false,
			title: browser.i18n.getMessage("menuKeepAwake"),
			contexts,
			documentUrlPatterns: YOUTUBE_MATCH_PATTERNS,
		});
		browser.contextMenus.create({
			id: MENU_SLEEP_ALL,
			title: browser.i18n.getMessage("menuSleepAll"),
			contexts,
			documentUrlPatterns: YOUTUBE_MATCH_PATTERNS,
		});
	}

	async function syncKeepAwakeMenu(tabId: number): Promise<void> {
		await browser.contextMenus.update(MENU_KEEP_AWAKE, {
			checked: await engine.isKeptAwake(tabId),
		});
	}

	async function syncMenuForWindow(windowId: number): Promise<void> {
		const [tab] = await browser.tabs.query({ active: true, windowId });
		if (tab?.id !== undefined) await syncKeepAwakeMenu(tab.id);
	}

	async function handlePopup(request: PopupRequest): Promise<unknown> {
		switch (request.type) {
			case "get-summary":
				return engine.summary(request.tabId);
			case "sleep-all":
				return engine.sleepAll();
			case "set-keep-awake":
				await engine.setKeepAwake(request.tabId, request.keepAwake);
				await syncKeepAwakeMenu(request.tabId);
				return null;
		}
	}

	async function handlePage(tabId: number, request: PageRequest): Promise<unknown> {
		switch (request.type) {
			case "page-state": {
				const state: PageState = {
					enabled: (await loadSettings()).enabled,
					keepAwake: await engine.isKeptAwake(tabId),
				};
				return state;
			}
			case "page-set-keep-awake":
				await engine.setKeepAwake(tabId, request.keepAwake);
				await syncKeepAwakeMenu(tabId);
				return null;
			case "page-sleep-all":
				return engine.sleepAll();
			case "page-open-options":
				await browser.runtime.openOptionsPage();
				return null;
		}
	}

	const reply = (task: Promise<unknown>, sendResponse: (response: unknown) => void) => {
		task.then(sendResponse, (error: unknown) => {
			logError(error);
			sendResponse(null);
		});
	};

	browser.runtime.onInstalled.addListener(({ reason }) => {
		run(createMenus());
		if (reason === "install" || reason === "update") {
			run(engine.onInstalled());
		}
	});

	browser.runtime.onStartup.addListener(() => {
		// Chrome keeps menus across restarts, but I'm not sure Firefox's event
		// pages do, and rebuilding them is harmless
		run(createMenus());
		run(engine.onStartup());
	});

	browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
		run(engine.onActivated(tabId, windowId).then(() => syncKeepAwakeMenu(tabId)));
	});

	browser.windows.onFocusChanged.addListener((windowId) => {
		if (windowId !== browser.windows.WINDOW_ID_NONE) {
			run(syncMenuForWindow(windowId));
		}
	});

	browser.tabs.onCreated.addListener((tab) => {
		const live = toLiveTab(tab);
		if (live) run(engine.onCreated(live));
	});

	browser.tabs.onUpdated.addListener((tabId, change, tab) => {
		const live = toLiveTab(tab);
		if (live) run(engine.onUpdated(tabId, change, live));
	});

	browser.tabs.onRemoved.addListener((tabId) => {
		run(engine.onRemoved(tabId));
	});

	browser.alarms.onAlarm.addListener(({ name }) => {
		if (!name.startsWith(ALARM_PREFIX)) return;
		const tabId = Number(name.slice(ALARM_PREFIX.length));
		if (Number.isInteger(tabId)) run(engine.onAlarm(tabId));
	});

	onSettingsChanged(() => {
		run(engine.onSettingsChanged());
	});

	browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (sender.id !== browser.runtime.id) return false;
		// extension pages can have a tab too (the popup opened as a tab), so
		// the origin is what tells them apart from the content script
		if (isExtensionPage(sender.url)) {
			if (!isPopupRequest(message)) return false;
			reply(handlePopup(message), sendResponse);
			return true;
		}
		const tabId = sender.tab?.id;
		if (tabId === undefined) return false;
		if (isPageRequest(message)) {
			reply(handlePage(tabId, message), sendResponse);
			return true;
		}
		if (isContentMessage(message)) run(engine.onContentMessage(tabId, message));
		return false;
	});

	browser.contextMenus.onClicked.addListener((info, tab) => {
		if (info.menuItemId === MENU_SLEEP_ALL) {
			run(engine.sleepAll());
			return;
		}
		const tabId = tab?.id;
		if (info.menuItemId === MENU_KEEP_AWAKE && tabId !== undefined) {
			run(engine.setKeepAwake(tabId, info.checked === true).then(() => syncKeepAwakeMenu(tabId)));
		}
	});
});
