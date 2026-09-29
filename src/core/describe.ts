import * as A from 'astronomy-engine';
import * as THREE from 'three';
import { worldToAltAz, vecToRaDec } from '../astro/frames';
import { moonPhaseName } from '../astro/events';
import { smallBodyState } from '../astro/smallbodies';
import { predictPasses, satelliteTrack, type SatPass, type SatelliteEntry } from '../astro/satellites';
import { activeShowers, expectedHourlyRate, METEOR_SHOWERS } from '../astro/meteors';
import type { SkyView } from '../render/skyview';
import { shortCometName } from '../render/skyview';
import type { Catalogs } from '../data/catalog';
import type { SkyObject } from './objects';
import { STAR_FACTS, DSO_FACTS, CONSTELLATION_FACTS } from './facts';
import { compass16, fmtAngle, fmtDec, fmtDistanceAU, fmtLy, fmtRA, fmtTime } from '../ui/dom';

export interface InfoRow {
  label: string;
  value: string;
  hint?: string;
}

export interface ObjectInfo {
  title: string;
  subtitle: string;
  badge: string;
  accent: string;
  rows: InfoRow[];
  description?: string;
  status?: { text: string; tone: 'good' | 'warn' | 'muted' };
  passes?: SatPass[];
  /** Suggested field of view (deg) when zooming to the object. */
  zoomFov: number;
}

const SPECTRAL: Record<string, string> = {
  O: 'blue', B: 'blue-white', A: 'white', F: 'yellow-white', G: 'yellow', K: 'orange', M: 'red',
};

function riseSet(body: A.Body, observer: A.Observer, start: A.AstroTime) {
  const rise = A.SearchRiseSet(body, observer, +1, start, 1.1);
  const set = A.SearchRiseSet(body, observer, -1, start, 1.1);
  let transit: A.AstroTime | null = null;
  try {
    transit = A.SearchHourAngle(body, observer, 0, start, +1).time;
    if (transit.ut - start.ut > 1.05) transit = null;
  } catch {
    transit = null;
  }
  return { rise: rise?.date ?? null, set: set?.date ?? null, transit: transit?.date ?? null };
}

/** Rise/transit/set rows for a fixed point (stars, DSOs) or a body. */
function timingRows(body: A.Body, observer: A.Observer, time: A.AstroTime, tz: string, decDeg?: number, lat?: number): InfoRow[] {
  if (decDeg !== undefined && lat !== undefined) {
    if (decDeg > 90 - lat) return [{ label: 'Visibility', value: 'Circumpolar — never sets' }];
    if (decDeg < lat - 90) return [{ label: 'Visibility', value: 'Never rises from here' }];
  }
  const start = time.AddDays(-0.5);
  const r = riseSet(body, observer, start);
  const opt = { weekday: 'short' } as const;
  return [
    { label: 'Rises', value: r.rise ? fmtTime(r.rise, tz, opt) : '—' },
    { label: 'Transits', value: r.transit ? fmtTime(r.transit, tz, opt) : '—' },
    { label: 'Sets', value: r.set ? fmtTime(r.set, tz, opt) : '—' },
  ];
}

function positionRows(dir: THREE.Vector3 | null, ra: number, dec: number, constellation: string, catalogs: Catalogs): InfoRow[] {
  const rows: InfoRow[] = [];
  if (dir) {
    const { alt, az } = worldToAltAz(dir);
    rows.push({ label: 'Altitude', value: `${alt.toFixed(1)}°`, hint: alt < 0 ? 'below horizon' : undefined });
    rows.push({ label: 'Azimuth', value: `${az.toFixed(1)}° ${compass16(az)}` });
  }
  rows.push({ label: 'RA (J2000)', value: fmtRA(ra) });
  rows.push({ label: 'Dec (J2000)', value: fmtDec(dec) });
  const c = catalogs.constellations.find((x) => x.id === constellation);
  if (c) rows.push({ label: 'Constellation', value: c.name });
  return rows;
}

function altitudeStatus(dir: THREE.Vector3 | null, visibleByMag: boolean, sunAlt: number): ObjectInfo['status'] {
  if (!dir) return undefined;
  const { alt } = worldToAltAz(dir);
  if (alt < 0) return { text: 'Below the horizon now', tone: 'muted' };
  if (!visibleByMag) return { text: sunAlt > -6 ? 'Up, but lost in the bright sky' : 'Up, but too faint for the naked eye here', tone: 'warn' };
  if (alt < 10) return { text: 'Visible now · low on the horizon', tone: 'warn' };
  return { text: 'Visible now', tone: 'good' };
}

