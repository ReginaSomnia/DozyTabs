import { expect } from "@playwright/test";
import type { Browser } from "./browser";
import { launchChrome } from "./chrome";
import { launchFirefox } from "./firefox";

export { wait, type Browser } from "./browser";

// this code runs inside the browser, where chrome.* exists
declare const chrome: any;

export type TabInfo = {
	id: number;
	url: string;
	title: string;
	active: boolean;
	discarded: boolean;
	favIconUrl: string;
};

export const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** Launches the browser the Playwright project is named after, with YouTube's consent screen out of the way */
export async function launch(project: string, profile: string): Promise<Browser> {
	const browser = await (project === "firefox" ? launchFirefox(profile) : launchChrome(profile));
	try {
		await skipConsent(browser);
	} catch (error) {
		await browser.close();
		throw error;
	}
	return browser;
}

// The extension can't set cookies, but it can run code in any YouTube page,
// and a plain file there is enough for document.cookie
async function skipConsent(browser: Browser): Promise<void> {
	const tabId = await openTab(browser, "https://www.youtube.com/robots.txt", { active: false });
	await expect
		.poll(() =>
			inTab(
				browser,
				tabId,
				() => {
					document.cookie = "SOCS=CAI; domain=.youtube.com; path=/; secure; max-age=31536000";
					return document.cookie.includes("SOCS=CAI");
				},
				[],
			).catch((error) => String(error)),
		)
		.toBe(true);
	await browser.ext((id: number) => chrome.tabs.remove(id), tabId);
}

/** Runs fn inside a tab through chrome.scripting, MAIN world for the page's own objects */
export async function inTab<A extends unknown[], R>(
	browser: Browser,
	tabId: number,
	fn: (...args: A) => R,
	args: A,
	world: "ISOLATED" | "MAIN" = "ISOLATED",
): Promise<Awaited<R>> {
	return browser.evaluate(
		`chrome.scripting.executeScript({
			target: { tabId: ${tabId} },
			world: ${JSON.stringify(world)},
			func: ${fn.toString()},
			args: ${JSON.stringify(args)},
		}).then((r) => r[0]?.result)`,
	);
}

export async function openTab(browser: Browser, url: string, options: { active?: boolean } = {}): Promise<number> {
	return browser.ext(
		async (u: string, active: boolean) => (await chrome.tabs.create({ url: u, active })).id,
		url,
		options.active ?? true,
	);
}

export async function youtubeTabs(browser: Browser): Promise<TabInfo[]> {
	return browser.ext(async () => {
		const tabs = await chrome.tabs.query({ url: "*://*.youtube.com/*" });
		return tabs.map((tab: any) => ({
			id: tab.id,
			url: tab.url ?? "",
			title: tab.title ?? "",
			active: tab.active,
			discarded: tab.discarded,
			favIconUrl: tab.favIconUrl ?? "",
		}));
	});
}

export async function tabMatching(browser: Browser, part: string): Promise<TabInfo> {
	const tab = (await youtubeTabs(browser)).find((t) => t.url.includes(part));
	if (!tab) throw new Error(`no YouTube tab with ${part}`);
	return tab;
}

export async function waitForSleep(browser: Browser, part: string, timeout = 30_000): Promise<TabInfo> {
	await expect
		.poll(async () => (await youtubeTabs(browser)).find((t) => t.url.includes(part))?.discarded, { timeout })
		.toBe(true);
	return tabMatching(browser, part);
}

export async function sleepAll(browser: Browser): Promise<number> {
	return browser.ext(() => chrome.runtime.sendMessage({ type: "sleep-all" }));
}

export async function activateTab(browser: Browser, tabId: number): Promise<void> {
	await browser.ext((id: number) => chrome.tabs.update(id, { active: true }), tabId);
}

export async function waitForHidden(browser: Browser, tabId: number): Promise<void> {
	await expect.poll(() => inTab(browser, tabId, () => document.visibilityState, [])).toBe("hidden");
}

/** Firefox keeps a tab audible for a few seconds after the sound stops, and audible tabs stay awake */
export async function waitForSilence(browser: Browser, tabId: number): Promise<void> {
	await expect
		.poll(() => browser.ext((id: number) => chrome.tabs.get(id).then((tab: any) => tab.audible), tabId))
		.toBe(false);
}

/** Waits for the player, skipping past ads */
export async function waitForPlayer(browser: Browser, tabId: number, timeout = 60_000): Promise<void> {
	await expect
		.poll(
			() =>
				inTab(
					browser,
					tabId,
					() => {
						const player = document.querySelector("#movie_player");
						const video = document.querySelector<HTMLVideoElement>("#movie_player video");
						if (!video) return `no video at ${location.href}: ${document.title}`;
						if (player?.classList.contains("ad-showing")) return "ad showing";
						if (video.readyState < 1) return `readyState ${video.readyState}, paused ${video.paused}`;
						return "ready";
					},
					[],
				).catch((error) => String(error)),
			{ timeout },
		)
		.toBe("ready");
}

// YouTube fights direct element seeks (seeked never fires), so these go
// through its player API in the page's own world
type Command = "seek" | "pause" | "play";

async function command(browser: Browser, tabId: number, what: Command, seconds = 0): Promise<void> {
	await inTab(
		browser,
		tabId,
		(cmd: Command, s: number) => {
			const player = document.getElementById("movie_player") as any;
			if (typeof player?.playVideo !== "function") throw new Error("no player API yet");
			if (cmd === "seek") player.seekTo(s, true);
			if (cmd === "seek" || cmd === "pause") player.pauseVideo();
			if (cmd === "play") {
				player.mute();
				player.playVideo();
			}
		},
		[what, seconds],
		"MAIN",
	);
}

export async function currentTime(browser: Browser, tabId: number): Promise<number> {
	return inTab(
		browser,
		tabId,
		() => document.querySelector<HTMLVideoElement>("#movie_player video")?.currentTime ?? -1,
		[],
	);
}

export async function seekAndPause(browser: Browser, tabId: number, seconds: number): Promise<void> {
	await expect
		.poll(async () => {
			await command(browser, tabId, "seek", seconds).catch(() => {});
			await new Promise((resolve) => setTimeout(resolve, 300));
			const state = await inTab(
				browser,
				tabId,
				() => {
					const v = document.querySelector<HTMLVideoElement>("#movie_player video");
					return v ? { paused: v.paused, time: v.currentTime } : null;
				},
				[],
			).catch(() => null);
			return !!state && state.paused && Math.abs(state.time - seconds) < 2;
		})
		.toBe(true);
}

export async function pause(browser: Browser, tabId: number): Promise<void> {
	await expect
		.poll(async () => {
			await command(browser, tabId, "pause").catch(() => {});
			return inTab(
				browser,
				tabId,
				() => document.querySelector<HTMLVideoElement>("#movie_player video")?.paused === true,
				[],
			);
		})
		.toBe(true);
}

// YouTube sometimes reloads the page with themeRefresh=1 right after the
// player is ready, so this keeps asking until the video moves
export async function play(browser: Browser, tabId: number): Promise<void> {
	await expect
		.poll(
			async () => {
				await command(browser, tabId, "play").catch(() => {});
				return currentTime(browser, tabId).catch(() => 0);
			},
			{ timeout: 30_000 },
		)
		.toBeGreaterThan(0.5);
}
