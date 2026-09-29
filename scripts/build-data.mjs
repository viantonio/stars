// Builds the compact runtime catalogs in public/data from the raw sources in
// .cache-data (see scripts/fetch-sources.sh). Run with `npm run data`.
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('.cache-data');
const OUT = path.resolve('public/data');
fs.mkdirSync(OUT, { recursive: true });

const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const normRa = (ra) => r4(((ra % 360) + 360) % 360);

const GREEK = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ',
  Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ',
  Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω',
};
const SUPERSCRIPT = { 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

function bayerToGreek(b) {
  if (!b) return '';
  const m = /^([A-Z][a-z]+)(?:-?(\d))?$/.exec(b);
  if (!m || !GREEK[m[1]]) return b;
  return GREEK[m[1]] + (m[2] ? SUPERSCRIPT[m[2]] : '');
}

// ---------------------------------------------------------------- CSV parse
function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// ------------------------------------------------------------------- stars
function buildStars() {
  const lines = fs.readFileSync(path.join(SRC, 'hygdata_v41.csv'), 'utf8').split('\n');
  const head = parseCSVLine(lines[0]);
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const stars = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = parseCSVLine(lines[i]);
    if (r[col.proper] === 'Sol') continue;
    const mag = parseFloat(r[col.mag]);
    if (!(mag <= 8.0)) continue;
    const ra = parseFloat(r[col.rarad]);
    const dec = parseFloat(r[col.decrad]);
    let ci = parseFloat(r[col.ci]);
    if (!Number.isFinite(ci)) ci = 0.6;
    stars.push({
      ra, dec, mag, ci,
      proper: r[col.proper],
      bayer: bayerToGreek(r[col.bayer]),
      flam: r[col.flam],
      con: r[col.con],
      hip: r[col.hip],
      hd: r[col.hd],
      dist: parseFloat(r[col.dist]),
      spect: r[col.spect],
      absmag: parseFloat(r[col.absmag]),
      lum: parseFloat(r[col.lum]),
      varName: r[col.var],
      pmra: parseFloat(r[col.pmra]),
      pmdec: parseFloat(r[col.pmdec]),
    });
  }
  stars.sort((a, b) => a.mag - b.mag);

  // Binary: x, y, z (unit vector, J2000 equatorial), mag, B-V colour index.
  const buf = new Float32Array(stars.length * 5);
  stars.forEach((s, i) => {
    const cd = Math.cos(s.dec);
    buf[i * 5 + 0] = cd * Math.cos(s.ra);
    buf[i * 5 + 1] = cd * Math.sin(s.ra);
    buf[i * 5 + 2] = Math.sin(s.dec);
    buf[i * 5 + 3] = s.mag;
    buf[i * 5 + 4] = s.ci;
  });
  fs.writeFileSync(path.join(OUT, 'stars.bin'), Buffer.from(buf.buffer));

  // Metadata for naked-eye stars and every named star. Distances in HYG are
  // parsecs; 100000 marks "unknown".
  const meta = [];
  stars.forEach((s, i) => {
    if (s.mag > 6.5 && !s.proper) return;
    const dist = s.dist > 0 && s.dist < 99999 ? Math.round(s.dist * 3.26156 * 10) / 10 : null;
    meta.push([
      i,
      s.proper || '',
      s.bayer || '',
      s.flam || '',
      s.con || '',
      s.hip ? +s.hip : 0,
      s.hd ? +s.hd : 0,
      dist,
      s.spect || '',
      Number.isFinite(s.absmag) ? Math.round(s.absmag * 100) / 100 : null,
      Number.isFinite(s.lum) ? Math.round(s.lum * 100) / 100 : null,
      s.varName || '',
    ]);
  });
  fs.writeFileSync(
    path.join(OUT, 'stars-meta.json'),
    JSON.stringify({
      fields: ['index', 'name', 'bayer', 'flamsteed', 'con', 'hip', 'hd', 'distLy', 'spect', 'absmag', 'lum', 'var'],
      rows: meta,
    }),
  );
  console.log(`stars: ${stars.length} (meta ${meta.length})`);
}

// ---------------------------------------------------------- constellations
function buildConstellations() {
  const info = readJSON('constellations.json').features;
  const lines = Object.fromEntries(readJSON('constellations.lines.json').features.map((f) => [f.id, f]));
  const bounds = readJSON('constellations.bounds.json').features;
  const boundsById = {};
  for (const b of bounds) {
    const polys = b.geometry.type === 'Polygon' ? [b.geometry.coordinates] : b.geometry.coordinates;
    boundsById[b.id] = polys.map((p) => p[0].map(([ra, dec]) => [normRa(ra), r4(dec)]));
  }
  const out = info.map((f) => {
    const p = f.properties;
    const l = lines[f.id];
    return {
      id: f.id,
      name: p.name,
      gen: p.gen,
      en: p.en,
      rank: +p.rank,
      label: [normRa(f.geometry.coordinates[0]), r4(f.geometry.coordinates[1])],
      lines: l ? l.geometry.coordinates.map((seg) => seg.map(([ra, dec]) => [normRa(ra), r4(dec)])) : [],
      bounds: boundsById[f.id] || [],
    };
  });
  fs.writeFileSync(path.join(OUT, 'constellations.json'), JSON.stringify(out));
  console.log(`constellations: ${out.length}`);
}