const passCache = new Map<string, { at: number; passes: SatPass[] }>();

/** Pass predictions are costly; reuse them while the clock stays within a few minutes. */
function cachedPasses(sat: SatelliteEntry, site: { id: string; lat: number; lon: number; elevation: number }, time: Date): SatPass[] {
  const key = `${sat.noradId}:${site.id}:${site.lat}:${site.lon}`;
  const hit = passCache.get(key);
  if (hit && Math.abs(time.getTime() - hit.at) < 5 * 60e3) return hit.passes.filter((p) => p.set.time > time);
  const passes = predictPasses(sat, site, time, 5, 10).slice(0, 8);
  passCache.set(key, { at: time.getTime(), passes });
  return passes;
}

export function describe(o: SkyObject, view: SkyView, catalogs: Catalogs): ObjectInfo | null {
  const f = view.frame;
  if (!f) return null;
  const tz = f.site.timeZone;
  const dir = view.directionOf(o);
  const lm = f.sky.limitingMag;

  switch (o.kind) {
    case 'body': {
      const s = f.bodies.get(o.id)!;
      const rows: InfoRow[] = [];
      rows.push({ label: 'Magnitude', value: s.mag.toFixed(1) });
      if (o.id !== 'Sun') rows.push({ label: 'Distance', value: fmtDistanceAU(s.distAU) });
      rows.push({ label: 'Apparent size', value: fmtAngle(s.angularRadius * 2) });
      if (o.id !== 'Sun') {
        rows.push({ label: 'Illuminated', value: `${(s.phase * 100).toFixed(1)}%` });
        rows.push({ label: 'Elongation', value: `${s.elongation.toFixed(1)}° from the Sun` });
      }
      if (o.id === 'Moon') {
        const phase = A.MoonPhase(f.astroTime);
        rows.unshift({ label: 'Phase', value: moonPhaseName(phase) });
        const lib = A.Libration(f.astroTime);
        rows.push({ label: 'Libration', value: `${lib.elon >= 0 ? '+' : ''}${lib.elon.toFixed(1)}° lon · ${lib.elat >= 0 ? '+' : ''}${lib.elat.toFixed(1)}° lat` });
        const age = ((phase / 360) * 29.530588).toFixed(1);
        rows.push({ label: 'Age', value: `${age} days` });
      }
      rows.push(...positionRows(dir, s.ra, s.dec, A.Constellation(s.ra, s.dec).symbol, catalogs));
      rows.push(...timingRows(s.info.body, f.observer, f.astroTime, tz));
      const visible = o.id === 'Sun' || o.id === 'Moon' || s.mag < lm;
      return {
        title: s.info.name,
        subtitle: s.info.kind === 'star' ? 'Our star' : s.info.kind === 'moon' ? 'Earth’s Moon' : s.info.kind === 'dwarf' ? 'Dwarf planet' : 'Planet',
        badge: s.info.kind === 'star' ? 'STAR' : s.info.kind === 'moon' ? 'MOON' : 'PLANET',
        accent: s.info.tint,
        rows,
        description: s.info.facts + (o.id === 'Sun' ? ' Never look at the Sun directly or through optics without a certified solar filter.' : ''),
        status: altitudeStatus(dir, visible, f.sunAlt),
        zoomFov: Math.max(0.3, Math.min(20, s.angularRadius * 2 * 6)),
      };
    }
    case 'star': {
      const m = catalogs.stars.meta.get(o.index);
      const d = catalogs.stars.data;
      const mag = d[o.index * 5 + 3];
      const bv = d[o.index * 5 + 4];
      const eq = vecToRaDec(new THREE.Vector3(d[o.index * 5], d[o.index * 5 + 1], d[o.index * 5 + 2]));
      const rows: InfoRow[] = [{ label: 'Magnitude', value: mag.toFixed(2) }];
      if (m?.distLy) rows.push({ label: 'Distance', value: fmtLy(m.distLy) });
      if (m?.spect) {
        const cls = m.spect.trim()[0];
        rows.push({ label: 'Spectral type', value: `${m.spect}${SPECTRAL[cls] ? ` · ${SPECTRAL[cls]}` : ''}` });
      }
      rows.push({ label: 'Colour index', value: `B−V ${bv.toFixed(2)}` });
      if (m?.lum && m.lum > 0) rows.push({ label: 'Luminosity', value: `${m.lum >= 100 ? Math.round(m.lum).toLocaleString() : m.lum.toFixed(2)} × Sun` });
      if (m?.variable) rows.push({ label: 'Variable', value: m.variable });
      const con = m?.con || A.Constellation(eq.ra, eq.dec).symbol;
      rows.push(...positionRows(dir, eq.ra, eq.dec, con, catalogs));
      A.DefineStar(A.Body.Star1, eq.ra, eq.dec, m?.distLy || 1000);
      rows.push(...timingRows(A.Body.Star1, f.observer, f.astroTime, tz, eq.dec, f.site.lat));
      const ids = [m?.bayer && m.name ? `${m.bayer} ${catalogs.constellations.find((c) => c.id === m.con)?.gen ?? m.con}` : '', m?.hip ? `HIP ${m.hip}` : '', m?.hd ? `HD ${m.hd}` : ''].filter(Boolean);
      return {
        title: view.starName(o.index),
        subtitle: ids.join(' · ') || 'Star',
        badge: 'STAR',
        accent: '#' + view.starColor(o.index).getHexString(),
        rows,
        description: (m?.name && STAR_FACTS[m.name]) || undefined,
        status: altitudeStatus(dir, mag < lm, f.sunAlt),
        zoomFov: 8,
      };
    }
    case 'dso': {
      const dso = catalogs.dso.find((x) => x.id === o.id)!;
      const rows: InfoRow[] = [{ label: 'Type', value: dso.typeName }];
      if (dso.mag != null) rows.push({ label: 'Magnitude', value: dso.mag.toFixed(1) });
      if (dso.dim[0]) rows.push({ label: 'Size', value: dso.dim[1] && dso.dim[1] !== dso.dim[0] ? `${fmtAngle(dso.dim[0] / 60)} × ${fmtAngle(dso.dim[1] / 60)}` : fmtAngle(dso.dim[0] / 60) });
      const ra = dso.ra / 15;
      rows.push(...positionRows(dir, ra, dso.dec, A.Constellation(ra, dso.dec).symbol, catalogs));
      A.DefineStar(A.Body.Star1, ra, dso.dec, 1e6);
      rows.push(...timingRows(A.Body.Star1, f.observer, f.astroTime, tz, dso.dec, f.site.lat));
      const eye = dso.mag != null && dso.mag < Math.min(lm, 6.5) - 0.5;
      const how = dso.mag == null ? '' : eye ? ' Visible to the naked eye from here tonight.' : dso.mag < 9.5 ? ' Binoculars will show it from a dark site.' : ' Best with a telescope.';
      const title = dso.messier ? `${dso.id.replace(' ', '')}${dso.name ? ` · ${dso.name}` : ''}` : dso.name || dso.id;
      return {
        title,
        subtitle: [dso.desig || (dso.name ? dso.id : ''), dso.typeName].filter(Boolean).join(' · '),
        badge: 'DEEP SKY',
        accent: '#b58cff',
        rows,
        description: ((DSO_FACTS[dso.id] || DSO_FACTS[dso.desig] || '') + how).trim() || undefined,
        status: altitudeStatus(dir, eye, f.sunAlt),
        zoomFov: Math.max(0.8, Math.min(30, (dso.dim[0] / 60) * 4 || 3)),
      };
    }
    case 'smallbody': {
      const el = view.smallBodyById(o.id);
      if (!el) return null;
      const s = smallBodyState(el, f.astroTime, f.observer);
      const comet = el.kind === 'comet';
      const rows: InfoRow[] = [
        { label: 'Magnitude', value: Number.isFinite(s.mag) ? `${s.mag.toFixed(1)} (predicted)` : 'unknown' },
        { label: 'Distance', value: fmtDistanceAU(s.delta) },
        { label: 'From the Sun', value: `${s.r.toFixed(2)} AU` },
        { label: 'Elongation', value: `${s.elongation.toFixed(0)}° from the Sun` },
      ];
      if (comet) {
        const tp = new Date((el.tp - 2440587.5) * 86400000);
        rows.push({ label: 'Perihelion', value: `${tp.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · q = ${el.q.toFixed(3)} AU` });
        rows.push({ label: 'Orbit', value: el.e < 1 ? `period ${(Math.pow(el.q / (1 - el.e), 1.5)).toFixed(1)} yr · e = ${el.e.toFixed(3)}` : `${el.e > 1 ? 'hyperbolic' : 'parabolic'} · e = ${el.e.toFixed(4)}` });
      } else {
        rows.push({ label: 'Orbit', value: `a = ${el.a.toFixed(2)} AU · period ${Math.pow(el.a, 1.5).toFixed(2)} yr` });
        if (el.diameter) rows.push({ label: 'Diameter', value: `${Math.round(el.diameter)} km` });
      }
      rows.push(...positionRows(dir, s.ra, s.dec, s.constellation, catalogs));
      const eye = s.mag < lm;
      return {
        title: comet ? shortCometName(el.name) : el.name,
        subtitle: comet ? 'Comet' : `Asteroid (${(el as { number: number }).number})`,
        badge: comet ? 'COMET' : 'ASTEROID',
        accent: comet ? '#8ff0d0' : '#e8d9b8',
        rows,
        description: comet
          ? `Brightness predictions for comets are notoriously uncertain — they can flare or fade. ${s.mag < 6 ? 'Currently predicted to be visible to the naked eye!' : s.mag < 9 ? 'A binocular target from a dark site.' : 'A telescope target.'}`
          : 'A rocky world from the main asteroid belt, shining by reflected sunlight.',
        status: altitudeStatus(dir, eye, f.sunAlt),
        zoomFov: comet ? 10 : 4,
      };
    }
    case 'satellite': {
      const sat = view.satellites.find((s) => s.noradId === o.noradId);
      if (!sat) return null;
      const l = view.getSatLook(o.noradId);
      const rows: InfoRow[] = [];
      if (l) {
        rows.push({ label: 'Altitude', value: `${l.alt.toFixed(1)}°` }, { label: 'Azimuth', value: `${l.az.toFixed(0)}° ${compass16(l.az)}` });
        rows.push({ label: 'Range', value: `${Math.round(l.rangeKm).toLocaleString()} km` });
        rows.push({ label: 'Orbit height', value: `${Math.round(l.altitudeKm)} km` });
        rows.push({ label: 'Speed', value: `${l.velocityKmS.toFixed(2)} km/s` });
        rows.push({ label: 'Sunlit', value: l.sunlit ? `Yes · mag ${l.mag.toFixed(1)}` : 'No — in Earth’s shadow' });
      }
      rows.push({ label: 'NORAD ID', value: String(sat.noradId) });
      rows.push({ label: 'TLE epoch', value: sat.epoch.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) });
      const passes = cachedPasses(sat, f.site, f.time);
      return {
        title: sat.name,
        subtitle: sat.fullName !== sat.name ? sat.fullName : 'Artificial satellite',
        badge: 'SATELLITE',
        accent: '#7ee0ff',
        rows,
        description: sat.noradId === 25544
          ? 'The International Space Station orbits every ~92 minutes at 28,000 km/h. It shines by reflected sunlight, so it is only visible around dawn and dusk.'
          : sat.noradId === 48274
            ? 'China’s Tiangong space station, in a 41.5° orbit at about 390 km.'
            : sat.noradId === 20580
              ? 'The Hubble Space Telescope, orbiting since 1990 at about 530 km.'
              : undefined,
        status: l ? (l.alt < 0 ? { text: 'Below the horizon', tone: 'muted' } : l.sunlit ? { text: 'Overhead and sunlit — look now!', tone: 'good' } : { text: 'Above the horizon, but in Earth’s shadow', tone: 'warn' }) : { text: 'Below the horizon', tone: 'muted' },
        passes,
        zoomFov: 40,
      };
    }
    case 'constellation': {
      const c = catalogs.constellations.find((x) => x.id === o.id);
      if (!c) return null;
      const ra = c.label[0] / 15;
      const rows: InfoRow[] = [{ label: 'Meaning', value: c.en }, { label: 'Genitive', value: c.gen }, { label: 'Abbreviation', value: c.id }];
      if (dir) {
        const { alt, az } = worldToAltAz(dir);
        rows.push({ label: 'Centre altitude', value: `${alt.toFixed(0)}°` }, { label: 'Direction', value: compass16(az) });
      }
      A.DefineStar(A.Body.Star1, ra, c.label[1], 1000);
      rows.push(...timingRows(A.Body.Star1, f.observer, f.astroTime, tz, c.label[1], f.site.lat));
      return {
        title: c.name,
        subtitle: `Constellation · “${c.en}”`,
        badge: 'CONSTELLATION',
        accent: '#7fa3d9',
        rows,
        description: CONSTELLATION_FACTS[c.id],
        status: dir ? (worldToAltAz(dir).alt > 0 ? { text: 'Above the horizon', tone: 'good' } : { text: 'Below the horizon', tone: 'muted' }) : undefined,
        zoomFov: 50,
      };
    }
    case 'moonlet': {
      const facts: Record<string, string> = {
        Io: 'The most volcanically active world in the Solar System, squeezed by Jupiter’s tides.',
        Europa: 'An icy moon hiding a global ocean beneath its crust — a prime place to search for life.',
        Ganymede: 'The largest moon in the Solar System, bigger than the planet Mercury.',
        Callisto: 'An ancient, heavily cratered moon orbiting outside Jupiter’s harshest radiation.',
      };
      return {
        title: o.name,
        subtitle: 'Galilean moon of Jupiter',
        badge: 'MOON',
        accent: '#d8d2c4',
        rows: dir ? (() => {
          const eq = vecToRaDec(dir.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(f.eqjToWorld).transpose()));
          return positionRows(dir, eq.ra, eq.dec, A.Constellation(eq.ra, eq.dec).symbol, catalogs);
        })() : [],
        description: `${facts[o.name] ?? ''} Discovered by Galileo in January 1610; any small telescope or steadily held binoculars will show it.`,
        zoomFov: 0.8,
      };
    }
    case 'radiant': {
      const sh = METEOR_SHOWERS.find((s) => s.id === o.id);
      if (!sh) return null;
      const act = activeShowers(f.time).find((a) => a.shower.id === o.id);
      const rate = expectedHourlyRate(sh, f.time, f.site, lm);
      const rows: InfoRow[] = [
        { label: 'ZHR now', value: act ? act.zhr.toFixed(0) : '0', hint: `peak ${sh.zhr}` },
        { label: 'Expected here', value: `~${Math.round(rate)} meteors / hour` },
        { label: 'Speed', value: `${sh.speedKms} km/s` },
        { label: 'Parent body', value: sh.parent },
      ];
      if (dir) {
        const { alt, az } = worldToAltAz(dir);
        rows.push({ label: 'Radiant altitude', value: `${alt.toFixed(0)}°` }, { label: 'Direction', value: compass16(az) });
      }
      return {
        title: sh.name,
        subtitle: 'Meteor shower radiant',
        badge: 'METEORS',
        accent: '#ffb36b',
        rows,
        description: `${sh.description} Meteors can appear anywhere in the sky; trace them back and they point to this radiant.`,
        status: rate > 0 ? { text: `Active · ~${Math.round(rate)}/hr from ${f.site.name}`, tone: 'good' } : { text: 'Radiant below the horizon', tone: 'muted' },
        zoomFov: 90,
      };
    }
  }
}

