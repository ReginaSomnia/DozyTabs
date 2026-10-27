import { describe, expect, it } from "vitest";
import { createPlaybackTracker, isPlaying, pauseAll } from "@/sites/youtube-page";

type Video = { paused: boolean; ended: boolean; readyState: number };

const video = (patch: Partial<Video> = {}): Video => ({
	paused: false,
	ended: false,
	readyState: 4,
	...patch,
});

const event = (type: string, target: Video) => ({ type, target }) as unknown as Event;

const page = (...videos: Video[]) => ({ querySelectorAll: () => videos }) as unknown as Document;

describe("isPlaying", () => {
	it("isn't playing while Chrome holds off a never-shown tab's autoplay", () => {
		expect(isPlaying(video({ readyState: 0 }), false)).toBe(false);
	});

	it("is playing once the playing event fired, even while it stalls", () => {
		expect(isPlaying(video({ readyState: 2 }), true)).toBe(true);
	});

	it("is playing when it started before anyone listened and has data", () => {
		expect(isPlaying(video({ readyState: 3 }), false)).toBe(true);
	});

	it.each([
		["paused", video({ paused: true })],
		["ended", video({ ended: true })],
	])("isn't playing when %s", (_, v) => {
		expect(isPlaying(v, true)).toBe(false);
	});
});

describe("createPlaybackTracker", () => {
	it("counts a video only after its playing event", () => {
		const v = video({ readyState: 0 });
		const tracker = createPlaybackTracker();
		tracker.onEvent(event("play", v));
		expect(tracker.isAnyPlaying(page(v))).toBe(false);
		tracker.onEvent(event("playing", v));
		v.readyState = 2;
		expect(tracker.isAnyPlaying(page(v))).toBe(true);
	});

	it.each(["pause", "ended", "emptied"])("forgets the start on %s", (type) => {
		const v = video({ readyState: 0 });
		const tracker = createPlaybackTracker();
		tracker.onEvent(event("playing", v));
		tracker.onEvent(event(type, v));
		expect(tracker.isAnyPlaying(page(v))).toBe(false);
	});

	it("looks at every video on the page", () => {
		const tracker = createPlaybackTracker();
		const doc = page(video({ paused: true }), video());
		expect(tracker.isAnyPlaying(doc)).toBe(true);
	});
});

describe("pauseAll", () => {
	it("pauses every video that's playing and leaves the rest alone", () => {
		const calls: string[] = [];
		const fake = (name: string, paused: boolean) => ({ paused, pause: () => calls.push(name) });
		const doc = { querySelectorAll: () => [fake("main", false), fake("preview", true), fake("mini", false)] };
		pauseAll(doc as unknown as Document);
		expect(calls).toEqual(["main", "mini"]);
	});
});
