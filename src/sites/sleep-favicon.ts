// YouTube's play logo, a bit smaller and up in the top left, with 💤 over its
// bottom right corner. It's one fixed image, so putting a tab to sleep only
// swaps a <link>. The browser keeps whatever favicon the page had when it went
// to sleep, and a reload brings YouTube's own back
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect x="0" y="3" width="26" height="18" rx="5" fill="#ff0033"/>
<path d="M10 7.5v9l7.5-4.5z" fill="#fff"/>
<text x="32" y="30" font-size="17" text-anchor="end" font-family="Segoe UI Emoji,Apple Color Emoji,Noto Color Emoji,sans-serif">💤</text>
</svg>`;

export const SLEEP_FAVICON = `data:image/svg+xml,${encodeURIComponent(SVG)}`;

/** Swaps in the sleeping favicon, returns a function that puts the page's own back */
export function showSleepFavicon(doc: Document): () => void {
	const originals = [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
	for (const link of originals) link.remove();
	const sleeping = doc.createElement("link");
	sleeping.rel = "icon";
	sleeping.type = "image/svg+xml";
	sleeping.href = SLEEP_FAVICON;
	doc.head.append(sleeping);
	return () => {
		sleeping.remove();
		doc.head.append(...originals);
	};
}
