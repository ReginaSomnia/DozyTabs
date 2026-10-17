import net from "node:net";
import { setImmediate } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Rdp } from "../e2e/rdp";

const MAX_PACKET_BYTES = 16 * 1024 * 1024;
const sockets: net.Socket[] = [];
const connections: Rdp[] = [];

function frame(packet: unknown): Buffer {
	const body = Buffer.from(JSON.stringify(packet));
	return Buffer.concat([Buffer.from(`${body.length}:`), body]);
}

async function connecting() {
	const socket = new net.Socket();
	sockets.push(socket);
	vi.spyOn(socket, "write").mockReturnValue(true);
	vi.spyOn(net, "connect").mockImplementation((...args: unknown[]) => {
		queueMicrotask(args.at(-1) as () => void);
		return socket;
	});
	const connection = Rdp.connect(6123);
	// Let connect install the reader and greeting waiter before sending bytes.
	await setImmediate();
	return { socket, connection };
}

async function connected() {
	const { socket, connection } = await connecting();
	socket.emit("data", frame({ from: "root", applicationType: "browser" }));
	const rdp = await connection;
	connections.push(rdp);
	return { socket, rdp };
}

afterEach(() => {
	for (const rdp of connections.splice(0)) rdp.close();
	for (const socket of sockets.splice(0)) socket.destroy();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("Firefox RDP framing", () => {
	it("reads split headers, UTF-8 bodies, events, and multiple replies in one chunk", async () => {
		const { socket, rdp } = await connected();
		const result = rdp.evaluate("console", "1");
		const reply = frame({ from: "console", resultID: "one" });
		for (const byte of reply) socket.emit("data", Buffer.from([byte]));
		const value = frame({ from: "console", type: "evaluationResult", resultID: "one", result: "héllo 🌙" });
		const split = value.indexOf(Buffer.from("🌙")) + 1;
		socket.emit(
			"data",
			Buffer.concat([frame({ from: "console", type: "consoleAPICall" }), value.subarray(0, split)]),
		);
		socket.emit("data", Buffer.concat([value.subarray(split), frame({ from: "console", type: "consoleAPICall" })]));
		await expect(result).resolves.toBe("héllo 🌙");
	});

	it("copies a fragmented frame in linear space and time", async () => {
		const { socket, rdp } = await connected();
		const result = rdp.evaluate("console", "1");
		const text = "x".repeat(128 * 1024);
		const reply = frame({ from: "console", resultID: "one" });
		const body = Buffer.from(
			JSON.stringify({ from: "console", type: "evaluationResult", resultID: "one", result: text }),
		);
		const header = Buffer.from(`${body.length}:`);
		socket.emit("data", reply);
		const concat = vi.spyOn(Buffer, "concat");
		const copy = vi.spyOn(Buffer.prototype, "copy");
		const allocate = vi.spyOn(Buffer, "allocUnsafe");
		socket.emit("data", header);
		for (let offset = 0; offset < body.length; offset += 31) {
			socket.emit("data", body.subarray(offset, offset + 31));
		}
		const concatenated = concat.mock.calls.reduce(
			(total, [buffers, length]) => total + (length ?? buffers.reduce((sum, b) => sum + b.length, 0)),
			0,
		);
		const copied = copy.mock.results.reduce((total, result) => total + (result.value as number), 0);
		const allocated = allocate.mock.calls.reduce((total, [size]) => total + size, 0);
		expect(copied + concatenated).toBeLessThanOrEqual(body.length * 2);
		expect(allocated).toBeLessThanOrEqual(body.length * 2);
		await expect(result).resolves.toBe(text);
	});

	it("accepts a frame at the size limit", async () => {
		const { socket, rdp } = await connected();
		const result = rdp.mainProcess();
		const json = JSON.stringify({ from: "root", processDescriptor: { actor: "process" } });
		socket.emit("data", Buffer.from(`${MAX_PACKET_BYTES}:`));
		socket.emit("data", Buffer.from(json));
		socket.emit("data", Buffer.alloc(MAX_PACKET_BYTES - Buffer.byteLength(json), " "));
		await setImmediate();
		socket.emit("data", frame({ from: "process", consoleActor: "console" }));
		await expect(result).resolves.toBe("console");
	});

	it("rejects a bad frame following the greeting in the same chunk", async () => {
		const { socket, connection } = await connecting();
		const rejected = expect(connection).rejects.toThrow(/RDP.*length/);
		socket.emit(
			"data",
			Buffer.concat([
				frame({ from: "root", applicationType: "browser" }),
				Buffer.from(`${MAX_PACKET_BYTES + 1}:`),
			]),
		);
		await rejected;
		expect(socket.destroyed).toBe(true);
	});

	it.each([
		":",
		"0:",
		"-1:",
		"+1:",
		"1.5:",
		"1e3:",
		"NaN:",
		"Infinity:",
		" 2:",
		`${MAX_PACKET_BYTES + 1}:`,
		"999999999",
		"000000000",
	])("rejects invalid or oversized prefixes without a body: %s", async (prefix) => {
		const { socket, connection } = await connecting();
		const rejected = expect(connection).rejects.toThrow(/RDP.*(length|prefix)/);
		const allocate = vi.spyOn(Buffer, "allocUnsafe");
		for (const byte of Buffer.from(prefix)) socket.emit("data", Buffer.from([byte]));
		await rejected;
		expect(socket.destroyed).toBe(true);
		expect(allocate).not.toHaveBeenCalled();
		expect(net.connect).toHaveBeenCalledTimes(1);
	});

	it.each(["{", "null", "[]", "1", "{}", '{"from":1}'])("closes on invalid JSON packets: %s", async (body) => {
		const { socket, rdp } = await connected();
		const rejected = expect(rdp.mainProcess()).rejects.toThrow();
		expect(() => socket.emit("data", Buffer.from(`${Buffer.byteLength(body)}:${body}`))).not.toThrow();
		await rejected;
		expect(socket.destroyed).toBe(true);
	});

	it.each(["end", "close", "error"])("rejects pending calls when the socket emits %s", async (event) => {
		const { socket, rdp } = await connected();
		const rejected = expect(rdp.mainProcess()).rejects.toThrow(/ended|closed|broken/);
		socket.emit(event, new Error("broken"));
		await rejected;
		await expect(rdp.mainProcess()).rejects.toThrow(/ended|closed|broken/);
		expect(socket.destroyed).toBe(true);
	});

	it("destroys an incomplete greeting on timeout without reconnecting", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { socket, connection } = await connecting();
		const rejected = expect(connection).rejects.toThrow(/greeting/);
		socket.emit("data", Buffer.from(`${MAX_PACKET_BYTES}:partial`));
		await vi.advanceTimersByTimeAsync(10_000);
		await rejected;
		expect(socket.destroyed).toBe(true);
		expect(net.connect).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("closes and rejects all waiters on a request timeout", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { socket, rdp } = await connected();
		const evaluation = expect(rdp.evaluate("console", "1", 100)).rejects.toThrow(/console evaluateJSAsync/);
		const request = expect(rdp.mainProcess()).rejects.toThrow(/console evaluateJSAsync/);
		await vi.advanceTimersByTimeAsync(100);
		await Promise.all([evaluation, request]);
		expect(socket.destroyed).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
});
