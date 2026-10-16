// Builds the extension for one browser and runs the end-to-end tests on it.
// Everything they write stays in e2e/ (browsers, profiles, temp files, results)
//   node e2e/run.mjs install                        -> download Chromium and Firefox
//   node e2e/run.mjs chrome|firefox [playwright args] -> build for that browser and test it
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(here, "tmp");
const browsers = path.join(here, "browsers");
mkdirSync(tmp, { recursive: true });

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers, TEMP: tmp, TMP: tmp };

const quote = (arg) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg);

function run(command, args) {
	const line = [command, ...args].map(quote).join(" ");
	const result = spawnSync(line, { stdio: "inherit", env, shell: true });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

// Mozilla only ships the Windows release as an installer, but the installer
// can unpack the browser into a folder without installing anything
async function installFirefox() {
	if (process.platform !== "win32") {
		throw new Error("the Firefox download is only set up for Windows, see the README");
	}
	const versions = await (await fetch("https://product-details.mozilla.org/1.0/firefox_versions.json")).json();
	const version = versions.LATEST_FIREFOX_VERSION;
	const target = path.join(browsers, "firefox");
	const stamp = path.join(target, "VERSION");
	if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) {
		console.log(`Firefox ${version} is already there`);
		return;
	}

	const release = `https://archive.mozilla.org/pub/firefox/releases/${version}`;
	const file = `win64/en-US/Firefox Setup ${version}.exe`;
	console.log(`downloading Firefox ${version}`);
	const installer = Buffer.from(await (await fetch(`${release}/${encodeURI(file)}`)).arrayBuffer());
	const sums = await (await fetch(`${release}/SHA256SUMS`)).text();
	const expected = sums
		.split("\n")
		.find((line) => line.endsWith(`  ${file}`))
		?.split(" ")[0];
	const actual = createHash("sha256").update(installer).digest("hex");
	if (!expected || expected !== actual) {
		throw new Error(`the download doesn't match Mozilla's SHA256SUMS (expected ${expected}, got ${actual})`);
	}

	const exe = path.join(tmp, "firefox-setup.exe");
	writeFileSync(exe, installer);
	rmSync(target, { recursive: true, force: true });
	run(exe, [`/ExtractDir=${target}`]);
	rmSync(exe);
	writeFileSync(stamp, version);
	console.log(`Firefox ${version} unpacked into ${target}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "install") {
	run("pnpm", ["exec", "playwright", "install", "chromium", "--no-shell"]);
	await installFirefox();
} else if (command === "chrome" || command === "firefox") {
	run("pnpm", [command === "chrome" ? "build" : "build:firefox"]);
	run("pnpm", ["exec", "playwright", "test", "-c", "e2e/playwright.config.ts", "--project", command, ...rest]);
} else {
	console.log("usage: node e2e/run.mjs install | chrome | firefox [playwright test args]");
	process.exit(1);
}
