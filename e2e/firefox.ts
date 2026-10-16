import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FOCUS_HOME, OUTPUT, PROFILES, wait, type Browser } from "./browser";
import { Rdp } from "./rdp";

// Playwright's own Firefox build forces every page to report visible, even
// when Playwright isn't connected, so this runs Mozilla's release Firefox
// (node e2e/run.mjs install puts it in e2e/browsers) and talks to it over its
// remote debugging protocol. The add-on goes in as a temporary add-on, and the
// tests run their code in its popup page opened as a tab, same as on Chrome

const here = path.dirname(fileURLToPath(import.meta.url));
const FIREFOX = path.join(here, "browsers", "firefox", "core", "firefox.exe");
const ADDON = path.join(OUTPUT, "firefox-mv3");
const ADDON_ID = "dozy-tabs@reginaprojects";
const DEBUGGER_PORT = 6123;

const PREFS: Record<string, string | number | boolean> = {
	"devtools.debugger.remote-enabled": true,
	"devtools.debugger.prompt-connection": false,
	"devtools.chrome.enabled": true,
	// Firefox keeps the background alive while a real toolbox is attached, and
	// this connection doesn't count as one, so do the same here
	"extensions.background.idle.timeout": 3_600_000,
	"media.autoplay.default": 0,
	"media.autoplay.blocking_policy": 0,
	"app.update.disabledForTesting": true,
	"browser.shell.checkDefaultBrowser": false,
	"browser.aboutwelcome.enabled": false,
	"browser.startup.homepage_override.mstone": "ignore",
	"startup.homepage_welcome_url": "",
	"datareporting.policy.dataSubmissionEnabled": false,
	"datareporting.policy.dataSubmissionPolicyBypassNotification": true,
	// a new profile opens with a Terms of Use dialog that blocks switching tabs,
	// these two are what Mozilla's own test runner sets to skip it
	"browser.preonboarding.enabled": false,
	"termsofuse.bypassNotification": true,
	"toolkit.telemetry.reportingpolicy.firstRun": false,
	"browser.tabs.warnOnClose": false,
};

export async function launchFirefox(profile: string): Promise<Browser> {
	if (!existsSync(FIREFOX)) throw new Error("no Firefox in e2e/browsers, run: node e2e/run.mjs install");
	const dir = path.join(PROFILES, `firefox-${profile}`);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, "user.js"),
		Object.entries(PREFS)
			.map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`)
			.join("\n"),
	);

	// firefox.exe on Windows is a small launcher that starts the real browser
	// and exits, -wait-for-browser keeps it around until the browser is gone
	const child = spawn(
		FIREFOX,
		[
			"-profile",
			dir,
			"-no-remote",
			"-wait-for-browser",
			"-start-debugger-server",
			String(DEBUGGER_PORT),
			"about:blank",
		],
		{ stdio: "ignore" },
	);
	const exited = new Promise((resolve) => child.once("exit", resolve));
	let rdp: Rdp | undefined;
	const close = async () => {
		await rdp?.quitBrowser().catch(() => {});
		await Promise.race([exited, wait(10_000)]);
		rdp?.close();
		if (child.exitCode === null && child.pid !== undefined) {
			spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		}
	};

	try {
		rdp = await Rdp.connect(DEBUGGER_PORT);
		await rdp.installTemporaryAddon(ADDON);
		const pages = await rdp.watchAddon(ADDON_ID);
		const background = await pages.console("_generated_background_page");
		await rdp.run(background, `chrome.tabs.create({ url: chrome.runtime.getURL("popup.html"), active: false })`);
		const popup = await pages.console("/popup.html");
		const connection = rdp;
		const evaluate = (expression: string) => connection.run<any>(popup, expression);
		return {
			evaluate,
			ext: (fn, ...args) => evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`),
			focusHome: () => evaluate(FOCUS_HOME),
			close,
		};
	} catch (error) {
		await close();
		throw error;
	}
}
