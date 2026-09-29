/**
 * Astrological "notes": the moments astrologers track — sign ingresses,
 * retrograde and direct stations, New and Full Moons, eclipses, and exact
 * aspects between the slow planets — found by root-finding on the same real
 * ephemeris as the sky view, plus a short traditional reading for the world
 * and (with personalNote) for a natal chart.
 *
 * Pure TypeScript: no DOM, no three.js.
 */
import * as A from 'astronomy-engine';
import {
  aspectBetween, formatLongitude, houseOf, norm180, norm360, trueAyanamsa, zodiacLongitude, type PlanetId,
} from './astrology';
import { POINT_INFO, SIGNS } from './correspondences';
import {
  ASPECT_WORLD_VERBS, ECLIPSE_MEANINGS, HOUSE_THEMES, LUNATION_MEANINGS, PLANET_TRANSIT_THEMES, SIGN_STYLES, STATION_MEANINGS,
} from './interpretations';
import type { AspectType, Ayanamsa, Chart, PointId, ZodiacMode } from './types';

export type AstroEventKind =
  | 'ingress' | 'station-retrograde' | 'station-direct' | 'new-moon' | 'full-moon' | 'solar-eclipse' | 'lunar-eclipse' | 'aspect';

export interface AstroEvent {
  /** Deterministic id: kind, bodies, sign/aspect and the UTC hour of the event. */
  id: string;
  kind: AstroEventKind;
  date: Date;
  body: PointId;
  body2?: PointId;
  /** Sign (0 = Aries) and degree within it of `body`, in the chosen zodiac. */
  sign: number;
  degree: number;
  /** For ingresses: the sign being left. */
  fromSign?: number;
  aspect?: AspectType;
  title: string;
  /** Traditional mundane reading, 1–2 sentences. */
  world: string;
  /** e.g. "until Nov 4, 2026" — the next ingress (or opposite station) of the same body. */
  duration?: string;
  /** The moment `duration` refers to. */
  until?: Date;
  /** Longitude of `body` in the chosen zodiac, degrees. */
  longitude: number;
  /** Tropical longitude of `body` (for converting to another zodiac). */
  tropicalLongitude: number;
  /** For aspects: tropical longitude of `body2`. */
  tropicalLongitude2?: number;
  zodiac: ZodiacMode;
  /** For eclipses: 'total' | 'annular' | 'partial' | 'penumbral'. */
  eclipseKind?: string;
  /** For ingresses: true when a retrograde planet backs into the previous sign. */
  retrograde?: boolean;
}

export interface AstroEventOptions {
  zodiac?: ZodiacMode;
  ayanamsa?: Ayanamsa;
  includeMoonIngress?: boolean;
  /** IANA zone for the `duration` text (default: the runtime's local zone). */
  timeZone?: string;
}

