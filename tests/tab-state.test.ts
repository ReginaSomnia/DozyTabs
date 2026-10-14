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
