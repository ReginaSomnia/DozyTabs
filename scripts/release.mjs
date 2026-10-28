// Builds the store zips for the version in package.json and sends them to
// Chrome, Edge and Firefox with wxt submit. The keys, and whether each store
// only gets the upload or also the review request, are in .env.submit
// (made by `pnpm exec wxt submit init`)
//   pnpm release            -> build and upload
//   pnpm release --dry-run  -> build, then stop before uploading anything
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

const quote = (arg) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg);

function run(command, commandArgs) {
	const line = [command, ...commandArgs].map(quote).join(" ");
	const result = spawnSync(line, { stdio: "inherit", cwd: root, shell: true });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function stop(message) {
	console.error(message);
	process.exit(1);
}

if (!existsSync(path.join(root, ".env.submit"))) {
	stop("no .env.submit, run `pnpm exec wxt submit init` first");
}
// Mozilla's reviewers rebuild the add-on from the sources zip, so it has to
// match a commit
const changes = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
if (changes.status !== 0) stop("couldn't ask git for uncommitted changes");
if (!dryRun && changes.stdout.trim() !== "") stop("commit or stash the changes first:\n" + changes.stdout);

const { name, version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const zip = (browser) => `.output/${name}-${version}-${browser}.zip`;

run("pnpm", ["zip"]);
run("pnpm", ["zip:firefox"]);
run("pnpm", [
	"exec",
	"wxt",
	"submit",
	"--chrome-zip",
	zip("chrome"),
	"--edge-zip",
	zip("chrome"),
	"--firefox-zip",
	zip("firefox"),
	"--firefox-sources-zip",
	zip("sources"),
	...args,
]);
