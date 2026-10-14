import { describe, expect, it } from "vitest";
import { hasRealTitle, isMusicUrl, isYouTubeUrl, withTimestamp } from "@/sites/youtube";

const WATCH = "https://www.youtube.com/watch?v=abc";

describe("isYouTubeUrl", () => {
	it.each([
		[WATCH, true],
		["https://youtube.com/", true],
		["https://m.youtube.com/watch?v=abc", true],
		["https://music.youtube.com/watch?v=abc", true],
		["http://www.youtube.com/", true],
		["https://notyoutube.com/", false],
		["https://youtube.com.evil.example/", false],
		["chrome://newtab/", false],
		["not a url", false],
		[undefined, false],
	])("%s is %s", (url, expected) => {
		expect(isYouTubeUrl(url)).toBe(expected);
	});
});

describe("isMusicUrl", () => {
	it("matches music.youtube.com only", () => {
		expect(isMusicUrl("https://music.youtube.com/watch?v=abc")).toBe(true);
		expect(isMusicUrl(WATCH)).toBe(false);
		expect(isMusicUrl(undefined)).toBe(false);
	});
});

describe("withTimestamp", () => {
	it("adds t to a watch url", () => {
		expect(withTimestamp(WATCH, 95.7)).toBe(`${WATCH}&t=95s`);
	});

	it("replaces an existing t and keeps the other params in place", () => {
		expect(withTimestamp(`${WATCH}&t=10s&list=xyz`, 300)).toBe(`${WATCH}&t=300s&list=xyz`);
	});

	it.each([
		["the first 5 seconds", WATCH, 4.9],
		["Shorts", "https://www.youtube.com/shorts/abc", 60],
		["search results", "https://www.youtube.com/results?search_query=x", 60],
		["a watch url without a video id", "https://www.youtube.com/watch", 60],
		["NaN", WATCH, Number.NaN],
		["Infinity", WATCH, Number.POSITIVE_INFINITY],
		["another site", "https://example.com/watch?v=abc", 60],
	])("skips %s", (_name, url, seconds) => {
		expect(withTimestamp(url, seconds)).toBeNull();
	});
});

describe("hasRealTitle", () => {
	it.each([
		["How CPUs work - YouTube", WATCH, true],
		["(3) YouTube", "https://www.youtube.com/", true],
		["YouTube", WATCH, false],
		["  ", WATCH, false],
		[undefined, WATCH, false],
		["www.youtube.com/watch?v=abc", WATCH, false],
	])("%s is %s", (title, url, expected) => {
		expect(hasRealTitle(title, url)).toBe(expected);
	});
});
