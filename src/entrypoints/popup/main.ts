import { browser } from "wxt/browser";
import type { PopupRequest, Summary } from "@/core/messages";
import { loadSettings, saveSettings } from "@/core/settings";
import { applyI18n, t } from "@/ui/i18n";
import "@/ui/base.css";
import "./style.css";

function byId<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) throw new Error(`missing #${id}`);
	return element as T;
}

const total = byId("total");
const breakdown = byId("breakdown");
const sleepAll = byId<HTMLButtonElement>("sleep-all");
const keepAwakeRow = byId("keep-awake-row");
const keepAwake = byId<HTMLInputElement>("keep-awake");
const enabled = byId<HTMLInputElement>("enabled");
const openOptions = byId<HTMLButtonElement>("open-options");

async function request<T>(message: PopupRequest): Promise<T> {
	return (await browser.runtime.sendMessage(message)) as T;
}

async function currentTabId(): Promise<number | undefined> {
	const [tab] = await browser.tabs.query({
		active: true,
		currentWindow: true,
	});
	return tab?.id;
}

function totalText(count: number): string {
	if (count === 0) return t("popupNoTabs");
	if (count === 1) return t("popupTotalOne");
	return t("popupTotalMany", [String(count)]);
}

async function render(): Promise<void> {
	const [settings, tabId] = await Promise.all([loadSettings(), currentTabId()]);
	const summary = await request<Summary>({ type: "get-summary", tabId });

	total.textContent = totalText(summary.total);
	breakdown.hidden = summary.total === 0;
	breakdown.textContent = t("popupBreakdown", [
		String(summary.asleep),
		String(summary.idle),
		String(summary.playing),
	]);

	enabled.checked = settings.enabled;
	sleepAll.disabled = !settings.enabled || summary.idle === 0;
	keepAwakeRow.hidden = summary.currentTab === null;
	keepAwake.checked = summary.currentTab?.keepAwake ?? false;
	keepAwake.disabled = !settings.enabled;
}

sleepAll.addEventListener("click", async () => {
	sleepAll.disabled = true;
	await request<number>({ type: "sleep-all" });
	await render();
});

keepAwake.addEventListener("change", async () => {
	const tabId = await currentTabId();
	if (tabId === undefined) return;
	await request<null>({
		type: "set-keep-awake",
		tabId,
		keepAwake: keepAwake.checked,
	});
});

enabled.addEventListener("change", async () => {
	await saveSettings({ enabled: enabled.checked });
	await render();
});

openOptions.addEventListener("click", () => {
	void browser.runtime.openOptionsPage();
	window.close();
});

applyI18n(document);
void render();