const INGRESS_BODIES: PlanetId[] = ['Sun', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
const STATION_BODIES: PlanetId[] = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
const SLOW: PlanetId[] = ['Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];

/** Sampling step (days) and the longest stay in one sign (days) per body. */
const STEP: Record<PlanetId, number> = { Moon: 0.25, Sun: 1, Mercury: 0.5, Venus: 1, Mars: 1, Jupiter: 2, Saturn: 3, Uranus: 4, Neptune: 5, Pluto: 5 };
const MAX_STAY: Record<PlanetId, number> = { Moon: 4, Sun: 35, Mercury: 140, Venus: 170, Mars: 250, Jupiter: 450, Saturn: 1200, Uranus: 3300, Neptune: 5800, Pluto: 12500 };
/** How far ahead to look for the next station (synodic period plus margin), days. */
const STATION_SCAN: Record<PlanetId, number> = { Sun: 0, Moon: 0, Mercury: 130, Venus: 600, Mars: 820, Jupiter: 420, Saturn: 400, Uranus: 390, Neptune: 390, Pluto: 390 };
const TOL_DAYS = 1e-5;

const ASPECT_TARGETS: [number, AspectType][] = [[0, 'conjunction'], [60, 'sextile'], [90, 'square'], [120, 'trine'], [180, 'opposition'], [240, 'trine'], [270, 'square'], [300, 'sextile']];

type Lon = (t: A.AstroTime) => number;

/** Bisect for the root of a continuous f on [lo, hi] with f(lo)·f(hi) ≤ 0. */
function bisect(f: (t: A.AstroTime) => number, lo: A.AstroTime, hi: A.AstroTime): A.AstroTime {
  let a = lo.ut, b = hi.ut;
  let fa = f(lo);
  while (b - a > TOL_DAYS) {
    const m = (a + b) / 2;
    const fm = f(A.MakeTime(m));
    if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m;
  }
  return A.MakeTime((a + b) / 2);
}

/** Speed (deg/day) by central difference. */
const speedOf = (lon: Lon, t: A.AstroTime, h = 0.01) => norm180(lon(t.AddDays(h)) - lon(t.AddDays(-h))) / (2 * h);

interface Sample { t: A.AstroTime; lon: number; u: number }

function sampleBody(lon: Lon, start: A.AstroTime, end: A.AstroTime, step: number): Sample[] {
  const out: Sample[] = [];
  for (let d = start.ut - step; ; d += step) {
    const t = A.MakeTime(d);
    const l = lon(t);
    const u = out.length ? out[out.length - 1].u + norm180(l - out[out.length - 1].lon) : l;
    out.push({ t, lon: l, u });
    if (d > end.ut + step) break;
  }
  return out;
}

/** Stations (speed = 0) found from reversals in the sampled longitudes. */
function findStations(lon: Lon, samples: Sample[]): { t: A.AstroTime; dir: 'retrograde' | 'direct' }[] {
  const out: { t: A.AstroTime; dir: 'retrograde' | 'direct' }[] = [];
  for (let i = 1; i + 1 < samples.length; i++) {
    const d0 = samples[i].u - samples[i - 1].u, d1 = samples[i + 1].u - samples[i].u;
    if ((d0 < 0) === (d1 < 0)) continue;
    const lo = samples[i - 1].t, hi = samples[i + 1].t;
    const f = (t: A.AstroTime) => speedOf(lon, t);
    if ((f(lo) < 0) === (f(hi) < 0)) continue;
    const t = bisect(f, lo, hi);
    if (out.length && Math.abs(out[out.length - 1].t.ut - t.ut) < 1) continue;
    out.push({ t, dir: d0 > 0 ? 'retrograde' : 'direct' });
  }
  return out;
}

interface Crossing { t: A.AstroTime; sign: number; fromSign: number; retrograde: boolean }

/** Sign-boundary crossings; intervals are split at stations so each is monotonic. */
function findIngresses(lon: Lon, samples: Sample[], stations: { t: A.AstroTime }[]): Crossing[] {
  const pts: { t: A.AstroTime; u: number }[] = samples.map((s) => ({ t: s.t, u: s.u }));
  for (const st of stations) {
    const i = pts.findIndex((p) => p.t.ut > st.t.ut);
    if (i <= 0) continue;
    const prev = pts[i - 1];
    pts.splice(i, 0, { t: st.t, u: prev.u + norm180(lon(st.t) - norm360(prev.u)) });
  }
  const out: Crossing[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const ka = Math.floor(a.u / 30), kb = Math.floor(b.u / 30);
    if (ka === kb) continue;
    const forward = b.u > a.u;
    const ks: number[] = [];
    if (forward) for (let k = ka + 1; k <= kb; k++) ks.push(k);
    else for (let k = ka; k > kb; k--) ks.push(k);
    for (const k of ks) {
      const B = 30 * k;
      const t = bisect((x) => norm180(lon(x) - B), a.t, b.t);
      const boundarySign = ((k % 12) + 12) % 12;
      out.push(forward
        ? { t, sign: boundarySign, fromSign: (boundarySign + 11) % 12, retrograde: false }
        : { t, sign: (boundarySign + 11) % 12, fromSign: boundarySign, retrograde: true });
    }
  }
  return out;
}

const name = (id: PointId) => POINT_INFO[id].name;
const signName = (s: number) => SIGNS[s].name;

function fmtDate(d: Date, timeZone?: string): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone });
}

