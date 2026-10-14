import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import {
	isPrepareSleepMessage,
	type ContentMessage,
	type PrepareSleepMessage,
	type PrepareSleepResult,
} from "@/core/messages";
import { withTimestamp } from "@/sites/youtube";
import {
	createPlaybackTracker,
	findMainVideo,
	hasCommentDraft,
	isLiveStream,
	type PlaybackTracker,
} from "@/sites/youtube-page";

const ACTIVITY_THROTTLE_MS = 10_000;
const PLAYBACK_EVENTS = ["play", "playing", "pause", "ended", "emptied"] as const;
const INPUT_EVENTS = ["pointerdown", "keydown", "wheel"] as const;

function stampPosition(): void {
	const video = findMainVideo(document);
	if (!video || isLiveStream(document)) return;
	const next = withTimestamp(location.href, video.currentTime);
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

		const reportVisibility = () => {
			if (document.visibilityState === "visible") {
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
			if (!isPrepareSleepMessage(message)) return false;
			sendResponse(prepareSleep(message, playback));
			return false;
		};
		browser.runtime.onMessage.addListener(onMessage);
		ctx.onInvalidated(() => {
			browser.runtime.onMessage.removeListener(onMessage);
		});

		// a tab opened in the background starts hidden and never fires
		// visibilitychange, so tell the background right away
		if (document.visibilityState === "hidden") reportVisibility();
	},
});
