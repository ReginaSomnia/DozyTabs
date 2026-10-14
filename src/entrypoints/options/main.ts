import { loadSettings, onSettingsChanged, saveSettings, type Settings } from "@/core/settings";
import { applyI18n, t } from "@/ui/i18n";
import "@/ui/base.css";
import "./style.css";

const STATUS_CLEAR_MS = 1500;

const form = document.getElementById("form") as HTMLFormElement;
const status = document.getElementById("status") as HTMLParagraphElement;
let statusTimer: ReturnType<typeof setTimeout> | undefined;

function field(name: keyof Settings): HTMLInputElement {
	return form.elements.namedItem(name) as HTMLInputElement;
}

function fill(settings: Settings): void {
	for (const [name, value] of Object.entries(settings)) {
		const input = field(name as keyof Settings);
		if (typeof value === "boolean") input.checked = value;
		else input.value = String(value);
	}
}

function showSaved(): void {
	status.textContent = t("optionsSaved");
	clearTimeout(statusTimer);
	statusTimer = setTimeout(() => {
		status.textContent = "";
	}, STATUS_CLEAR_MS);
}

form.addEventListener("change", async (event) => {
	const input = event.target as HTMLInputElement;
	const name = input.name as keyof Settings;
	if (input.type === "number" && input.value.trim() === "") {
		fill(await loadSettings());
		return;
	}
	const value = input.type === "checkbox" ? input.checked : Number(input.value);
	// saveSettings clamps idleMinutes, and fill() shows the clamped number
	fill(await saveSettings({ [name]: value }));
	showSaved();
});

form.addEventListener("submit", (event) => {
	event.preventDefault();
});

onSettingsChanged(fill);
applyI18n(document);
void loadSettings().then(fill);
