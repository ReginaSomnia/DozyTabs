import { defineConfig } from "@playwright/test";

// run through e2e/run.mjs, which builds the extension for the browser first
export default defineConfig({
	testDir: ".",
	testMatch: "*.e2e.ts",
	outputDir: "./results",
	timeout: 240_000,
	// YouTube sometimes never finishes loading a page, a retry that
	// passes still shows up as flaky in the list
	retries: 1,
	workers: 1,
	reporter: [["list"]],
	projects: [{ name: "chrome" }, { name: "firefox" }],
});
