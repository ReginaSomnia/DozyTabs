// Just enough of Firefox's remote debugging protocol to install a temporary
// add-on (like about:debugging does) and run code in its pages (like the
// Browser Toolbox console does). Packets are "<length>:<json>". Replies come
// back from the actor that was asked and have no "type", events do have one,
// which is how the two get told apart.
//
// It's Firefox's own devtools protocol, so a new Firefox can rename things.
// The actor code is in browser/omni.ja (a zip) under
// chrome/devtools/modules/devtools/server/actors/
import net from "node:net";

type Packet = { from: string; type?: string; error?: string; message?: string; [key: string]: unknown };
type TargetForm = { actor: string; url?: string; consoleActor: string };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Rdp {
	private buffer = Buffer.alloc(0);
	private pending = new Map<string, ((packet: Packet) => void)[]>();
	private listeners = new Set<(packet: Packet) => void>();
	private nextCall = 0;
	// the last packets, shown when something times out
	private recent: string[] = [];

	private constructor(private socket: net.Socket) {
		socket.on("data", (chunk: Buffer) => this.read(chunk));
	}

	static async connect(port: number): Promise<Rdp> {
		// the debugger server comes up a moment after the browser window
		for (let attempt = 0; ; attempt++) {
			let socket: net.Socket;
			try {
				socket = await new Promise<net.Socket>((resolve, reject) => {
					const s = net.connect(port, "127.0.0.1", () => resolve(s));
					s.once("error", reject);
				});
			} catch (error) {
				if (attempt >= 100) throw error;
				await wait(200);
				continue;
			}
			const rdp = new Rdp(socket);
			console.log(
				`Approve Firefox's debugger connection from 127.0.0.1:${socket.localPort} to 127.0.0.1:${port} within 60 seconds.`,
			);
			try {
				await rdp.waitFor(
					(p) => p.from === "root" && "applicationType" in p,
					60_000,
					"debugger connection approval",
				);
				return rdp;
			} catch (error) {
				// Do not retry approval failures or leave pending connections behind.
				rdp.close();
				throw error;
			}
		}
	}

	private read(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		for (;;) {
			const colon = this.buffer.indexOf(":");
			if (colon === -1) return;
			const length = Number(this.buffer.subarray(0, colon).toString());
			if (this.buffer.length < colon + 1 + length) return;
			const text = this.buffer.subarray(colon + 1, colon + 1 + length).toString();
			this.recent = [...this.recent.slice(-14), text.slice(0, 200)];
			const packet = JSON.parse(text) as Packet;
			this.buffer = this.buffer.subarray(colon + 1 + length);
			for (const listener of [...this.listeners]) listener(packet);
			if (packet.type !== undefined && packet.error === undefined) continue;
			this.pending.get(packet.from)?.shift()?.(packet);
		}
	}

	private timedOut(what: string): Error {
		return new Error(`Firefox didn't answer in time: ${what}\nlast packets:\n${this.recent.join("\n")}`);
	}

	private waitFor(match: (packet: Packet) => boolean, timeout: number, what: string): Promise<Packet> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.listeners.delete(listener);
				reject(this.timedOut(what));
			}, timeout);
			const listener = (packet: Packet) => {
				if (!match(packet)) return;
				clearTimeout(timer);
				this.listeners.delete(listener);
				resolve(packet);
			};
			this.listeners.add(listener);
		});
	}

	private request(to: string, type: string, body: object = {}, timeout = 30_000): Promise<Packet> {
		return new Promise((resolve, reject) => {
			const queue = this.pending.get(to) ?? [];
			const answer = (reply: Packet) => {
				clearTimeout(timer);
				if (reply.error) reject(new Error(`${to} ${type}: ${reply.error} ${reply.message ?? ""}`));
				else resolve(reply);
			};
			// an actor that never answers shouldn't keep a spot in its queue, or
			// its next reply would go to the wrong request
			const timer = setTimeout(() => {
				queue.splice(queue.indexOf(answer), 1);
				reject(this.timedOut(`${to} ${type}`));
			}, timeout);
			queue.push(answer);
			this.pending.set(to, queue);
			const data = Buffer.from(JSON.stringify({ to, type, ...body }));
			this.socket.write(`${data.length}:`);
			this.socket.write(data);
		});
	}

	async installTemporaryAddon(addonPath: string): Promise<string> {
		const root = await this.request("root", "getRoot");
		const reply = await this.request(root.addonsActor as string, "installTemporaryAddon", { addonPath });
		return (reply.addon as { id: string }).id;
	}

	/** Starts listening for the add-on's pages, each one comes with its own console */
	async watchAddon(addonId: string): Promise<AddonPages> {
		const { addons } = await this.request("root", "listAddons");
		const addon = (addons as { id: string; actor: string }[]).find((a) => a.id === addonId);
		if (!addon) throw new Error(`no add-on ${addonId}`);
		const watcher = (await this.request(addon.actor, "getWatcher", {})).actor as string;
		const pages = new AddonPages(this);
		this.listeners.add((p) => {
			if (p.from !== watcher) return;
			if (p.type === "target-available-form") pages.add(p.target as TargetForm);
			if (p.type === "target-destroyed-form") pages.remove(p.target as TargetForm);
		});
		await this.request(watcher, "watchTargets", { targetType: "frame" });
		return pages;
	}

	/** Evaluates text in a console and gives back the plain result */
	async evaluate(consoleActor: string, text: string, timeout = 15_000): Promise<unknown> {
		// the result often comes in the same chunk as the request's answer, so
		// it has to be caught before that answer resolves
		const isResult = (p: Packet) => p.from === consoleActor && p.type === "evaluationResult";
		const early: Packet[] = [];
		const collect = (p: Packet) => isResult(p) && early.push(p);
		this.listeners.add(collect);
		let result: Packet;
		try {
			const { resultID } = await this.request(consoleActor, "evaluateJSAsync", { text }, timeout);
			result =
				early.find((p) => p.resultID === resultID) ??
				(await this.waitFor((p) => isResult(p) && p.resultID === resultID, timeout, text.slice(0, 120)));
		} finally {
			this.listeners.delete(collect);
		}
		if (result.hasException) throw new Error(`the page threw: ${JSON.stringify(result.exceptionMessage)}`);
		// anything that isn't plain JSON comes back as a description of the value
		const grip = result.result as { type?: string; actor?: string; length?: number } | null;
		if (grip?.type === "undefined") return undefined;
		if (grip?.type === "longString") {
			const { substring } = await this.request(grip.actor!, "substring", { start: 0, end: grip.length });
			return substring;
		}
		return result.result;
	}

	/**
	 * Runs an expression that may return a promise, and gives back its JSON
	 * result. It starts the call, then asks for the result until it's there,
	 * so it doesn't depend on the console handling await
	 */
	async run<T>(consoleActor: string, expression: string): Promise<T> {
		const key = `c${this.nextCall++}`;
		await this.evaluate(
			consoleActor,
			`(() => {
				const box = (globalThis.__e2e ??= {});
				box.${key} = null;
				Promise.resolve()
					.then(() => ${expression})
					.then((v) => { box.${key} = { v: JSON.stringify(v ?? null) }; }, (e) => { box.${key} = { e: String(e) }; });
			})()`,
		);
		for (;;) {
			const raw = (await this.evaluate(consoleActor, `JSON.stringify(globalThis.__e2e.${key})`)) as string;
			const box = JSON.parse(raw) as { v?: string; e?: string } | null;
			if (box?.e !== undefined) throw new Error(`${box.e} in: ${expression.slice(0, 160)}`);
			if (box?.v !== undefined) return JSON.parse(box.v) as T;
			await wait(50);
		}
	}

	/** The console of Firefox's main process, the one the Browser Toolbox uses */
	async mainProcess(): Promise<string> {
		const { processDescriptor } = await this.request("root", "getProcess", { id: 0 });
		const reply = await this.request((processDescriptor as { actor: string }).actor, "getTarget");
		return ((reply.process ?? reply) as TargetForm).consoleActor;
	}

	/** Asks Firefox to quit from its main process */
	async quitBrowser(): Promise<void> {
		const main = await this.mainProcess();
		// the connection goes away with the browser, so there's no answer to wait for
		this.evaluate(main, "Services.startup.quit(Ci.nsIAppStartup.eForceQuit)").catch(() => {});
	}

	close(): void {
		this.socket.end();
	}
}

export class AddonPages {
	private forms: TargetForm[] = [];

	constructor(private rdp: Rdp) {}

	add(form: TargetForm): void {
		this.forms.push(form);
	}

	remove(form: TargetForm): void {
		this.forms = this.forms.filter((f) => f.actor !== form.actor);
	}

	/** The console of the add-on page whose URL contains part, once the page has the extension APIs */
	async console(part: string, timeout = 30_000): Promise<string> {
		const end = Date.now() + timeout;
		const ready = "typeof chrome === 'object' && typeof chrome.tabs?.query === 'function'";
		for (;;) {
			const form = this.forms.findLast((f) => f.url?.includes(part));
			if (form && (await this.rdp.evaluate(form.consoleActor, ready, 3_000).catch(() => false)) === true) {
				return form.consoleActor;
			}
			if (Date.now() > end) {
				const seen = this.forms.map((f) => f.url).join(", ");
				throw new Error(`no add-on page with ${part} answered, saw: ${seen}`);
			}
			await wait(200);
		}
	}
}
