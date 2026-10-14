export const YOUTUBE_MATCH_PATTERNS = ["*://*.youtube.com/*"];

const MIN_TIMESTAMP_SECONDS = 5;

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

export function withTimestamp(url: string, seconds: number): string | null {
	const parsed = parse(url);
	if (!parsed || !isYouTubeUrl(url)) return null;
	const isWatchPage = parsed.pathname === "/watch" && parsed.searchParams.has("v");
	if (!isWatchPage) return null;
	if (!Number.isFinite(seconds) || seconds < MIN_TIMESTAMP_SECONDS) return null;
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
