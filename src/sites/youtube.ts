export const YOUTUBE_MATCH_PATTERNS = ["*://*.youtube.com/*"];

const MIN_TIMESTAMP_SECONDS = 5;
const END_MARGIN_SECONDS = 10;

function parse(url: string | undefined): URL | null {
	if (!url) return null;
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

export function isYouTubeUrl(url: string | undefined): boolean {
	const parsed = parse(url);
	if (!parsed || !["https:", "http:"].includes(parsed.protocol)) return false;
	const host = parsed.hostname;
	return host === "youtube.com" || host.endsWith(".youtube.com");
}

export function isMusicUrl(url: string | undefined): boolean {
	return parse(url)?.hostname === "music.youtube.com";
}

// The URL to put in place before the tab sleeps, or null to leave it as is.
// Near the start or at the end there's no spot worth keeping, so an old t from
// an earlier sleep goes away and the video starts over like YouTube does
export function withTimestamp(url: string, seconds: number, duration = Number.NaN): string | null {
	const parsed = parse(url);
	if (!parsed || !isYouTubeUrl(url)) return null;
	const isWatchPage = parsed.pathname === "/watch" && parsed.searchParams.has("v");
	if (!isWatchPage || !Number.isFinite(seconds)) return null;
	const finished = Number.isFinite(duration) && seconds >= duration - END_MARGIN_SECONDS;
	if (seconds < MIN_TIMESTAMP_SECONDS || finished) {
		if (!parsed.searchParams.has("t")) return null;
		parsed.searchParams.delete("t");
		return parsed.toString();
	}
	parsed.searchParams.set("t", `${Math.floor(seconds)}s`);
	return parsed.toString();
}

// While a tab loads, the browser shows the bare URL or plain "YouTube" as the
// title. The video's real name only shows up once the page script runs
export function hasRealTitle(title: string | undefined, url: string | undefined): boolean {
	const trimmed = title?.trim();
	if (!trimmed || trimmed === "YouTube") return false;
	return !url?.includes(trimmed);
}
