import { describe, expect, it } from "vitest";
import { isSleepFavicon, SLEEP_FAVICON } from "@/sites/sleep-favicon";

const svg = decodeURIComponent(SLEEP_FAVICON.replace("data:image/svg+xml,", ""));

describe("SLEEP_FAVICON", () => {
	it("is YouTube's logo with 💤 over its bottom right corner", () => {
		expect(SLEEP_FAVICON.startsWith("data:image/svg+xml,")).toBe(true);
		expect(svg).toContain('fill="#ff0033"');
		expect(svg).toMatch(/<text [^>]*text-anchor="end"[^>]*>💤<\/text>/);
	});

	it("is recognized in the tab strip as given, and as Firefox stores it", () => {
		expect(isSleepFavicon(SLEEP_FAVICON)).toBe(true);
		expect(isSleepFavicon(`data:image/svg+xml;base64,${btoa("<svg/>")}`)).toBe(true);
		expect(isSleepFavicon("https://www.youtube.com/s/desktop/abc/img/favicon_32x32.png")).toBe(false);
		expect(isSleepFavicon("data:image/x-icon;base64,AAABAA==")).toBe(false);
		expect(isSleepFavicon(undefined)).toBe(false);
	});

	it("doesn't load anything from outside itself", () => {
		expect(svg).not.toContain("<image");
		expect(svg).not.toContain("href");
	});
});
