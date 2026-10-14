import type { Settings } from "@/core/settings";
import type { TabState } from "@/core/tab-state";
import { isMusicUrl, isYouTubeUrl } from "@/sites/youtube";

export type LiveTab = {
	id: number;
	windowId: number;
	active: boolean;
	pinned: boolean;
	audible: boolean;
	discarded: boolean;
	url: string | undefined;
	title: string | undefined;
	status: string | undefined;
};

export type StayAwakeReason =
	| "disabled"
	| "not-youtube"
	| "music"
	| "active"
	| "asleep"
	| "playing"
	| "pinned"
	| "draft"
	| "kept-awake"
	| "offline";

export type Decision = { sleep: true } | { sleep: false; reason: StayAwakeReason };

const awake = (reason: StayAwakeReason): Decision => ({ sleep: false, reason });

export function decide(tab: LiveTab, state: TabState, settings: Settings, online: boolean): Decision {
	if (!settings.enabled) return awake("disabled");
	if (!isYouTubeUrl(tab.url)) return awake("not-youtube");
	if (settings.keepMusic && isMusicUrl(tab.url)) return awake("music");
	if (tab.active) return awake("active");
	if (tab.discarded) return awake("asleep");
	if (state.playing || tab.audible) return awake("playing");
	if (settings.keepPinned && tab.pinned) return awake("pinned");
	if (settings.keepDrafts && state.draft) return awake("draft");
	if (state.keepAwake) return awake("kept-awake");
	if (settings.keepWhileOffline && !online) return awake("offline");
	return { sleep: true };
}
