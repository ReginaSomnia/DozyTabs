import { EventEmitter } from "node:events";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Rdp } from "../e2e/rdp";

vi.mock("node:net", () => ({ default: { connect: vi.fn() } }));

let socket: EventEmitter & { localPort: number; end: ReturnType<typeof vi.fn> };

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(console, "log").mockImplementation(() => {});
	socket = Object.assign(new EventEmitter(), { localPort: 49152, end: vi.fn() });
	vi.mocked(net.connect).mockImplementation((...args: unknown[]) => {
		queueMicrotask(args[2] as () => void);
		return socket as unknown as net.Socket;
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

function greet() {
	const packet = Buffer.from(JSON.stringify({ from: "root", applicationType: "browser" }));
	socket.emit("data", Buffer.concat([Buffer.from(`${packet.length}:`), packet]));
}

describe("Firefox debugger connection approval", () => {
	it("waits for the approved greeting and prints the endpoints to verify", async () => {
		const ready = vi.fn();
		const connecting = Rdp.connect(6123).then((rdp) => {
			ready();
			return rdp;
		});

		await vi.advanceTimersByTimeAsync(10_001);
		expect(ready).not.toHaveBeenCalled();
		expect(net.connect).toHaveBeenCalledExactlyOnceWith(6123, "127.0.0.1", expect.any(Function));
		expect(console.log).toHaveBeenCalledWith(
			"Approve Firefox's debugger connection from 127.0.0.1:49152 to 127.0.0.1:6123 within 60 seconds.",
		);
		greet();
		const rdp = await connecting;
		expect(ready).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
		rdp.close();
	});

	it("closes a connection without approval after one minute without retrying", async () => {
		const failed = expect(Rdp.connect(6123)).rejects.toThrow("debugger connection approval");
		await vi.advanceTimersByTimeAsync(60_000);
		await failed;
		expect(socket.end).toHaveBeenCalledOnce();
		expect(net.connect).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("still retries while the browser's debugger server is starting", async () => {
		vi.mocked(net.connect).mockImplementationOnce(() => {
			queueMicrotask(() => socket.emit("error", new Error("ECONNREFUSED")));
			return socket as unknown as net.Socket;
		});
		const connecting = Rdp.connect(6123);
		await vi.advanceTimersByTimeAsync(200);
		expect(net.connect).toHaveBeenCalledTimes(2);
		greet();
		(await connecting).close();
	});
});
