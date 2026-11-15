import { describe, expect, it } from "vitest";
import {
	isContentMessage,
	isMarkAsleepMessage,
	isPageRequest,
	isPauseAutoplayMessage,
	isPopupRequest,
	routeMessage,
} from "@/core/messages";

describe("isPageRequest", () => {
	it.each([
		{ type: "page-state" },
		{ type: "page-set-keep-awake", keepAwake: true },
		{ type: "page-sleep-all" },
		{ type: "page-open-options" },
	])("accepts $type", (message) => {
		expect(isPageRequest(message)).toBe(true);
	});

	it("doesn't take the popup's or the content script's messages", () => {
		expect(isPageRequest({ type: "sleep-all" })).toBe(false);
		expect(isPageRequest({ type: "hidden", playing: false, draft: false })).toBe(false);
		expect(isPopupRequest({ type: "page-sleep-all" })).toBe(false);
		expect(isContentMessage({ type: "page-state" })).toBe(false);
	});

	it.each([null, "page-state", 1, {}])("rejects %s", (message) => {
		expect(isPageRequest(message)).toBe(false);
	});

	it.each([{ type: "page-set-keep-awake" }, { type: "page-set-keep-awake", keepAwake: "true" }])(
		"rejects %j, keepAwake has to be true or false",
		(message) => {
			expect(isPageRequest(message)).toBe(false);
		},
	);
});

describe("isContentMessage", () => {
	it.each([
		{ type: "visible" },
		{ type: "activity" },
		{ type: "hidden", playing: true, draft: false },
		{ type: "playback", playing: false },
		{ type: "draft", draft: true },
	])("accepts $type", (message) => {
		expect(isContentMessage(message)).toBe(true);
	});

	it.each([
		{ type: "hidden", playing: "yes", draft: false },
		{ type: "hidden", playing: true },
		{ type: "playback" },
		{ type: "playback", playing: 1 },
		{ type: "draft", draft: "a very long text" },
	])("rejects %j, what it stores has to be true or false", (message) => {
		expect(isContentMessage(message)).toBe(false);
	});
});

describe("isPopupRequest", () => {
	it.each([
		{ type: "get-summary", tabId: 3 },
		{ type: "get-summary" },
		{ type: "sleep-all" },
		{ type: "set-keep-awake", tabId: 3, keepAwake: true },
	])("accepts %j", (message) => {
		expect(isPopupRequest(message)).toBe(true);
	});

	it.each([
		{ type: "get-summary", tabId: "3" },
		{ type: "set-keep-awake", keepAwake: true },
		{ type: "set-keep-awake", tabId: 1.5, keepAwake: true },
		{ type: "set-keep-awake", tabId: 3, keepAwake: 1 },
	])("rejects %j", (message) => {
		expect(isPopupRequest(message)).toBe(false);
	});
});

describe("routeMessage", () => {
	const EXTENSION = { id: "dozy", origin: "chrome-extension://dozy" };
	const popup = { id: "dozy", url: "chrome-extension://dozy/popup.html" };
	const page = { id: "dozy", url: "https://www.youtube.com/watch?v=abc", tab: { id: 7 } };
	const keepAwake = { type: "set-keep-awake", tabId: 9, keepAwake: true };

	it("takes the popup's requests from an extension page", () => {
		expect(routeMessage(keepAwake, popup, EXTENSION)).toEqual({ from: "popup", request: keepAwake });
	});

	it("still takes them when the popup is open as a tab", () => {
		const route = routeMessage({ type: "sleep-all" }, { ...popup, tab: { id: 4 } }, EXTENSION);
		expect(route).toEqual({ from: "popup", request: { type: "sleep-all" } });
	});

	it("gives the top bar button's requests the tab they came from", () => {
		const request = { type: "page-set-keep-awake", keepAwake: true };
		expect(routeMessage(request, page, EXTENSION)).toEqual({ from: "page", tabId: 7, request });
	});

	it("gives the content script's messages the tab they came from", () => {
		const message = { type: "playback", playing: true };
		expect(routeMessage(message, page, EXTENSION)).toEqual({ from: "content", tabId: 7, message });
	});

	it("doesn't let a YouTube page send the popup's requests, they can name any tab", () => {
		expect(routeMessage(keepAwake, page, EXTENSION)).toBeNull();
	});

	it("doesn't take the page's messages from an extension page", () => {
		expect(routeMessage({ type: "page-sleep-all" }, popup, EXTENSION)).toBeNull();
		expect(routeMessage({ type: "visible" }, popup, EXTENSION)).toBeNull();
	});

	it("ignores other extensions", () => {
		expect(routeMessage({ type: "sleep-all" }, { ...popup, id: "other" }, EXTENSION)).toBeNull();
		expect(routeMessage({ type: "visible" }, { ...page, id: "other" }, EXTENSION)).toBeNull();
	});

	it("ignores a page message that comes without a tab", () => {
		expect(routeMessage({ type: "visible" }, { id: "dozy", url: page.url }, EXTENSION)).toBeNull();
		expect(routeMessage({ type: "visible" }, { id: "dozy", tab: { id: 7 }, url: "not a url" }, EXTENSION)).toEqual({
			from: "content",
			tabId: 7,
			message: { type: "visible" },
		});
	});
});

describe("isMarkAsleepMessage", () => {
	it("accepts only mark-asleep", () => {
		expect(isMarkAsleepMessage({ type: "mark-asleep" })).toBe(true);
		expect(isMarkAsleepMessage({ type: "prepare-sleep" })).toBe(false);
	});
});

describe("isPauseAutoplayMessage", () => {
	it("accepts only pause-autoplay", () => {
		expect(isPauseAutoplayMessage({ type: "pause-autoplay" })).toBe(true);
		expect(isPauseAutoplayMessage({ type: "mark-asleep" })).toBe(false);
	});
});
