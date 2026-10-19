// Écriture d'archives ZIP sans dépendance, déterministe : fichiers triés, date fixe (1980-01-01), permissions fixes.
import { deflateRawSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Nom d'entrée sûr : relatif, avec « / », sans « .. », sans « \ », sans chemin absolu ni lettre de lecteur. */
export function assertSafeName(name) {
  if (
    typeof name !== 'string' || name === '' || name.startsWith('/') || name.includes('\\') || name.includes('\0') ||
    /^[A-Za-z]:/.test(name) || name.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`nom d'entrée ZIP interdit : ${JSON.stringify(name)}`);
  }
  return name;
}

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const UTF8_FLAG = 0x0800;
const MADE_BY_UNIX = (3 << 8) | 20;
const FILE_MODE = (0o100644 << 16) >>> 0;

/** @param {{ name: string, data: Uint8Array }[]} files */
export function createZip(files) {
  const entries = files
    .map((f) => ({ name: assertSafeName(f.name), data: Buffer.from(f.data) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (new Set(entries.map((e) => e.name)).size !== entries.length) throw new Error('noms d\'entrée ZIP en double');
  if (entries.length > 0xffff) throw new Error('trop de fichiers');

  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const compressed = deflateRawSync(e.data, { level: 9 });
    const useDeflate = compressed.length < e.data.length;
    const body = useDeflate ? compressed : e.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(e.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(MADE_BY_UNIX, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(UTF8_FLAG, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(DOS_TIME, 12);
    c.writeUInt16LE(DOS_DATE, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(FILE_MODE, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}
