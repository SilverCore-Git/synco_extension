#!/usr/bin/env node
// Vérifie que chaque dépendance (bun.lock) a au moins 7 jours et que package.json épingle des versions exactes.
// Interroge le registre npm : nécessite le réseau. Code de sortie 1 au moindre écart.
import { readFileSync } from 'node:fs';
import { checkAges, findUnpinned, MIN_AGE_DAYS, parseBunLock } from './lib/depsAge.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = readFileSync(new URL('../bun.lock', import.meta.url), 'utf8');

const unpinned = findUnpinned(pkg);
for (const u of unpinned) console.error(`non épinglé : ${u.name}@${u.range} (${u.section})`);

async function getTimes(name) {
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`registre npm : ${name} → HTTP ${res.status}`);
  return (await res.json()).time ?? {};
}

const packages = parseBunLock(lock);
const problems = await checkAges(packages, getTimes);
for (const p of problems) {
  console.error(`trop récent ou introuvable : ${p.name}@${p.version} (publié : ${p.published ?? 'inconnu'})`);
}

if (unpinned.length > 0 || problems.length > 0) process.exit(1);
console.log(`check-deps : OK (${packages.length} paquets, tous publiés depuis au moins ${MIN_AGE_DAYS} jours, versions épinglées)`);
