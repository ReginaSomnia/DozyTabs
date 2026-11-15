import { browser, type Browser } from "wxt/browser";

export type TabState = {
	unvisited: boolean;
	playing: boolean;
	draft: boolean;
	keepAwake: boolean;
	/** The page an active tab had when the browser started, so its first playback gets paused */
	pauseAutoplay: string | null;
};

export const EMPTY_TAB_STATE: Readonly<TabState> = Object.freeze({
	unvisited: false,
	playing: false,
	draft: false,
	keepAwake: false,
	pauseAutoplay: null,
});

export type TabStateStore = {
	get(tabId: number): Promise<TabState>;
	update(tabId: number, patch: Partial<TabState>): Promise<TabState>;
	remove(tabId: number): Promise<void>;
	move(fromId: number, toId: number): Promise<void>;
	clear(): Promise<void>;
};

type StorageArea = Pick<Browser.storage.StorageArea, "get" | "set" | "remove">;

const KEY_PREFIX = "tab:";
const keyFor = (tabId: number) => `${KEY_PREFIX}${tabId}`;

// Not session storage: an extension update empties that one, and a tab kept
// awake has to stay awake after it. So it's local storage, cleared on startup
export function createTabStateStore(area: StorageArea = browser.storage.local): TabStateStore {
	const cache = new Map<number, TabState>();
	let clearing: Promise<void> | null = null;

	async function get(tabId: number): Promise<TabState> {
		// storage still has last session's states until a clear is done, so a
		// read waits for it. One that started earlier is covered too, the
		// clear empties the cache last
		while (clearing) await clearing;
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

	async function removeAll(): Promise<void> {
		const keys = Object.keys(await area.get()).filter((key) => key.startsWith(KEY_PREFIX));
		await area.remove(keys);
		cache.clear();
	}

	async function clear(): Promise<void> {
		clearing = removeAll();
		try {
			await clearing;
		} finally {
			clearing = null;
		}
	}

	return { get, update, remove, move, clear };
}
