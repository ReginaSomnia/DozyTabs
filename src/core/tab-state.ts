import { browser, type Browser } from "wxt/browser";

export type TabState = {
	unvisited: boolean;
	playing: boolean;
	draft: boolean;
	keepAwake: boolean;
};

export const EMPTY_TAB_STATE: Readonly<TabState> = Object.freeze({
	unvisited: false,
	playing: false,
	draft: false,
	keepAwake: false,
});

export type TabStateStore = {
	get(tabId: number): Promise<TabState>;
	update(tabId: number, patch: Partial<TabState>): Promise<TabState>;
	remove(tabId: number): Promise<void>;
	move(fromId: number, toId: number): Promise<void>;
};

type StorageArea = Pick<Browser.storage.StorageArea, "get" | "set" | "remove">;

const keyFor = (tabId: number) => `tab:${tabId}`;

export function createTabStateStore(area: StorageArea = browser.storage.session): TabStateStore {
	const cache = new Map<number, TabState>();

	async function get(tabId: number): Promise<TabState> {
		const cached = cache.get(tabId);
		if (cached) return cached;
		const key = keyFor(tabId);
		const stored = (await area.get(key))[key] as Partial<TabState> | undefined;
		// another call can fill the cache while this one waits on storage, and
		// that copy may already have newer writes in it
		const state = cache.get(tabId) ?? { ...EMPTY_TAB_STATE, ...stored };
		cache.set(tabId, state);
		return state;
	}

	async function update(tabId: number, patch: Partial<TabState>): Promise<TabState> {
		const current = await get(tabId);
		const next = { ...(cache.get(tabId) ?? current), ...patch };
		cache.set(tabId, next);
		await area.set({ [keyFor(tabId)]: next });
		return next;
	}

	async function remove(tabId: number): Promise<void> {
		cache.delete(tabId);
		await area.remove(keyFor(tabId));
	}

	async function move(fromId: number, toId: number): Promise<void> {
		const state = await get(fromId);
		await remove(fromId);
		await update(toId, state);
	}

	return { get, update, remove, move };
}
