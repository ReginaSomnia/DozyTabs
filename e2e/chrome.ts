import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { chromium } from "@playwright/test";
import { BrowserClosed, FOCUS_HOME, OUTPUT, PROFILES, until, wait, type Browser } from "./browser";

// Playwright's own launch attaches to every page, and an attached page keeps
// reporting visible after its tab goes to the background, which is exactly
// what the extension depends on. So this starts Chromium itself and only
// attaches to the extension's popup page, then reaches the YouTube tabs
// through chrome.scripting like any other extension would.
//
// Chrome treats a --load-extension extension as freshly installed on every
// launch (onInstalled "install", never onStartup), so a browser restart can't
// be tested here

const EXTENSION = path.join(OUTPUT, "chrome-mv3");

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

/** CDP over --remote-debugging-pipe: fd 3 in, fd 4 out, messages end in \0 */
class Cdp {
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private buffer = "";
	private closed: BrowserClosed | null = null;

	constructor(
		private input: Writable,
		output: Readable,
	) {
		output.setEncoding("utf8");
		output.on("data", (chunk: string) => {
			this.buffer += chunk;
			let end: number;
			while ((end = this.buffer.indexOf("\0")) !== -1) {
				const message = JSON.parse(this.buffer.slice(0, end));
				this.buffer = this.buffer.slice(end + 1);
				if (message.id === undefined) continue;
				const p = this.pending.get(message.id);
				this.pending.delete(message.id);
				if (message.error) p?.reject(new Error(JSON.stringify(message.error)));
				else p?.resolve(message.result);
			}
		});
		output.on("close", () => {
			this.closed = new BrowserClosed("Chromium");
			for (const p of this.pending.values()) p.reject(this.closed);
			this.pending.clear();
		});
		// writing to the pipe of a Chromium that's gone errors, and an error
		// nobody listens for ends the whole test run
		input.on("error", () => {});
	}

	send(method: string, params: object = {}, sessionId?: string): Promise<any> {
		if (this.closed) return Promise.reject(this.closed);
		const id = this.nextId++;
		this.input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
	}
}

export async function launchChrome(profile: string): Promise<Browser> {
	const userDataDir = path.join(PROFILES, `chrome-${profile}`);
	rmSync(userDataDir, { recursive: true, force: true });
	mkdirSync(userDataDir, { recursive: true });

	const child = spawn(
		chromium.executablePath(),
		[
			`--user-data-dir=${userDataDir}`,
			"--remote-debugging-pipe",
			`--disable-extensions-except=${EXTENSION}`,
			`--load-extension=${EXTENSION}`,
			// the tests check the English texts, and Chromium otherwise follows
			// the system's language
			"--lang=en-US",
			// no window to take focus and no sound while the tests run
			"--headless",
			"--mute-audio",
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-search-engine-choice-screen",
			"--password-store=basic",
			"--disable-component-extensions-with-background-pages",
			"--autoplay-policy=no-user-gesture-required",
			"about:blank",
		],
		{ stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
	);
	const cdp = new Cdp(child.stdio[3] as Writable, child.stdio[4] as Readable);

	const extensionId = await until(
		async () => {
			const { targetInfos } = await cdp.send("Target.getTargets");
			const worker = targetInfos.find(
				(t: any) =>
					t.type === "service_worker" && /^chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(t.url),
			);
			return worker ? new URL(worker.url).host : undefined;
		},
		20_000,
		"the extension's service worker",
	);

	const { targetId } = await cdp.send("Target.createTarget", {
		url: `chrome-extension://${extensionId}/popup.html`,
		background: true,
	});
	const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
	const evaluate = async (expression: string) => {
		const result = await cdp.send(
			"Runtime.evaluate",
			{ expression, awaitPromise: true, returnByValue: true },
			sessionId,
		);
		if (result.exceptionDetails) {
			throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
		}
		return result.result.value;
	};
	await until(() => evaluate("typeof chrome?.tabs?.query === 'function'"), 10_000, "the popup page");

	return {
		evaluate,
		ext: (fn, ...args) => evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`),
		focusHome: () => evaluate(FOCUS_HOME),
		async close() {
			const exited = new Promise((resolve) => child.once("exit", resolve));
			await cdp.send("Browser.close").catch(() => {});
			await Promise.race([exited, wait(10_000)]);
			if (child.exitCode === null) child.kill();
		},
	};
}
