export type ContentMessage =
	| { type: "visible" }
	| { type: "hidden"; playing: boolean; draft: boolean }
	| { type: "activity" }
	| { type: "playback"; playing: boolean }
	| { type: "draft"; draft: boolean };

export type PrepareSleepMessage = {
	type: "prepare-sleep";
	rememberPosition: boolean;
	keepDrafts: boolean;
};

export type PrepareSleepResult = { ok: true } | { ok: false; reason: "visible" | "playing" | "draft" | "timeout" };

export type PopupRequest =
	| { type: "get-summary"; tabId: number | undefined }
	| { type: "sleep-all" }
	| { type: "set-keep-awake"; tabId: number; keepAwake: boolean };

export type Summary = {
	total: number;
	asleep: number;
	idle: number;
	playing: number;
	currentTab: { id: number; keepAwake: boolean } | null;
};

const CONTENT_TYPES = new Set(["visible", "hidden", "activity", "playback", "draft"]);
const POPUP_TYPES = new Set(["get-summary", "sleep-all", "set-keep-awake"]);

function typeOf(message: unknown): string | undefined {
	if (typeof message !== "object" || message === null) return undefined;
	const type = (message as { type?: unknown }).type;
	return typeof type === "string" ? type : undefined;
}

export function isContentMessage(message: unknown): message is ContentMessage {
	return CONTENT_TYPES.has(typeOf(message) ?? "");
}

export function isPrepareSleepMessage(message: unknown): message is PrepareSleepMessage {
	return typeOf(message) === "prepare-sleep";
}

export function isPopupRequest(message: unknown): message is PopupRequest {
	return POPUP_TYPES.has(typeOf(message) ?? "");
}
