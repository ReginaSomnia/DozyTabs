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

// This harness only exchanges JSON control messages, including console results.
const MAX_PACKET_BYTES = 16 * 1024 * 1024;
const MAX_LENGTH_DIGITS = String(MAX_PACKET_BYTES).length;

export class Rdp {
	private header = "";
	private frame?: Buffer;
	private received = 0;
	private pending = new Map<string, ((packet: Packet) => void)[]>();
	private listeners = new Set<(packet: Packet) => void>();
	private failures = new Set<(error: Error) => void>();
	private failure?: Error;
	private nextCall = 0;
	// the last packets, shown when something times out
	private recent: string[] = [];

	private constructor(private socket: net.Socket) {
		socket.on("data", (chunk: Buffer) => {
			try {
				this.read(chunk);
			} catch (error) {
				this.fail(error instanceof Error ? error : new Error(String(error)));
			}
		});
		socket.on("error", (error) => this.fail(error));
		socket.on("end", () => this.fail(new Error("Firefox RDP connection ended")));
		socket.on("close", () => this.fail(new Error("Firefox RDP connection closed")));
	}

	static async connect(port: number): Promise<Rdp> {
		// the debugger server comes up a moment after the browser window
		for (let attempt = 0; ; attempt++) {
			let rdp: Rdp | undefined;
			try {
				const socket = await new Promise<net.Socket>((resolve, reject) => {
					const s = net.connect(port, "127.0.0.1", () => {
						s.off("error", failed);
						resolve(s);
					});
					const failed = (error: Error) => {
						s.destroy();
						reject(error);
					};
					s.once("error", failed);
				});
				rdp = new Rdp(socket);
				await rdp.waitFor((p) => p.from === "root" && "applicationType" in p, 10_000, "greeting");
				if (rdp.failure) throw rdp.failure;
				return rdp;
			} catch (error) {
				rdp?.close();
				if (rdp || attempt >= 100) throw error;
				await wait(200);
			}
		}
	}

	private read(chunk: Buffer): void {
		let offset = 0;
		while (offset < chunk.length && !this.failure) {
			if (!this.frame) {
				const byte = chunk.readUInt8(offset++);
				if (byte !== 58) {
					if (byte < 48 || byte > 57 || this.header.length >= MAX_LENGTH_DIGITS) {
						throw new Error("Invalid Firefox RDP length prefix");
					}
					this.header += String.fromCharCode(byte);
					continue;
				}
				const length = Number(this.header);
				if (length === 0 || length > MAX_PACKET_BYTES) {
					throw new Error(`Firefox RDP packet length must be between 1 and ${MAX_PACKET_BYTES} bytes`);
				}
				this.header = "";
				// Allocate once, then copy each body byte once, regardless of chunk size.
				this.frame = Buffer.allocUnsafe(length);
			}
			const count = Math.min(this.frame.length - this.received, chunk.length - offset);
			chunk.copy(this.frame, this.received, offset, offset + count);
			offset += count;
			this.received += count;
			if (this.received < this.frame.length) return;
			const text = this.frame.toString();
			this.frame = undefined;
			this.received = 0;
			this.recent = [...this.recent.slice(-14), text.slice(0, 200)];
			const packet: Packet = JSON.parse(text);
			if (!packet || typeof packet !== "object" || Array.isArray(packet) || typeof packet.from !== "string") {
				throw new Error("Invalid Firefox RDP packet");
			}
			for (const listener of [...this.listeners]) listener(packet);
			if (packet.type !== undefined && packet.error === undefined) continue;
			this.pending.get(packet.from)?.shift()?.(packet);
		}
	}

	private fail(error: Error): void {
		if (this.failure) return;
		this.failure = error;
		this.header = "";
		this.frame = undefined;
		this.received = 0;
		this.socket.destroy();
		for (const failed of this.failures) failed(error);
		this.failures.clear();
		this.listeners.clear();
		this.pending.clear();
	}

	private timedOut(what: string): Error {
		return new Error(`Firefox didn't answer in time: ${what}\nlast packets:\n${this.recent.join("\n")}`);
	}

	private waitFor(match: (packet: Packet) => boolean, timeout: number, what: string): Promise<Packet> {
		if (this.failure) return Promise.reject(this.failure);
		return new Promise((resolve, reject) => {
			const failed = (error: Error) => {
				clearTimeout(timer);
				this.listeners.delete(listener);
				this.failures.delete(failed);
				reject(error);
			};
			const timer = setTimeout(() => this.fail(this.timedOut(what)), timeout);
			const listener = (packet: Packet) => {
				if (!match(packet)) return;
				clearTimeout(timer);
				this.listeners.delete(listener);
				this.failures.delete(failed);
				resolve(packet);
			};
			this.listeners.add(listener);
			this.failures.add(failed);
		});
	}

	private request(to: string, type: string, body: object = {}, timeout = 30_000): Promise<Packet> {
		if (this.failure) return Promise.reject(this.failure);
		return new Promise((resolve, reject) => {
			const queue = this.pending.get(to) ?? [];
			const failed = (error: Error) => {
				clearTimeout(timer);
				this.failures.delete(failed);
				reject(error);
			};
			const answer = (reply: Packet) => {
				clearTimeout(timer);
				this.failures.delete(failed);
				if (reply.error) reject(new Error(`${to} ${type}: ${reply.error} ${reply.message ?? ""}`));
				else resolve(reply);
			};
			// A timed-out reply could otherwise be delivered to the next request.
			const timer = setTimeout(() => this.fail(this.timedOut(`${to} ${type}`)), timeout);
			queue.push(answer);
			this.pending.set(to, queue);
			this.failures.add(failed);
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
		this.fail(new Error("Firefox RDP connection closed"));
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
