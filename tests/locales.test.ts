import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Messages = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;

const LOCALES = new URL("../public/_locales/", import.meta.url);
const read = (locale: string): Messages =>
	JSON.parse(readFileSync(new URL(`${locale}/messages.json`, LOCALES), "utf8")) as Messages;
const english = read("en");
const translations = readdirSync(LOCALES).filter((locale) => locale !== "en");
const placeholdersIn = (message: string) => [...message.matchAll(/\$\w+\$/g)].map(([name]) => name).sort();

// Every key the code asks for: data-i18n in the pages, __MSG_x__ in the
// manifest, and the quoted keys in t(...), actions.text(...) and getMessage(...).
// Only what's before the first comma counts, so t("popupTotalMany", [n]) gives
// popupTotalMany, and text(awake ? "a" : "b") gives both a and b
function usedKeys(): Set<string> {
	const src = fileURLToPath(new URL("../src/", import.meta.url));
	const files = (readdirSync(src, { recursive: true }) as string[])
		.filter((file) => /\.(ts|html)$/.test(file))
		.map((file) => path.join(src, file));
	files.push(fileURLToPath(new URL("../wxt.config.ts", import.meta.url)));
	const keys = new Set<string>();
	for (const file of files) {
		const code = readFileSync(file, "utf8");
		for (const [, args] of code.matchAll(/(?:getMessage|\bt|\.text)\(([^(),]*)/g)) {
			for (const [, key] of args!.matchAll(/"(\w+)"/g)) keys.add(key!);
		}
		for (const [, key] of code.matchAll(/data-i18n="(\w+)"/g)) keys.add(key!);
		for (const [, key] of code.matchAll(/__MSG_(\w+)__/g)) keys.add(key!);
	}
	return keys;
}

describe("English texts", () => {
	const used = usedKeys();

	it("have every key the code uses", () => {
		expect([...used].filter((key) => !(key in english))).toEqual([]);
	});

	it("have no key the code doesn't use", () => {
		expect(Object.keys(english).filter((key) => !used.has(key))).toEqual([]);
	});
});

describe("translations", () => {
	it("include Spanish", () => {
		expect(translations).toContain("es");
	});

	it.each(translations)("%s has every English key and nothing else", (locale) => {
		expect(Object.keys(read(locale)).sort()).toEqual(Object.keys(english).sort());
	});

	it.each(translations)("%s keeps English's placeholders", (locale) => {
		const messages = read(locale);
		for (const [key, { message, placeholders }] of Object.entries(english)) {
			expect(messages[key]?.placeholders, key).toEqual(placeholders);
			expect(placeholdersIn(messages[key]?.message ?? ""), key).toEqual(placeholdersIn(message));
		}
	});
});
