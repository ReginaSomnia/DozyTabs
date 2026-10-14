// Draws the Dozy Tabs icon (a yellow crescent and two stars on an indigo
// rounded square) and writes it as PNGs. Run `pnpm icons` after changing the
// shapes or colors below
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZES = [16, 32, 48, 96, 128];
const OUT_DIR = new URL("../public/icon/", import.meta.url);
const BACKGROUND = [43, 45, 110];
const MOON = [255, 209, 102];
const SAMPLES = 4;
const CORNER = 0.22;

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;

function inRoundedSquare(x, y) {
	const dx = Math.max(Math.abs(x - 0.5) - (0.5 - CORNER), 0);
	const dy = Math.max(Math.abs(y - 0.5) - (0.5 - CORNER), 0);
	return dx ** 2 + dy ** 2 <= CORNER ** 2;
}

function colorAt(x, y) {
	if (!inRoundedSquare(x, y)) return null;
	const crescent = inCircle(x, y, 0.45, 0.55, 0.3) && !inCircle(x, y, 0.58, 0.43, 0.25);
	const star = inCircle(x, y, 0.74, 0.25, 0.05) || inCircle(x, y, 0.84, 0.44, 0.035);
	return crescent || star ? MOON : BACKGROUND;
}

// every pixel averages SAMPLES x SAMPLES points inside it, so the edges come
// out smooth instead of jagged
function render(size) {
	const pixels = Buffer.alloc(size * size * 4);
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			const sum = [0, 0, 0];
			let covered = 0;
			for (let sy = 0; sy < SAMPLES; sy++) {
				for (let sx = 0; sx < SAMPLES; sx++) {
					const color = colorAt((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size);
					if (!color) continue;
					for (let c = 0; c < 3; c++) sum[c] += color[c];
					covered++;
				}
			}
			const offset = (py * size + px) * 4;
			for (let c = 0; c < 3 && covered > 0; c++) {
				pixels[offset + c] = Math.round(sum[c] / covered);
			}
			pixels[offset + 3] = Math.round((covered / SAMPLES ** 2) * 255);
		}
	}
	return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // RGBA
	const stride = size * 4;
	const raw = Buffer.alloc((stride + 1) * size);
	for (let y = 0; y < size; y++) {
		// each row starts with filter type 0 (none), already zero from alloc
		pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
	writeFileSync(new URL(`${size}.png`, OUT_DIR), encodePng(size, render(size)));
}
console.log(`wrote ${SIZES.length} icons to public/icon/`);
