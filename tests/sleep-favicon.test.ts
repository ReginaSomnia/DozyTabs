import { describe, expect, it } from "vitest";
import { SLEEP_FAVICON } from "@/sites/sleep-favicon";

const svg = decodeURIComponent(SLEEP_FAVICON.replace("data:image/svg+xml,", ""));

describe("SLEEP_FAVICON", () => {
	it("is YouTube's logo with 💤 over its bottom right corner", () => {
		expect(SLEEP_FAVICON.startsWith("data:image/svg+xml,")).toBe(true);
		expect(svg).toContain('fill="#ff0033"');
		expect(svg).toMatch(/<text [^>]*text-anchor="end"[^>]*>💤<\/text>/);
	});

	it("doesn't load anything from outside itself", () => {
		expect(svg).not.toContain("<image");
		expect(svg).not.toContain("href");
	});
});
