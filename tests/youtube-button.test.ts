import { describe, expect, it } from "vitest";
import { isDarkTopBar } from "@/sites/youtube-button";

const withAttributes = (...names: string[]) => ({ hasAttribute: (name: string) => names.includes(name) });

const page = (...names: string[]) => ({ documentElement: withAttributes(...names) }) as unknown as Document;

const buttonIn = (masthead: ReturnType<typeof withAttributes> | null) =>
	({ closest: (selector: string) => (selector === "ytd-masthead" ? masthead : null) }) as unknown as Element;

describe("isDarkTopBar", () => {
	it("is dark on YouTube's dark theme", () => {
		expect(isDarkTopBar(buttonIn(withAttributes()), page("dark"))).toBe(true);
	});

	it("is dark when theater mode darkens only the top bar on the light theme", () => {
		expect(isDarkTopBar(buttonIn(withAttributes("dark", "theater")), page())).toBe(true);
	});

	it("is light on the light theme outside theater mode", () => {
		expect(isDarkTopBar(buttonIn(withAttributes()), page())).toBe(false);
	});

	it("follows the page before the button is in the top bar", () => {
		expect(isDarkTopBar(buttonIn(null), page())).toBe(false);
		expect(isDarkTopBar(buttonIn(null), page("dark"))).toBe(true);
	});
});