function eventId(kind: AstroEventKind, body: PointId, extra: string, t: Date, body2?: PointId): string {
  const hour = new Date(Math.floor(t.getTime() / 3600e3) * 3600e3).toISOString().slice(0, 13);
  return `${kind}:${body}${body2 ? '-' + body2 : ''}:${extra}:${hour}`;
}

/** First sign change of `lon` after `from`, scanning up to `maxDays`. */
function nextIngressAfter(lon: Lon, from: A.AstroTime, maxDays: number, step: number): Date | undefined {
  const t0 = from.AddDays(TOL_DAYS * 10);
  const sign0 = Math.floor(lon(t0) / 30);
  let prev = t0;
  for (let d = step; d <= maxDays + step; d += step) {
    const t = t0.AddDays(d);
    const s = Math.floor(lon(t) / 30);
    if (s !== sign0) {
      const B = (s === (sign0 + 1) % 12 ? s : sign0) * 30;
      return bisect((x) => norm180(lon(x) - B), prev, t).date;
    }
    prev = t;
  }
  return undefined;
}

/** The next station after `from` (any direction), scanning up to `maxDays`. */
function nextStationAfter(lon: Lon, from: A.AstroTime, maxDays: number, step: number): Date | undefined {
  const t0 = from.AddDays(1);
  const s = sampleBody(lon, t0, t0.AddDays(maxDays), step);
  return findStations(lon, s).find((st) => st.t.ut > from.ut + 1)?.t.date;
}

