import path from "node:path";
import { fileURLToPath } from "node:url";

/** What the tests need from either browser */
export type Browser = {
	/** Runs fn in the extension's popup page (opened as a tab), where chrome.* is available */
	ext<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): Promise<Awaited<R>>;
	/** Same as ext, for an expression that's already text */
	evaluate(expression: string): Promise<any>;
	/** Switches to the popup page's tab, so the YouTube tabs go hidden */
	focusHome(): Promise<void>;
	close(): Promise<void>;
};

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROFILES = path.join(here, "profiles");
export const OUTPUT = path.resolve(here, "../.output");

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until<T>(
	check: () => Promise<T | undefined> | T | undefined,
	timeout: number,
	what: string,
): Promise<T> {
	const end = Date.now() + timeout;
	let last: unknown;
	for (;;) {
		try {
			last = await check();
			if (last !== undefined && last !== null && last !== false) return last as T;
		} catch (error) {
			last = error;
		}
		if (Date.now() > end) throw new Error(`timed out waiting for ${what} (last: ${String(last)})`);
		await wait(200);
	}
}

/** Goes back to the popup page's tab and window */
export const FOCUS_HOME = `(async () => {
	const tab = await chrome.tabs.getCurrent();
	await chrome.tabs.update(tab.id, { active: true });
	await chrome.windows.update(tab.windowId, { focused: true });
})()`;
