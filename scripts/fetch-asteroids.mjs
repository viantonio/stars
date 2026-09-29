// Fetches osculating orbital elements for a handful of bright / notable
// asteroids from the JPL Small-Body Database API and writes
// public/data/asteroids.json. Run with `node scripts/fetch-asteroids.mjs`.
import fs from 'node:fs';
import path from 'node:path';

const TARGETS = ['1', '2', '3', '4', '6', '7', '433', '99942'];
const OUT = path.resolve('public/data/asteroids.json');
const API = 'https://ssd-api.jpl.nasa.gov/sbdb.api';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

async function fetchOne(sstr) {
  const url = `${API}?sstr=${encodeURIComponent(sstr)}&phys-par=1&full-prec=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${sstr}: HTTP ${res.status}`);
  const d = await res.json();
  if (!d.orbit) throw new Error(`${sstr}: no orbit in response (${d.message ?? 'unknown'})`);

  const el = Object.fromEntries(d.orbit.elements.map((e) => [e.name, Number(e.value)]));
  const phys = Object.fromEntries((d.phys_par ?? []).map((p) => [p.name, p.value]));
  const [number, ...rest] = d.object.shortname.split(' ');
  return {
    name: rest.join(' '),
    number: Number(number),
    epoch: Number(d.orbit.epoch),
    a: el.a,
    e: el.e,
    i: el.i,
    om: el.om,
    w: el.w,
    ma: el.ma,
    H: num(phys.H),
    // SBDB omits G for most objects; 0.15 is the IAU default slope.
    G: num(phys.G) ?? 0.15,
    diameter: num(phys.diameter),
  };
}

const bodies = [];
for (const t of TARGETS) {
  const b = await fetchOne(t);
  console.log(`${b.number} ${b.name}: a=${b.a.toFixed(4)} e=${b.e.toFixed(4)} H=${b.H}`);
  bodies.push(b);
}
fs.writeFileSync(OUT, JSON.stringify({ source: API, fetched: new Date().toISOString(), bodies }, null, 1) + '\n');
console.log(`wrote ${bodies.length} asteroids to ${path.relative(process.cwd(), OUT)}`);