/** Search all event kinds in [start, end), sorted by date. */
export function computeAstroEvents(start: Date, end: Date, opts: AstroEventOptions = {}): AstroEvent[] {
  const zodiac = opts.zodiac ?? 'tropical';
  const ayanamsa = opts.ayanamsa ?? 'lahiri';
  const t0 = A.MakeTime(start), t1 = A.MakeTime(end);
  const lonFn = (id: PlanetId): Lon => (t) => zodiacLongitude(id, t, zodiac, ayanamsa);
  const tropFn = (id: PlanetId): Lon => (t) => zodiacLongitude(id, t, 'tropical');
  const inRange = (t: A.AstroTime) => t.ut >= t0.ut && t.ut < t1.ut;
  const events: AstroEvent[] = [];

  const base = (kind: AstroEventKind, id: PlanetId, t: A.AstroTime) => {
    const l = lonFn(id)(t);
    const sign = Math.floor(l / 30);
    return { kind, date: t.date, body: id as PointId, sign, degree: l - sign * 30, longitude: l, tropicalLongitude: tropFn(id)(t), zodiac };
  };

  // Ingresses and stations.
  const bodies: PlanetId[] = opts.includeMoonIngress ? ['Moon', ...INGRESS_BODIES] : INGRESS_BODIES;
  for (const id of bodies) {
    const lon = lonFn(id);
    const samples = sampleBody(lon, t0, t1, STEP[id]);
    const stations = STATION_BODIES.includes(id) ? findStations(lon, samples) : [];
    const ingresses = findIngresses(lon, samples, stations);

    ingresses.forEach((c, i) => {
      if (!inRange(c.t)) return;
      const b = base('ingress', id, c.t);
      const sign = c.sign;
      const next = ingresses.slice(i + 1).find((x) => x.t.ut > c.t.ut + TOL_DAYS)?.t.date
        ?? nextIngressAfter(lon, c.t, MAX_STAY[id], STEP[id]);
      const theme = PLANET_TRANSIT_THEMES[id]!;
      events.push({
        ...b, sign, fromSign: c.fromSign, retrograde: c.retrograde,
        // On the boundary by definition (the root-finder lands within ~1e-5°); a retrograde
        // re-entry arrives at the END of the sign, shown as 29°59′.
        degree: c.retrograde ? 30 - 1e-7 : 0,
        longitude: c.retrograde ? sign * 30 + 30 - 1e-7 : sign * 30,
        tropicalLongitude: norm360((c.retrograde ? sign * 30 + 30 - 1e-7 : sign * 30) + b.tropicalLongitude - b.longitude),
        id: eventId('ingress', id, signName(sign), c.t.date),
        title: c.retrograde ? `${name(id)} re-enters ${signName(sign)} (retrograde)` : `${name(id)} enters ${signName(sign)}`,
        world: `Traditionally, ${name(id)} in ${signName(sign)} colours ${theme.world} with ${SIGN_STYLES[sign]}.`,
        ...(next ? { until: next, duration: `until ${fmtDate(next, opts.timeZone)}` } : {}),
      });
    });

    stations.forEach((st, i) => {
      if (!inRange(st.t)) return;
      const b = base(st.dir === 'retrograde' ? 'station-retrograde' : 'station-direct', id, st.t);
      const next = stations[i + 1]?.t.date ?? nextStationAfter(lon, st.t, STATION_SCAN[id], Math.min(STEP[id], 2));
      const theme = PLANET_TRANSIT_THEMES[id]!;
      events.push({
        ...b,
        id: eventId(b.kind, id, signName(b.sign), st.t.date),
        title: `${name(id)} stations ${st.dir} in ${signName(b.sign)}`,
        world: st.dir === 'retrograde'
          ? `Traditionally, ${name(id)} retrograde turns ${theme.world} inward, a time for review and reconsideration, here in the key of ${SIGN_STYLES[b.sign]}.`
          : `Traditionally, ${name(id)} stationing direct releases ${theme.world} forward again, in the key of ${SIGN_STYLES[b.sign]}.`,
        ...(next ? { until: next, duration: `${st.dir === 'retrograde' ? 'retrograde' : 'direct'} until ${fmtDate(next, opts.timeZone)}` } : {}),
      });
    });
  }

  // Eclipses (collected first so they replace the coinciding lunation).
  const eclipses: AstroEvent[] = [];
  for (let e = A.SearchGlobalSolarEclipse(t0.AddDays(-1)); e.peak.ut < t1.ut; e = A.NextGlobalSolarEclipse(e.peak)) {
    if (!inRange(e.peak)) continue;
    const b = base('solar-eclipse', 'Sun', e.peak);
    const kind = String(e.kind);
    eclipses.push({
      ...b, body2: 'Moon', eclipseKind: kind,
      id: eventId('solar-eclipse', 'Sun', signName(b.sign), e.peak.date),
      title: `${kind[0].toUpperCase()}${kind.slice(1)} solar eclipse in ${signName(b.sign)}`,
      world: `${ECLIPSE_MEANINGS.solar} This one falls in ${signName(b.sign)}, the sign of ${SIGN_STYLES[b.sign]}.`,
    });
  }
  for (let e = A.SearchLunarEclipse(t0.AddDays(-1)); e.peak.ut < t1.ut; e = A.NextLunarEclipse(e.peak)) {
    if (!inRange(e.peak)) continue;
    const b = base('lunar-eclipse', 'Moon', e.peak);
    const kind = String(e.kind);
    eclipses.push({
      ...b, eclipseKind: kind,
      id: eventId('lunar-eclipse', 'Moon', signName(b.sign), e.peak.date),
      title: `${kind[0].toUpperCase()}${kind.slice(1)} lunar eclipse in ${signName(b.sign)}`,
      world: `${ECLIPSE_MEANINGS.lunar} This one falls in ${signName(b.sign)}, the sign of ${SIGN_STYLES[b.sign]}.`,
    });
  }
  events.push(...eclipses);

  // New and Full Moons.
  for (const [phase, kind] of [[0, 'new-moon'], [180, 'full-moon']] as const) {
    let t: A.AstroTime | null = t0;
    while (t && t.ut < t1.ut) {
      const hit: A.AstroTime | null = A.SearchMoonPhase(phase, t, 40);
      if (!hit || hit.ut >= t1.ut) break;
      const eclipseKind = kind === 'new-moon' ? 'solar-eclipse' : 'lunar-eclipse';
      if (!eclipses.some((e) => e.kind === eclipseKind && Math.abs(e.date.getTime() - hit.date.getTime()) < 86400e3)) {
        const b = base(kind, 'Moon', hit);
        const opp = (b.sign + 6) % 12;
        events.push({
          ...b,
          id: eventId(kind, 'Moon', signName(b.sign), hit.date),
          title: `${kind === 'new-moon' ? 'New' : 'Full'} Moon in ${signName(b.sign)}`,
          world: kind === 'new-moon'
            ? `${LUNATION_MEANINGS.new} This one seeds a cycle in the key of ${SIGN_STYLES[b.sign]}.`
            : `${LUNATION_MEANINGS.full} This one balances ${SIGN_STYLES[b.sign]} (Moon in ${signName(b.sign)}) against ${SIGN_STYLES[opp]} (Sun in ${signName(opp)}).`,
        });
      }
      t = hit.AddDays(20);
    }
  }

  // Exact aspects between the slow planets (sampled every 2 days; relative motion < 0.5°/day).
  const trop = SLOW.map((id) => sampleBody(tropFn(id), t0, t1, 2));
  for (let i = 0; i < SLOW.length; i++) {
    for (let j = i + 1; j < SLOW.length; j++) {
      const a = SLOW[i], b = SLOW[j];
      const la = tropFn(a), lb = tropFn(b);
      for (const [target, type] of ASPECT_TARGETS) {
        const f = (t: A.AstroTime) => norm180(norm360(la(t) - lb(t)) - target);
        for (let k = 0; k + 1 < trop[i].length; k++) {
          const f0 = norm180(norm360(trop[i][k].lon - trop[j][k].lon) - target);
          const f1 = norm180(norm360(trop[i][k + 1].lon - trop[j][k + 1].lon) - target);
          if (Math.abs(f0) > 10 || Math.abs(f1) > 10 || (f0 < 0) === (f1 < 0) || f1 === 0) continue;
          const t = bisect(f, trop[i][k].t, trop[i][k + 1].t);
          if (!inRange(t)) continue;
          const bb = base('aspect', a, t);
          const ta = PLANET_TRANSIT_THEMES[a]!, tb = PLANET_TRANSIT_THEMES[b]!;
          events.push({
            ...bb, body2: b, aspect: type, tropicalLongitude2: lb(t),
            id: eventId('aspect', a, type, t.date, b),
            title: `${name(a)} ${type} ${name(b)}`,
            world: `Traditionally, the exact ${name(a)}–${name(b)} ${type} ${ASPECT_WORLD_VERBS[type]} ${name(a)} (${ta.world}) and ${name(b)} (${tb.world}).`,
          });
        }
      }
    }
  }

  return events.sort((x, y) => x.date.getTime() - y.date.getTime());
}

