import { describe, expect, it } from "vitest";
import {
	isContentMessage,
	isMarkAsleepMessage,
	isPageRequest,
	isPauseAutoplayMessage,
	isPopupRequest,
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
