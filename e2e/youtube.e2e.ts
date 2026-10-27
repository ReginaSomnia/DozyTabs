import { expect, test } from "@playwright/test";
import {
	activateTab,
	currentTime,
	inTab,
	launch,
	openTab,
	pause,
	play,
	seekAndPause,
	sleepAll,
	tabMatching,
	wait,
	waitForHidden,
	waitForPlayer,
	waitForSilence,
	waitForSleep,
	watch,
	type Browser,
} from "./fixtures";

// these run against YouTube, so they need a connection

// Big Buck Bunny, about 10 minutes
const VIDEO = "aqz-KE-bpKQ";
// streams end, so the live test picks one that's live right now
const LIVE_SEARCH = "https://www.youtube.com/results?search_query=live&sp=EgJAAQ%253D%253D";

declare const chrome: any;

let browser: Browser;

test.beforeEach(async ({}, testInfo) => {
	browser = await launch(testInfo.project.name, testInfo.title.replace(/\W+/g, "-"));
});

test.afterEach(async () => {
	await browser?.close();
});

test("a paused video sleeps with the 💤 favicon and comes back at the same spot", async () => {
	const tabId = await openTab(browser, watch(VIDEO));
	await waitForPlayer(browser, tabId, 90_000);
	await seekAndPause(browser, tabId, 60);
	await browser.focusHome();
	await waitForHidden(browser, tabId);
	await waitForSilence(browser, tabId);

	expect(await sleepAll(browser)).toBe(1);
	const slept = await waitForSleep(browser, VIDEO, 10_000);
	expect(slept.url).toContain("t=60s");
	expect(slept.favIconUrl).toMatch(/^data:image\/svg\+xml/);

	await activateTab(browser, slept.id);
	await waitForPlayer(browser, slept.id, 90_000);
	const time = await currentTime(browser, slept.id);
	expect(time).toBeGreaterThanOrEqual(59);
	expect(time).toBeLessThan(90);
});

test("a video opened in the background sleeps once it loads", async () => {
	await openTab(browser, watch(VIDEO), { active: false });
	const slept = await waitForSleep(browser, VIDEO, 45_000);
	expect(slept.favIconUrl).toMatch(/^data:image\/svg\+xml/);
});

test("a video playing in the background stays awake", async () => {
	const tabId = await openTab(browser, watch(VIDEO));
	await waitForPlayer(browser, tabId, 90_000);
	await play(browser, tabId);
	await browser.focusHome();
	await waitForHidden(browser, tabId);
	await wait(3_000);
	expect(await sleepAll(browser)).toBe(0);
	expect((await tabMatching(browser, VIDEO)).discarded).toBe(false);
	expect(await currentTime(browser, tabId)).toBeGreaterThan(1);
});

test("a paused live stream sleeps without a timestamp", async () => {
	const { tabId, id } = await openLiveStream();
	await pause(browser, tabId);
	await browser.focusHome();
	await waitForHidden(browser, tabId);
	await waitForSilence(browser, tabId);

	expect(await sleepAll(browser)).toBe(1);
	const slept = await waitForSleep(browser, id, 10_000);
	expect(slept.url).not.toContain("t=");
});

test("the top bar button shows this tab's state", async () => {
	const tabId = await openTab(browser, watch(VIDEO));
	await expect
		.poll(
			() =>
				inTab(
					browser,
					tabId,
					() => {
						const root = document.getElementById("dozy-tabs-button")?.shadowRoot;
						root?.querySelector<HTMLButtonElement>(".toggle")?.click();
						return root?.querySelector(".status")?.textContent ?? "";
					},
					[],
				).catch(() => ""),
			{ timeout: 30_000 },
		)
		.toBe("This tab will sleep when it's idle");
});

async function openLiveStream(): Promise<{ tabId: number; id: string }> {
	const search = await openTab(browser, LIVE_SEARCH);
	let ids: string[] = [];
	await expect
		.poll(
			async () => {
				ids =
					(await inTab(
						browser,
						search,
						() =>
							[...document.querySelectorAll<HTMLAnchorElement>("a#video-title")]
								.map((a) => new URL(a.href).searchParams.get("v"))
								.filter((v): v is string => v !== null)
								.slice(0, 5),
						[],
					).catch(() => null)) ?? [];
				return ids.length;
			},
			{ timeout: 30_000 },
		)
		.toBeGreaterThan(0);
	await browser.ext((t: number) => chrome.tabs.remove(t), search);

	for (const id of ids) {
		const tabId = await openTab(browser, watch(id));
		try {
			await expect
				.poll(
					() =>
						inTab(
							browser,
							tabId,
							() => (document.getElementById("movie_player") as any)?.getVideoData?.()?.isLive === true,
							[],
							"MAIN",
						).catch(() => false),
					{ timeout: 20_000 },
				)
				.toBe(true);
			// YouTube doesn't always autoplay here, so start it by hand
			await play(browser, tabId);
			await waitForPlayer(browser, tabId, 60_000);
			return { tabId, id };
		} catch {
			await browser.ext((t: number) => chrome.tabs.remove(t), tabId);
		}
	}
	throw new Error(`none of these live streams played: ${ids.join(", ")}`);
}