// ---------------------------------------------------------------------------
// Personal notes
// ---------------------------------------------------------------------------

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export interface PersonalNote {
  house: number;
  houseTheme: string;
  contacts: { point: PointId; aspect: AspectType; orb: number }[];
  text: string;
}

const ALL_ASPECTS: AspectType[] = ['conjunction', 'sextile', 'square', 'trine', 'opposition'];
const CONTACT_ORB = 3;

/**
 * Where an event falls in a natal chart (house by the natal cusps) and which
 * natal points it closely aspects (≤ 3°), with a short traditional reading.
 */
export function personalNote(event: AstroEvent, natal: Chart): PersonalNote {
  const toNatal = (trop: number) => natal.zodiac === 'sidereal'
    ? norm360(trop - trueAyanamsa(event.date, natal.ayanamsaKind ?? 'lahiri'))
    : trop;
  const lon = toNatal(event.tropicalLongitude);
  const lon2 = event.tropicalLongitude2 !== undefined ? toNatal(event.tropicalLongitude2) : undefined;
  const house = houseOf(lon, natal.cusps);
  const h = HOUSE_THEMES[house - 1];

  const orbs: Record<AspectType, number> = { conjunction: CONTACT_ORB, sextile: CONTACT_ORB, square: CONTACT_ORB, trine: CONTACT_ORB, opposition: CONTACT_ORB };
  const best = new Map<PointId, { point: PointId; aspect: AspectType; orb: number }>();
  for (const l of lon2 === undefined ? [lon] : [lon, lon2]) {
    for (const np of natal.points) {
      const allowed = np.id === 'NorthNode' || np.id === 'SouthNode' ? (['conjunction'] as AspectType[]) : ALL_ASPECTS;
      const asp = aspectBetween({ id: event.body, lon: l, speed: 0 }, { id: np.id, lon: np.longitude, speed: 0 }, orbs, allowed);
      if (asp && (!best.has(np.id) || best.get(np.id)!.orb > asp.orb)) best.set(np.id, { point: np.id, aspect: asp.type, orb: asp.orb });
    }
  }
  const contacts = [...best.values()].sort((a, b) => a.orb - b.orb);

  const where = `your ${ordinal(house)} house (${h.name})`;
  const at = formatLongitude(lon);
  const body = name(event.body);
  const sign = SIGNS[event.kind === 'ingress' && natal.zodiac === event.zodiac ? event.sign : Math.floor(norm360(lon + 1e-6) / 30)].name;
  let text: string;
  switch (event.kind) {
    case 'ingress': {
      const verb = PLANET_TRANSIT_THEMES[event.body as PlanetId]?.verb ?? 'traditionally colours';
      text = `${body} ${event.retrograde ? 're-enters' : 'enters'} ${sign} in ${where}: it ${verb} ${h.area}.`;
      break;
    }
    case 'station-retrograde':
      text = `${body} turns retrograde at ${at} in ${where}. ${STATION_MEANINGS.retrograde.replace(/\.$/, '')}, here around ${h.area}.`;
      break;
    case 'station-direct':
      text = `${body} turns direct at ${at} in ${where}: matters of ${h.area} that were under review traditionally begin to move forward again.`;
      break;
    case 'new-moon':
      text = `The New Moon at ${at} falls in ${where}: traditionally a moment to set intentions around ${h.area}.`;
      break;
    case 'full-moon':
      text = `The Full Moon at ${at} lights ${where}: traditionally a culmination or release around ${h.area}.`;
      break;
    case 'solar-eclipse':
      text = `This solar eclipse at ${at} falls in ${where}; astrologers read eclipses as turning points that open a new chapter around ${h.area}.`;
      break;
    case 'lunar-eclipse':
      text = `This lunar eclipse at ${at} falls in ${where}; astrologers read lunar eclipses as culminations that bring matters of ${h.area} to light.`;
      break;
    case 'aspect': {
      const house2 = lon2 !== undefined ? houseOf(lon2, natal.cusps) : house;
      const also = house2 !== house ? ` and ${HOUSE_THEMES[house2 - 1].area}` : '';
      text = `The exact ${body}–${name(event.body2!)} ${event.aspect} falls in ${where}${house2 !== house ? ` and your ${ordinal(house2)} (${HOUSE_THEMES[house2 - 1].name})` : ''}: it traditionally ${ASPECT_WORLD_VERBS[event.aspect!]} ${body} and ${name(event.body2!)} in matters of ${h.area}${also}.`;
      break;
    }
  }
  if (contacts.length) {
    const list = contacts.slice(0, 3).map((c) => `${name(c.point)} (${c.aspect}, ${c.orb.toFixed(1)}°)`).join(', ');
    text += ` It closely contacts your natal ${list}, which traditionally makes it more personally significant.`;
  }
  return { house, houseTheme: h.line, contacts, text };
}

