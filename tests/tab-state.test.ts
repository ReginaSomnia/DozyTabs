import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { EMPTY_TAB_STATE, createTabStateStore } from "@/core/tab-state";

beforeEach(() => {
	fakeBrowser.reset();
});

describe("createTabStateStore", () => {
	it("returns an empty state for a tab it hasn't seen", async () => {
		expect(await createTabStateStore().get(1)).toEqual(EMPTY_TAB_STATE);
	});

	it("merges updates", async () => {
		const store = createTabStateStore();
		await store.update(1, { playing: true });
		await store.update(1, { keepAwake: true });
		expect(await store.get(1)).toEqual({
			...EMPTY_TAB_STATE,
			playing: true,
			keepAwake: true,
		});
	});

	it("survives the background being restarted", async () => {
		await createTabStateStore().update(1, { keepAwake: true });
		expect((await createTabStateStore().get(1)).keepAwake).toBe(true);
	});

	it("survives an extension update, which empties session storage", async () => {
		await createTabStateStore().update(1, { keepAwake: true });
		await fakeBrowser.storage.session.clear();
		expect((await createTabStateStore().get(1)).keepAwake).toBe(true);
	});

	it("clears every tab and leaves other stored things alone", async () => {
		await fakeBrowser.storage.local.set({ other: 1 });
		const store = createTabStateStore();
		await store.update(1, { keepAwake: true });
		await store.update(2, { draft: true });
		await store.clear();
		expect(await store.get(1)).toEqual(EMPTY_TAB_STATE);
		expect(await createTabStateStore().get(2)).toEqual(EMPTY_TAB_STATE);
		expect(await fakeBrowser.storage.local.get("other")).toEqual({ other: 1 });
	});

	it("doesn't bring back a state that was being read while it cleared", async () => {
		await createTabStateStore().update(1, { keepAwake: true });
		const store = createTabStateStore();
		const reading = store.get(1);
		await store.clear();
		await reading;
		expect(await store.get(1)).toEqual(EMPTY_TAB_STATE);
	});

	it("doesn't hand an old state to a read that starts while it clears", async () => {
		await createTabStateStore().update(1, { keepAwake: true });
		const store = createTabStateStore();
		const clearing = store.clear();
		const state = await store.get(1);
		await clearing;
		expect(state).toEqual(EMPTY_TAB_STATE);
		expect(await store.get(1)).toEqual(EMPTY_TAB_STATE);
	});

	it("doesn't keep an old state that got an update while it cleared", async () => {
		await createTabStateStore().update(1, { keepAwake: true });
		const store = createTabStateStore();
		const clearing = store.clear();
		await store.update(1, { unvisited: true });
		await clearing;
		expect(await createTabStateStore().get(1)).toEqual({ ...EMPTY_TAB_STATE, unvisited: true });
	});

	it("keeps both of two updates fired at the same time", async () => {
		const store = createTabStateStore();
		await Promise.all([store.update(1, { playing: true }), store.update(1, { draft: true })]);
		expect(await store.get(1)).toMatchObject({
			playing: true,
			draft: true,
		});
		expect(await createTabStateStore().get(1)).toMatchObject({
			playing: true,
			draft: true,
		});
	});

	it("removes a tab", async () => {
		const store = createTabStateStore();
		await store.update(1, { keepAwake: true });
		await store.remove(1);
		expect(await store.get(1)).toEqual(EMPTY_TAB_STATE);
		expect(await createTabStateStore().get(1)).toEqual(EMPTY_TAB_STATE);
	});

	it("moves a tab's state to a new id", async () => {
		const store = createTabStateStore();
		await store.update(1, { keepAwake: true });
		await store.move(1, 2);
		expect((await store.get(2)).keepAwake).toBe(true);
		expect(await store.get(1)).toEqual(EMPTY_TAB_STATE);
	});
});
