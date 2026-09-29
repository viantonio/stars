// Refreshes the bundled snapshots of fast-changing data (comet orbits from the
// Minor Planet Center, satellite elements from CelesTrak). The app also fetches
// these live at runtime; the snapshot is the offline fallback.
import fs from 'node:fs';

const OUT = 'public/data';

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'stars-observatory (github.com/viantonio/stars)' } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

const comets = await get('https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt');
if (comets.split('\n').length > 500) fs.writeFileSync(`${OUT}/CometEls.txt`, comets);

const groups = await Promise.all(['stations', 'visual'].map((g) => get(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`)));
const tle = groups.map((t) => t.trim()).join('\n') + '\n';
if (tle.includes('25544')) fs.writeFileSync(`${OUT}/satellites.tle`, tle);

console.log('Live data refreshed');
