import { browser } from "wxt/browser";

type GetMessage = (key: string, substitutions?: string[]) => string;

// WXT types getMessage per key, but the data-i18n attributes are plain
// strings, so this helper goes through an untyped view of the same function
const getMessage = browser.i18n.getMessage as unknown as GetMessage;

export function t(key: string, substitutions?: string[]): string {
	return getMessage(key, substitutions);
}

export function applyI18n(root: ParentNode): void {
	for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
		element.textContent = t(element.dataset.i18n ?? "");
	}
}
