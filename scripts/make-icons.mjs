#!/usr/bin/env node
// Génère assets/icons/icon-{16,32,48,128}.png : un cadenas blanc sur carré arrondi #16ac77.
// Sans dépendance (rasterisation par distance + zlib). Remplaçable par un visuel de l'équipe : même noms de fichiers.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const GREEN = [0x16, 0xac, 0x77];
const WHITE = [255, 255, 255];
const SS = 4; // sur-échantillonnage 4×4 pour des bords lisses

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** Distance signée à un rectangle arrondi (négatif = dedans). Coordonnées en [0,1]. */
const sdRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(x - cx) - hx, dy = Math.abs(y - cy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};

/** Couleur [r,g,b,a] d'un point [0,1]². */
function shade(x, y) {
  if (sdRoundRect(x, y, 0, 0, 1, 1, 0.22) > 0) return [0, 0, 0, 0];
  // Anse : anneau dont on ne garde que la moitié haute, plus deux montants.
  const ringD = Math.abs(Math.hypot(x - 0.5, y - 0.44) - 0.15) - 0.045;
  const shackle = (y <= 0.44 && ringD <= 0) || (y > 0.44 && y < 0.5 && (Math.abs(x - 0.35) <= 0.045 || Math.abs(x - 0.65) <= 0.045));
  const body = sdRoundRect(x, y, 0.27, 0.47, 0.73, 0.78, 0.05) <= 0;
  const keyhole = Math.hypot(x - 0.5, y - 0.6) <= 0.05 || (Math.abs(x - 0.5) <= 0.022 && y > 0.6 && y < 0.7);
  if (body && !keyhole) return [...WHITE, 255];
  if (shackle) return [...WHITE, 255];
  return [...GREEN, 255];
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filtre « aucun »
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [cr, cg, cb, ca] = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca; // pondéré par l'opacité
        }
      }
      const n = SS * SS, o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round(a / n);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = fileURLToPath(new URL('../assets/icons/', import.meta.url));
mkdirSync(outDir, { recursive: true });
for (const size of SIZES) writeFileSync(`${outDir}icon-${size}.png`, png(size));
console.log(`icônes générées : ${SIZES.map((s) => `icon-${s}.png`).join(', ')}`);
