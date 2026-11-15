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

export type MarkAsleepMessage = { type: "mark-asleep" };

export type PauseAutoplayMessage = { type: "pause-autoplay" };

/** From the button the content script adds to YouTube's top bar */
export type PageRequest =
	| { type: "page-state" }
	| { type: "page-set-keep-awake"; keepAwake: boolean }
	| { type: "page-sleep-all" }
	| { type: "page-open-options" };

export type PageState = { enabled: boolean; keepAwake: boolean };

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

type Fields = Record<string, unknown>;

function fieldsOf(message: unknown): Fields | null {
	return typeof message === "object" && message !== null ? (message as Fields) : null;
}

const isFlag = (value: unknown) => typeof value === "boolean";

export function isContentMessage(message: unknown): message is ContentMessage {
	const fields = fieldsOf(message);
	switch (fields?.type) {
		case "visible":
		case "activity":
			return true;
		case "hidden":
			return isFlag(fields.playing) && isFlag(fields.draft);
		case "playback":
			return isFlag(fields.playing);
		case "draft":
			return isFlag(fields.draft);
		default:
			return false;
	}
}

export function isPageRequest(message: unknown): message is PageRequest {
	const fields = fieldsOf(message);
	switch (fields?.type) {
		case "page-state":
		case "page-sleep-all":
		case "page-open-options":
			return true;
		case "page-set-keep-awake":
			return isFlag(fields.keepAwake);
		default:
			return false;
	}
}

export function isPopupRequest(message: unknown): message is PopupRequest {
	const fields = fieldsOf(message);
	switch (fields?.type) {
		case "sleep-all":
			return true;
		case "get-summary":
			return fields.tabId === undefined || Number.isInteger(fields.tabId);
		case "set-keep-awake":
			return Number.isInteger(fields.tabId) && isFlag(fields.keepAwake);
		default:
			return false;
	}
}

export function isPrepareSleepMessage(message: unknown): message is PrepareSleepMessage {
	return fieldsOf(message)?.type === "prepare-sleep";
}

export function isMarkAsleepMessage(message: unknown): message is MarkAsleepMessage {
	return fieldsOf(message)?.type === "mark-asleep";
}

export function isPauseAutoplayMessage(message: unknown): message is PauseAutoplayMessage {
	return fieldsOf(message)?.type === "pause-autoplay";
}

export type Sender = { id?: string; url?: string; tab?: { id?: number } };

export type Route =
	| { from: "popup"; request: PopupRequest }
	| { from: "page"; tabId: number; request: PageRequest }
	| { from: "content"; tabId: number; message: ContentMessage };

export function routeMessage(
	message: unknown,
	sender: Sender,
	extension: { id: string; origin: string },
): Route | null {
	if (sender.id !== extension.id) return null;
	// extension pages can have a tab too (the popup opened as a tab), so
	// the origin is what tells them apart from the content script
	if (sender.url?.startsWith(`${extension.origin}/`)) {
		return isPopupRequest(message) ? { from: "popup", request: message } : null;
	}
	const tabId = sender.tab?.id;
	if (tabId === undefined) return null;
	if (isPageRequest(message)) return { from: "page", tabId, request: message };
	if (isContentMessage(message)) return { from: "content", tabId, message };
	return null;
}
