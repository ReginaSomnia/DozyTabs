const DRAFT_SELECTOR = ["ytd-commentbox [contenteditable]", "ytd-comment-simplebox-renderer [contenteditable]"].join(
	", ",
);

export function findMainVideo(doc: Document): HTMLVideoElement | null {
	return doc.querySelector<HTMLVideoElement>("#movie_player video");
}

const HAVE_FUTURE_DATA = 3;

type MediaState = Pick<HTMLMediaElement, "paused" | "ended" | "readyState">;

// Chrome holds off playback in a tab that was never shown, so YouTube's
// autoplay leaves the video with paused false and nothing loaded. It only
// counts once the playing event fired (a stall after that still counts), or,
// for a video that started before the content script was listening, once it
// has data to play
export function isPlaying(video: MediaState, started: boolean): boolean {
	if (video.paused || video.ended) return false;
	return started || video.readyState >= HAVE_FUTURE_DATA;
}

export function createPlaybackTracker() {
	const started = new WeakSet<EventTarget>();
	return {
		onEvent(event: Event): void {
			const target = event.target;
			if (!target || event.type === "play") return;
			if (event.type === "playing") started.add(target);
			else started.delete(target);
		},
		// any video, not just the main player, so Shorts and the miniplayer
		// count too
		isAnyPlaying(doc: Document): boolean {
			for (const video of doc.querySelectorAll("video")) {
				if (isPlaying(video, started.has(video))) return true;
			}
			return false;
		},
	};
}

export type PlaybackTracker = ReturnType<typeof createPlaybackTracker>;

export function isLiveStream(doc: Document): boolean {
	const player = doc.querySelector("#movie_player");
	if (!player) return false;
	if (player.classList.contains("ytp-live")) return true;
	const badge = player.querySelector<HTMLElement>(".ytp-live-badge");
	return badge !== null && getComputedStyle(badge).display !== "none";
}

export function hasCommentDraft(doc: Document): boolean {
	for (const box of doc.querySelectorAll(DRAFT_SELECTOR)) {
		if (box.textContent?.trim()) return true;
	}
	return false;
}
