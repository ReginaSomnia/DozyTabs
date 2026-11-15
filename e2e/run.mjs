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

function stop(message) {
	console.error(message);
	process.exit(1);
}

// The shell is only here because pnpm is a .cmd file on Windows. cmd still
// reads " and % inside quotes, so an argument with one of those is refused
function quote(arg) {
	if (process.platform !== "win32") return `'${arg.replaceAll("'", "'\\''")}'`;
	if (/["%]/.test(arg)) stop(`can't pass ${arg} through cmd, it has a " or a %`);
	// a \ right before the closing quote would make that quote part of the argument
	return `"${arg.replace(/\\+$/, "$&$&")}"`;
}

function run(command, args) {
	const line = [command, ...args.map(quote)].join(" ");
	const result = spawnSync(line, { stdio: "inherit", env, shell: true });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

async function download(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} answered ${response.status}`);
	return response;
}

// SHA256SUMS comes from the same server as the installer, so it only says the
// download arrived whole, not that it's Mozilla's
function checkSignature(exe) {
	const script = [
		"$s = Get-AuthenticodeSignature -LiteralPath $env:DOZY_INSTALLER",
		'"$($s.Status)|$($s.SignerCertificate.Subject)"',
	].join("; ");
	// Windows PowerShell can't load its own modules with the PSModulePath it
	// inherits from a PowerShell 7 terminal
	const clean = Object.fromEntries(Object.entries(env).filter(([name]) => name.toLowerCase() !== "psmodulepath"));
	const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
		env: { ...clean, DOZY_INSTALLER: exe },
		encoding: "utf8",
	});
	const [status, signer = ""] = (result.stdout ?? "").trim().split("|");
	if (status !== "Valid" || !/(^|, )O=Mozilla Corporation(,|$)/.test(signer)) {
		throw new Error(`the installer isn't signed by Mozilla (${status || "no signature"}, signer ${signer})`);
	}
}

// Mozilla only ships the Windows release as an installer, but the installer
// can unpack the browser into a folder without installing anything
async function installFirefox() {
	if (process.platform !== "win32") {
		throw new Error("the Firefox download is only set up for Windows, see the README");
	}
	const versions = await (await download("https://product-details.mozilla.org/1.0/firefox_versions.json")).json();
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
	const installer = Buffer.from(await (await download(`${release}/${encodeURI(file)}`)).arrayBuffer());
	const sums = await (await download(`${release}/SHA256SUMS`)).text();
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
	try {
		checkSignature(exe);
		rmSync(target, { recursive: true, force: true });
		const unpack = spawnSync(exe, [`/ExtractDir=${target}`], { stdio: "inherit", env });
		if (unpack.status !== 0) throw new Error(`the installer stopped with ${unpack.status ?? unpack.error}`);
	} finally {
		rmSync(exe);
	}
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