// ------------------------------------------------------------ deep sky
const DSO_TYPES = {
  gc: 'Globular cluster', oc: 'Open cluster', pn: 'Planetary nebula', bn: 'Bright nebula', en: 'Emission nebula',
  rn: 'Reflection nebula', dn: 'Dark nebula', snr: 'Supernova remnant', sfr: 'Star-forming region',
  s: 'Spiral galaxy', s0: 'Lenticular galaxy', e: 'Elliptical galaxy', i: 'Irregular galaxy', g: 'Galaxy',
  gg: 'Galaxy group', pos: 'Asterism', sd: 'Star cloud', ds: 'Double star',
};
function parseDim(dim) {
  if (!dim) return [0, 0];
  const m = String(dim).split('x').map(parseFloat);
  return [m[0] || 0, m[1] || m[0] || 0];
}
function buildDSO() {
  const names = readJSON('dsonames.json');
  const out = new Map();
  for (const f of readJSON('messier.json').features) {
    const p = f.properties;
    const id = p.name.replace(/^M(\d+)/, 'M $1');
    out.set(id, {
      id,
      desig: p.desig,
      name: p.alt || (names[id] && names[id].name) || (names[p.desig] && names[p.desig].name) || '',
      type: p.type,
      typeName: DSO_TYPES[p.type] || 'Deep-sky object',
      mag: p.mag,
      dim: parseDim(p.dim),
      ra: normRa(f.geometry.coordinates[0]),
      dec: r4(f.geometry.coordinates[1]),
      messier: true,
    });
  }
  const messierDesigs = new Set([...out.values()].map((d) => d.desig));
  for (const f of readJSON('dsos.14.json').features) {
    const p = f.properties;
    const mag = parseFloat(p.mag);
    const isCaldwell = /^C \d+$/.test(f.id);
    const named = names[f.id] && names[f.id].name;
    if (/^M \d+$/.test(f.id) || messierDesigs.has(f.id)) continue;
    if (!(isCaldwell || (mag <= 9.0) || (named && mag <= 11.5))) continue;
    if (p.type === 'dn' && !named) continue;
    out.set(f.id, {
      id: f.id,
      desig: p.desig && p.desig !== f.id ? p.desig : '',
      name: named || '',
      type: p.type,
      typeName: DSO_TYPES[p.type] || 'Deep-sky object',
      mag: Number.isFinite(mag) ? mag : null,
      dim: parseDim(p.dim),
      ra: normRa(f.geometry.coordinates[0]),
      dec: r4(f.geometry.coordinates[1]),
      messier: false,
    });
  }
  const list = [...out.values()].sort((a, b) => (a.mag ?? 99) - (b.mag ?? 99));
  fs.writeFileSync(path.join(OUT, 'dso.json'), JSON.stringify(list));
  console.log(`dso: ${list.length}`);
}

// ---------------------------------------------------- milky way outline
function buildMilkyWayOutline() {
  // Only the outermost contour (ol1) is used, for the "Milky Way outline" overlay.
  const mw = readJSON('mw.json').features;
  const ol = mw.find((f) => f.id === 'ol1');
  const polys = ol.geometry.coordinates.map((poly) =>
    poly[0].filter((_, i) => i % 3 === 0).map(([ra, dec]) => [normRa(ra), Math.round(dec * 100) / 100]),
  );
  fs.writeFileSync(path.join(OUT, 'milkyway-outline.json'), JSON.stringify(polys));
}

// ----------------------------------------------------------- comets / TLE
// Comet elements and TLEs are shipped in their original text formats; the app
// parses them at runtime so the bundled copy and a live refresh share one path.
function buildComets() {
  fs.copyFileSync(path.join(SRC, 'CometEls.txt'), path.join(OUT, 'CometEls.txt'));
}
function buildTLE() {
  const out = [];
  for (const f of ['stations.tle', 'visual.tle']) {
    const p = path.join(SRC, f);
    if (!fs.existsSync(p)) continue;
    out.push(fs.readFileSync(p, 'utf8').trim());
  }
  fs.writeFileSync(path.join(OUT, 'satellites.tle'), out.join('\n') + '\n');
}

buildStars();
buildConstellations();
buildDSO();
buildMilkyWayOutline();
buildComets();
buildTLE();
