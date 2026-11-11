#!/usr/bin/env node
// Génère assets/icons/icon-{16,32,48,128}.png à partir du logo Synco (assets/brand/icon.svg : « S » blanc sur carré
// arrondi vert). Sans dépendance : le SVG est lu (rectangles arrondis et chemins M/L/H/V/C/Z absolus, ce que contient
// le logo), les courbes sont aplaties en polygones, puis chaque pixel est sur-échantillonné (règle non nulle).
// Le résultat est versionné ; ce script ne sert qu'à le refaire quand le logo change.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const SS = 8; // sur-échantillonnage 8×8 : le « S » reste net même à 16 px

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

const hex = (s) => {
  const m = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) throw new Error(`couleur non prise en charge : ${s}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
};
const COLORS = { white: [255, 255, 255], black: [0, 0, 0] };
const color = (s) => COLORS[s.trim().toLowerCase()] ?? hex(s);
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** Chemin SVG (commandes absolues M L H V C Z) → liste de polygones fermés. */
function pathToPolygons(d) {
  const tokens = d.match(/[MLHVCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const polys = [];
  let cur = [], x = 0, y = 0, cmd = '', i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++];
    if (cmd !== cmd.toUpperCase()) throw new Error(`commande relative non prise en charge : ${cmd}`);
    if (cmd === 'M') { if (cur.length) polys.push(cur); x = num(); y = num(); cur = [[x, y]]; cmd = 'L'; }
    else if (cmd === 'L') { x = num(); y = num(); cur.push([x, y]); }
    else if (cmd === 'H') { x = num(); cur.push([x, y]); }
    else if (cmd === 'V') { y = num(); cur.push([x, y]); }
    else if (cmd === 'C') {
      const [x1, y1, x2, y2, x3, y3] = [num(), num(), num(), num(), num(), num()];
      for (let s = 1; s <= 16; s++) {
        const t = s / 16, u = 1 - t;
        cur.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
      }
      x = x3; y = y3;
    } else if (cmd === 'Z') { if (cur.length) polys.push(cur); cur = []; }
    else throw new Error(`commande non prise en charge : ${cmd}`);
  }
  if (cur.length) polys.push(cur);
  return polys;
}

/** Rectangle arrondi → un polygone (quarts de cercle aplatis). */
function rectToPolygon(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const corners = [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]];
  for (const [cx, cy, a0] of corners) {
    for (let s = 0; s <= 8; s++) {
      const a = ((a0 + (s / 8) * 90) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return [pts];
}

/** Règle non nulle : le point est-il dans l'ensemble de polygones ? */
function inside(polys, px, py) {
  let wind = 0;
  for (const poly of polys) {
    for (let k = 0; k < poly.length; k++) {
      const [ax, ay] = poly[k], [bx, by] = poly[(k + 1) % poly.length];
      if (ay <= py) { if (by > py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) > 0) wind++; }
      else if (by <= py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) < 0) wind--;
    }
  }
  return wind !== 0;
}

function loadSvg(file) {
  const svg = readFileSync(file, 'utf8');
  const viewBox = (attr(svg.match(/<svg[^>]*>/)[0], 'viewBox') ?? '').split(/\s+/).map(Number);
  const shapes = [];
  for (const tag of svg.match(/<(rect|path)\b[^>]*>/g) ?? []) {
    const fill = attr(tag, 'fill');
    if (!fill || fill === 'none') continue;
    const polys = tag.startsWith('<rect')
      ? rectToPolygon(Number(attr(tag, 'x') ?? 0), Number(attr(tag, 'y') ?? 0), Number(attr(tag, 'width')), Number(attr(tag, 'height')), Number(attr(tag, 'rx') ?? 0))
      : pathToPolygons(attr(tag, 'd'));
    shapes.push({ polys, rgb: color(fill) });
  }
  return { size: viewBox[2], shapes };
}

function png(logo, size) {
  const scale = logo.size / size;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filtre « aucun »
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale, y = (py + (sy + 0.5) / SS) * scale;
          let hit = null; // la dernière forme dessinée l'emporte
          for (const s of logo.shapes) if (inside(s.polys, x, y)) hit = s.rgb;
          if (hit) { r += hit[0]; g += hit[1]; b += hit[2]; a++; }
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
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

const logo = loadSvg(fileURLToPath(new URL('../assets/brand/icon.svg', import.meta.url)));
const outDir = fileURLToPath(new URL('../assets/icons/', import.meta.url));
mkdirSync(outDir, { recursive: true });
for (const size of SIZES) writeFileSync(`${outDir}icon-${size}.png`, png(logo, size));
console.log(`icônes générées depuis le logo Synco : ${SIZES.map((s) => `icon-${s}.png`).join(', ')}`);
