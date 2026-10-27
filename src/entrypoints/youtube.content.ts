import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import {
	isMarkAsleepMessage,
	isPauseAutoplayMessage,
	isPrepareSleepMessage,
	type ContentMessage,
	type PageRequest,
	type PageState,
	type PrepareSleepMessage,
	type PrepareSleepResult,
} from "@/core/messages";
import { showSleepFavicon } from "@/sites/sleep-favicon";
import { withTimestamp } from "@/sites/youtube";
import { mountTopBarButton } from "@/sites/youtube-button";
import {
	createPlaybackTracker,
	findMainVideo,
	hasCommentDraft,
	isLiveStream,
	pauseAll,
	type PlaybackTracker,
} from "@/sites/youtube-page";
import { t } from "@/ui/i18n";

const ACTIVITY_THROTTLE_MS = 10_000;
// the discard comes right after the page says it's ready, so a page that's
// still here this much later didn't go to sleep and gets its favicon back
const FAVICON_RESTORE_MS = 5_000;
const TOP_BAR_HOST = "www.youtube.com";
const PLAYBACK_EVENTS = ["play", "playing", "pause", "ended", "emptied"] as const;
const INPUT_EVENTS = ["pointerdown", "keydown", "wheel"] as const;

function stampPosition(): void {
	const video = findMainVideo(document);
	if (!video || isLiveStream(document)) return;
	const next = withTimestamp(location.href, video.currentTime, video.duration);
	if (next && next !== location.href) {
		history.replaceState(history.state, "", next);
	}
}

function prepareSleep(message: PrepareSleepMessage, playback: PlaybackTracker): PrepareSleepResult {
	if (document.visibilityState === "visible") {
		return { ok: false, reason: "visible" };
	}
	if (playback.isAnyPlaying(document)) {
		return { ok: false, reason: "playing" };
	}
	if (message.keepDrafts && hasCommentDraft(document)) {
		return { ok: false, reason: "draft" };
	}
	if (message.rememberPosition) stampPosition();
	return { ok: true };
}

export default defineContentScript({
	matches: ["*://*.youtube.com/*"],
	runAt: "document_idle",
	main(ctx) {
		const playback = createPlaybackTracker();
		let playing = playback.isAnyPlaying(document);
		let draft = hasCommentDraft(document);
		let lastActivity = 0;

		const send = (message: ContentMessage) => {
			if (ctx.isInvalid) return;
			browser.runtime.sendMessage(message).catch(() => {
				// the background is restarting or the extension was reloaded,
				// and the next event sends fresh state anyway
			});
		};

		const reportPlayback = (event: Event) => {
			playback.onEvent(event);
			const now = playback.isAnyPlaying(document);
			if (now === playing) return;
			playing = now;
			send({ type: "playback", playing });
		};

		const reportActivity = () => {
			if (document.visibilityState !== "visible") return;
			const now = Date.now();
			if (now - lastActivity < ACTIVITY_THROTTLE_MS) return;
			lastActivity = now;
			send({ type: "activity" });
		};

		const reportDraft = () => {
			const now = hasCommentDraft(document);
			if (now === draft) return;
			draft = now;
			send({ type: "draft", draft });
		};

		let restoreFavicon: (() => void) | null = null;

		const showAsleep = () => {
			if (restoreFavicon) return;
			restoreFavicon = showSleepFavicon(document);
			ctx.setTimeout(showAwake, FAVICON_RESTORE_MS);
		};

		const showAwake = () => {
			restoreFavicon?.();
			restoreFavicon = null;
		};

		const reportVisibility = () => {
			if (document.visibilityState === "visible") {
				showAwake();
				send({ type: "visible" });
				return;
			}
			playing = playback.isAnyPlaying(document);
			draft = hasCommentDraft(document);
			send({ type: "hidden", playing, draft });
		};

		for (const type of PLAYBACK_EVENTS) {
			ctx.addEventListener(document, type, reportPlayback, {
				capture: true,
			});
		}
		for (const type of INPUT_EVENTS) {
			ctx.addEventListener(document, type, reportActivity, {
				capture: true,
				passive: true,
			});
		}
		ctx.addEventListener(document, "input", reportDraft, { capture: true });
		ctx.addEventListener(document, "visibilitychange", reportVisibility);

		const onMessage = (message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
			if (isPrepareSleepMessage(message)) {
				const result = prepareSleep(message, playback);
				if (result.ok) showAsleep();
				sendResponse(result);
			} else if (isMarkAsleepMessage(message)) {
				showAsleep();
				sendResponse(true);
			} else if (isPauseAutoplayMessage(message)) {
				// a video someone started by hand keeps playing
				if (!navigator.userActivation.hasBeenActive) pauseAll(document);
			}
			return false;
		};
		browser.runtime.onMessage.addListener(onMessage);
		ctx.onInvalidated(() => {
			browser.runtime.onMessage.removeListener(onMessage);
			showAwake();
		});

		if (location.hostname === TOP_BAR_HOST) {
			const ask = async <T>(request: PageRequest): Promise<T | null> => {
				if (ctx.isInvalid) return null;
				try {
					return ((await browser.runtime.sendMessage(request)) as T | undefined) ?? null;
				} catch {
					return null;
				}
			};
			const unmount = mountTopBarButton(document, {
				getState: () => ask<PageState>({ type: "page-state" }),
				setKeepAwake: async (keepAwake) => {
					await ask({ type: "page-set-keep-awake", keepAwake });
				},
				sleepAll: () => ask<number>({ type: "page-sleep-all" }),
				openOptions: async () => {
					await ask({ type: "page-open-options" });
				},
				text: t,
			});
			ctx.onInvalidated(unmount);
		}

		// a tab opened in the background starts hidden and never fires
		// visibilitychange, so tell the background right away. A video that
		// started before this script ran doesn't fire a change either
		if (document.visibilityState === "hidden") reportVisibility();
		else if (playing) send({ type: "playback", playing });
	},
});