/** Alt/az (deg) track of a satellite around the current time, for drawing its path. */
export function satellitePath(view: SkyView, noradId: number): [number, number][] | null {
  const f = view.frame;
  const sat = view.satellites.find((s) => s.noradId === noradId);
  if (!f || !sat) return null;
  return satelliteTrack(sat, f.site, f.time, 8, 12, 15).map((p) => [p.alt, p.az] as [number, number]);
}

/** Just the display name of an object (cheap; for hover and pointing labels). */
export function objectTitle(o: SkyObject, view: SkyView, catalogs: Catalogs): string {
  switch (o.kind) {
    case 'body':
      return o.id;
    case 'star':
      return view.starName(o.index);
    case 'dso': {
      const d = catalogs.dso.find((x) => x.id === o.id);
      return d ? (d.messier ? `${d.id.replace(' ', '')}${d.name ? ` ${d.name}` : ''}` : d.name || d.id) : o.id;
    }
    case 'smallbody': {
      const el = view.smallBodyById(o.id);
      return el ? (el.kind === 'comet' ? shortCometName(el.name) : el.name) : '';
    }
    case 'satellite':
      return view.satellites.find((s) => s.noradId === o.noradId)?.name ?? 'Satellite';
    case 'constellation':
      return catalogs.constellations.find((c) => c.id === o.id)?.name ?? o.id;
    case 'moonlet':
      return o.name;
    case 'radiant':
      return METEOR_SHOWERS.find((s) => s.id === o.id)?.name ?? '';
  }
}
