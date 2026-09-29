/**
 * Western astrology computed from the real ephemeris (astronomy-engine).
 *
 * Positions are geocentric apparent ecliptic longitudes referred to the TRUE
 * equinox and ecliptic of date (light-time, aberration, precession and
 * nutation applied) — the convention of astrological ephemerides and of JPL
 * Horizons' "ObsEcLon". Sidereal positions subtract the true ayanamsa (mean
 * ayanamsa + nutation in longitude), as the Swiss Ephemeris does.
 *
 * Pure TypeScript: no DOM, no three.js.
 */
import * as A from 'astronomy-engine';
import { ayanamsaValue } from './ayanamsa';
import { SIGNS } from './correspondences';
import type {
  Aspect, AspectType, Ayanamsa, Chart, ChartPoint, HouseSystem, PlanetaryHour, PointId, ZodiacMode,
} from './types';

export { ayanamsaValue };

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export const norm360 = (x: number): number => ((x % 360) + 360) % 360;
/** Wrap to [-180, 180). */
export const norm180 = (x: number): number => norm360(x + 180) - 180;

export const PLANET_IDS = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'] as const;
export type PlanetId = (typeof PLANET_IDS)[number];

const BODY: Record<PlanetId, A.Body> = {
  Sun: A.Body.Sun, Moon: A.Body.Moon, Mercury: A.Body.Mercury, Venus: A.Body.Venus, Mars: A.Body.Mars,
  Jupiter: A.Body.Jupiter, Saturn: A.Body.Saturn, Uranus: A.Body.Uranus, Neptune: A.Body.Neptune, Pluto: A.Body.Pluto,
};

/** Default orbs (degrees); the Sun and Moon get +2° (LUMINARY_BONUS). */
export const DEFAULT_ORBS: Record<AspectType, number> = { conjunction: 8, opposition: 8, trine: 7, square: 7, sextile: 5 };
const LUMINARY_BONUS = 2;
const ASPECT_ANGLES: [AspectType, number][] = [['conjunction', 0], ['sextile', 60], ['square', 90], ['trine', 120], ['opposition', 180]];

// ---------------------------------------------------------------------------
// Ephemeris
// ---------------------------------------------------------------------------

export interface EclipticPosition {
  /** Tropical longitude, true equinox of date, degrees [0, 360). */
  lon: number;
  lat: number;
  /** Apparent geocentric vector in EQJ (J2000 mean equator), AU. */
  eqj: A.Vector;
}

/** Geocentric apparent ecliptic position of a body, true ecliptic and equinox of date. */
export function eclipticOfDate(id: PlanetId, date: Date | A.AstroTime): EclipticPosition {
  const t = A.MakeTime(date);
  const eqj = A.GeoVector(BODY[id], t, true);
  const s = A.SphereFromVector(A.RotateVector(A.Rotation_EQJ_ECT(t), eqj));
  return { lon: norm360(s.lon), lat: s.lat, eqj };
}

/**
 * Mean lunar node (ascending), true equinox of date: Chapront et al. / Meeus
 * (Astronomical Algorithms 2nd ed., eq. 47.7) plus nutation in longitude.
 */
export function meanNodeLongitude(date: Date | A.AstroTime): number {
  const t = A.MakeTime(date);
  const T = t.tt / 36525;
  const om = 125.0445479 - 1934.1362891 * T + 0.0020754 * T * T + (T * T * T) / 467441 - (T * T * T * T) / 60616000;
  return norm360(om + A.e_tilt(t).dpsi / 3600);
}

/** True ayanamsa (mean ayanamsa + nutation in longitude), degrees. */
export function trueAyanamsa(date: Date | A.AstroTime, kind: Ayanamsa): number {
  const t = A.MakeTime(date);
  return ayanamsaValue(t.date, kind) + A.e_tilt(t).dpsi / 3600;
}

/**
 * Longitude of a planet (or the mean North Node) in the chosen zodiac.
 * Used by the event search as well as the chart.
 */
export function zodiacLongitude(id: PlanetId | 'NorthNode', date: Date | A.AstroTime, zodiac: ZodiacMode = 'tropical', ayanamsa: Ayanamsa = 'lahiri'): number {
  const t = A.MakeTime(date);
  const lon = id === 'NorthNode' ? meanNodeLongitude(t) : eclipticOfDate(id, t).lon;
  return zodiac === 'sidereal' ? norm360(lon - trueAyanamsa(t, ayanamsa)) : lon;
}

// ---------------------------------------------------------------------------
// Angles and houses
// ---------------------------------------------------------------------------

export interface Angles {
  /** Right ascension of the MC (local apparent sidereal time), degrees. */
  armc: number;
  /** True obliquity, degrees. */
  obliquity: number;
  /** Tropical longitudes, degrees. */
  ascendant: number;
  midheaven: number;
}

/**
 * Ascendant and Midheaven. The MC is the ecliptic point on the upper meridian
 * (RA = local apparent sidereal time). The Ascendant is the intersection of
 * the ecliptic with the horizon on the EAST side, found as the cross product
 * of the ecliptic pole and the zenith, so no quadrant ambiguity arises at any
 * latitude.
 */
export function computeAngles(date: Date | A.AstroTime, lat: number, lon: number): Angles {
  const t = A.MakeTime(date);
  const eps = A.e_tilt(t).tobl;
  const armc = norm360(A.SiderealTime(t) * 15 + lon);
  const e = eps * DEG, th = armc * DEG, ph = lat * DEG;
  const mc = norm360(Math.atan2(Math.sin(th), Math.cos(th) * Math.cos(e)) * RAD);
  // Equator-of-date frame: x → equinox, z → celestial pole.
  const Z = [Math.cos(ph) * Math.cos(th), Math.cos(ph) * Math.sin(th), Math.sin(ph)];
  const E = [-Math.sin(th), Math.cos(th), 0];
  const P = [0, -Math.sin(e), Math.cos(e)];
  let D = [P[1] * Z[2] - P[2] * Z[1], P[2] * Z[0] - P[0] * Z[2], P[0] * Z[1] - P[1] * Z[0]];
  if (D[0] * E[0] + D[1] * E[1] + D[2] * E[2] < 0) D = D.map((x) => -x);
  const asc = norm360(Math.atan2(D[1] * Math.cos(e) + D[2] * Math.sin(e), D[0]) * RAD);
  return { armc, obliquity: eps, ascendant: asc, midheaven: mc };
}

/** Ecliptic longitude of the point of the ecliptic with right ascension `ra` (degrees). */
function eclipticFromRA(ra: number, eps: number): number {
  return norm360(Math.atan2(Math.sin(ra * DEG), Math.cos(ra * DEG) * Math.cos(eps * DEG)) * RAD);
}

/**
 * Placidus cusps by the semi-arc method: cusp 11/12 are the ecliptic points
 * whose hour angle east of the meridian is 1/3 and 2/3 of their own diurnal
 * semi-arc; cusps 3/2 lie 1/3 and 2/3 of their nocturnal semi-arc from the IC.
 * Returns null where Placidus is undefined (|lat| ≥ 90° − ε).
 */
export function placidusCusps(armc: number, lat: number, eps: number, asc: number, mc: number): number[] | null {
  if (Math.abs(lat) >= 90 - eps) return null;
  const tanPhi = Math.tan(lat * DEG);
  const sinE = Math.sin(eps * DEG);
  const cusp = (f: number, above: boolean): number | null => {
    let ra = above ? armc + f * 90 : armc + 180 - f * 90;
    for (let i = 0; i < 200; i++) {
      const lam = eclipticFromRA(ra, eps);
      const dec = Math.asin(sinE * Math.sin(lam * DEG));
      const x = tanPhi * Math.tan(dec);
      if (Math.abs(x) >= 1) return null;
      const ad = Math.asin(x) * RAD;
      const next = above ? armc + f * (90 + ad) : armc + 180 - f * (90 - ad);
      if (Math.abs(norm180(next - ra)) < 1e-10) { ra = next; break; }
      ra = next;
    }
    return eclipticFromRA(ra, eps);
  };
  const c11 = cusp(1 / 3, true), c12 = cusp(2 / 3, true), c2 = cusp(2 / 3, false), c3 = cusp(1 / 3, false);
  if (c11 === null || c12 === null || c2 === null || c3 === null) return null;
  return [asc, c2, c3, norm360(mc + 180), norm360(c11 + 180), norm360(c12 + 180),
    norm360(asc + 180), norm360(c2 + 180), norm360(c3 + 180), mc, c11, c12];
}

/** Porphyry cusps: each quadrant between the angles trisected along the ecliptic. */
export function porphyryCusps(asc: number, mc: number): number[] {
  const ic = norm360(mc + 180);
  const q1 = norm360(asc - mc) / 3; // MC → ASC (houses 10, 11, 12)
  const q2 = norm360(ic - asc) / 3; // ASC → IC (houses 1, 2, 3)
  const c11 = norm360(mc + q1), c12 = norm360(mc + 2 * q1), c2 = norm360(asc + q2), c3 = norm360(asc + 2 * q2);
  return [asc, c2, c3, ic, norm360(c11 + 180), norm360(c12 + 180),
    norm360(asc + 180), norm360(c2 + 180), norm360(c3 + 180), mc, c11, c12];
}

/** House number 1..12 of a longitude, for cusps in the same zodiac. */
export function houseOf(lon: number, cusps: number[]): number {
  for (let i = 0; i < 12; i++) {
    const span = norm360(cusps[(i + 1) % 12] - cusps[i]);
    if (norm360(lon - cusps[i]) < span) return i + 1;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Signs and formatting
// ---------------------------------------------------------------------------

export function zodiacSignOf(longitude: number): { sign: number; degree: number; name: string; glyph: string } {
  const l = norm360(longitude);
  const sign = Math.min(11, Math.floor(l / 30));
  return { sign, degree: l - sign * 30, name: SIGNS[sign].name, glyph: SIGNS[sign].glyph };
}

/** "14°22′ ♍︎" — degrees and arc-minutes within the sign (truncated, never 30°00′). */
export function formatLongitude(lon: number): string {
  const totalMin = Math.floor(norm360(lon) * 60 + 1e-7);
  const sign = Math.floor(totalMin / 1800) % 12;
  const within = totalMin % 1800;
  const d = Math.floor(within / 60), m = within % 60;
  return `${d}°${String(m).padStart(2, '0')}′ ${SIGNS[sign].glyph}`;
}

// ---------------------------------------------------------------------------
// Aspects
// ---------------------------------------------------------------------------

interface AspectBody { id: PointId; lon: number; speed: number }

const isLuminary = (id: PointId) => id === 'Sun' || id === 'Moon';
const isNode = (id: PointId) => id === 'NorthNode' || id === 'SouthNode';
const isAngle = (id: PointId) => id === 'Ascendant' || id === 'Midheaven';

/** Best-fitting aspect between two bodies within the orbs, or null. */
export function aspectBetween(a: AspectBody, b: AspectBody, orbs: Record<AspectType, number>, allowed: AspectType[], bonus = 0): Aspect | null {
  const d = norm180(b.lon - a.lon);
  const sep = Math.abs(d);
  let best: Aspect | null = null;
  for (const [type, angle] of ASPECT_ANGLES) {
    if (!allowed.includes(type)) continue;
    const orb = Math.abs(sep - angle);
    if (orb > orbs[type] + bonus) continue;
    if (best && orb >= best.orb) continue;
    // Rate of change of the separation, then of the orb.
    const dSep = (d >= 0 ? 1 : -1) * (b.speed - a.speed);
    const dOrb = Math.sign(sep - angle) * dSep;
    best = { a: a.id, b: b.id, type, angle, orb, applying: dOrb < 0 };
  }
  return best;
}

function chartAspects(points: ChartPoint[], orbs: Record<AspectType, number>): Aspect[] {
  const out: Aspect[] = [];
  const all: AspectType[] = ASPECT_ANGLES.map(([t]) => t);
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const p = points[i], q = points[j];
      if (isNode(p.id) && isNode(q.id)) continue;
      if (isAngle(p.id) && isAngle(q.id)) continue;
      const allowed: AspectType[] = isNode(p.id) || isNode(q.id) ? ['conjunction'] : all;
      const bonus = isLuminary(p.id) || isLuminary(q.id) ? LUMINARY_BONUS : 0;
      const asp = aspectBetween({ id: p.id, lon: p.longitude, speed: p.speed }, { id: q.id, lon: q.longitude, speed: q.speed }, orbs, allowed, bonus);
      if (asp) out.push(asp);
    }
  }
  return out.sort((x, y) => x.orb - y.orb);
}

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

export interface ChartOptions {
  date: Date;
  lat: number;
  lon: number;
  zodiac?: ZodiacMode;
  ayanamsa?: Ayanamsa;
  houseSystem?: HouseSystem;
  orbs?: Partial<Record<AspectType, number>>;
}

export function computeChart(opts: ChartOptions): Chart {
  const { date, lat, lon } = opts;
  const zodiac = opts.zodiac ?? 'tropical';
  const ayanamsaKind = opts.ayanamsa ?? 'lahiri';
  const houseSystem = opts.houseSystem ?? 'placidus';
  const orbs: Record<AspectType, number> = { ...DEFAULT_ORBS, ...opts.orbs };
  const t = A.MakeTime(date);
  const ayan = zodiac === 'sidereal' ? trueAyanamsa(t, ayanamsaKind) : 0;
  const shift = (l: number) => norm360(l - ayan);

  // Planets: position now, speed by central difference over ±0.5 day.
  const tBefore = t.AddDays(-0.5), tAfter = t.AddDays(0.5);
  const raw: { id: PointId; lon: number; lat: number; speed: number; constellation?: string }[] = [];
  for (const id of PLANET_IDS) {
    const pos = eclipticOfDate(id, t);
    const speed = norm180(eclipticOfDate(id, tAfter).lon - eclipticOfDate(id, tBefore).lon);
    const eq = A.EquatorFromVector(pos.eqj);
    raw.push({ id, lon: pos.lon, lat: pos.lat, speed, constellation: A.Constellation(eq.ra, eq.dec).symbol });
  }
  const node = meanNodeLongitude(t);
  const nodeSpeed = norm180(meanNodeLongitude(tAfter) - meanNodeLongitude(tBefore));
  raw.push({ id: 'NorthNode', lon: node, lat: 0, speed: nodeSpeed });
  raw.push({ id: 'SouthNode', lon: norm360(node + 180), lat: 0, speed: nodeSpeed });

  // Angles: speed by central difference over ±1 minute.
  const ang = computeAngles(t, lat, lon);
  const dt = 1 / 1440;
  const a0 = computeAngles(t.AddDays(-dt), lat, lon), a1 = computeAngles(t.AddDays(dt), lat, lon);
  raw.push({ id: 'Ascendant', lon: ang.ascendant, lat: 0, speed: norm180(a1.ascendant - a0.ascendant) / (2 * dt) });
  raw.push({ id: 'Midheaven', lon: ang.midheaven, lat: 0, speed: norm180(a1.midheaven - a0.midheaven) / (2 * dt) });

  // Houses (computed tropically, then shifted; whole-sign uses the shifted Ascendant).
  let cusps: number[];
  let housesFallback: 'porphyry' | undefined;
  const asc = shift(ang.ascendant), mc = shift(ang.midheaven);
  if (houseSystem === 'placidus') {
    const pl = placidusCusps(ang.armc, lat, ang.obliquity, ang.ascendant, ang.midheaven);
    if (pl) cusps = pl.map(shift);
    else { cusps = porphyryCusps(asc, mc); housesFallback = 'porphyry'; }
  } else if (houseSystem === 'equal') {
    cusps = Array.from({ length: 12 }, (_, i) => norm360(asc + 30 * i));
  } else {
    const first = Math.floor(asc / 30) * 30;
    cusps = Array.from({ length: 12 }, (_, i) => norm360(first + 30 * i));
  }

  const points: ChartPoint[] = raw.map((r) => {
    const l = shift(r.lon);
    const { sign, degree } = zodiacSignOf(l);
    const angle = isAngle(r.id);
    let house = houseOf(l, cusps);
    if (r.id === 'Ascendant') house = 1;
    else if (r.id === 'Midheaven' && houseSystem !== 'whole-sign') house = 10;
    const p: ChartPoint = { id: r.id, longitude: l, latitude: r.lat, speed: r.speed, retrograde: !angle && r.speed < 0, sign, degree, house };
    if (r.constellation) p.constellation = r.constellation;
    return p;
  });

  const observer = new A.Observer(lat, lon, 0);
  const sunEq = A.Equator(A.Body.Sun, t, observer, true, true);
  const sunAlt = A.Horizon(t, observer, sunEq.ra, sunEq.dec).altitude;

  const chart: Chart = {
    date, lat, lon, zodiac, ayanamsa: ayan, houseSystem, points, cusps,
    aspects: chartAspects(points, orbs),
    isDayChart: sunAlt > 0,
    moonPhase: A.MoonPhase(t),
    planetaryHour: planetaryHour(date, lat, lon),
    obliquity: ang.obliquity,
    ayanamsaKind,
  };
  if (housesFallback) chart.housesFallback = housesFallback;
  return chart;
}

// ---------------------------------------------------------------------------
// Planetary hours
// ---------------------------------------------------------------------------

/** Chaldean order, slowest to fastest. */
export const CHALDEAN_ORDER: PointId[] = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'];
/** Day rulers, Sunday = 0. */
export const WEEKDAY_RULERS: PointId[] = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];

/**
 * Traditional unequal planetary hours: sunrise→sunset and sunset→next sunrise
 * are each divided into twelve. The day belongs to the ruler of its weekday
 * (taken at local mean time of sunrise); the hours follow the Chaldean order
 * from it, and the night continues the sequence. Returns null where the Sun
 * does not rise and set within a day (polar day/night).
 */
export function planetaryHour(date: Date, lat: number, lon: number): PlanetaryHour | null {
  const obs = new A.Observer(lat, lon, 0);
  const rise0 = A.SearchRiseSet(A.Body.Sun, obs, +1, date, -1.5);
  if (!rise0) return null;
  const set0 = A.SearchRiseSet(A.Body.Sun, obs, -1, rise0, 1.2);
  if (!set0) return null;
  const rise1 = A.SearchRiseSet(A.Body.Sun, obs, +1, set0, 1.2);
  if (!rise1) return null;
  const t = date.getTime();
  const r0 = rise0.date.getTime(), s0 = set0.date.getTime(), r1 = rise1.date.getTime();
  if (t < r0 || t >= r1) return null;
  const isDay = t < s0;
  const start = isDay ? r0 : s0, end = isDay ? s0 : r1;
  const len = (end - start) / 12;
  const index = Math.min(12, Math.floor((t - start) / len) + 1);
  const weekday = new Date(r0 + (lon / 15) * 3600e3).getUTCDay();
  const dayRuler = WEEKDAY_RULERS[weekday];
  const n = (isDay ? 0 : 12) + index - 1;
  const ruler = CHALDEAN_ORDER[(CHALDEAN_ORDER.indexOf(dayRuler) + n) % 7];
  return { ruler, dayRuler, index, isDay, start: new Date(start + (index - 1) * len), end: new Date(start + index * len) };
}

// ---------------------------------------------------------------------------
// Signs versus the real constellations
// ---------------------------------------------------------------------------

/**
 * Segments of the true ecliptic of date, by tropical longitude, grouped by
 * the IAU constellation they physically pass through (13, including
 * Ophiuchus). Sampled every 0.1° and refined by bisection to ~0.001°.
 * `start` is in [0, 360); `end = start + width` and may exceed 360 for the
 * segment that straddles 0° (so test `norm360(lon - start) < end - start`).
 */
export function eclipticConstellations(date: Date): { id: string; start: number; end: number }[] {
  const t = A.MakeTime(date);
  const rot = A.Rotation_ECT_EQJ(t);
  const at = (lon: number): string => {
    const v = A.RotateVector(rot, A.VectorFromSphere(new A.Spherical(0, lon, 1), t));
    const eq = A.EquatorFromVector(v);
    return A.Constellation(eq.ra, eq.dec).symbol;
  };
  const N = 3600;
  const ids: string[] = [];
  for (let i = 0; i < N; i++) ids.push(at(i * 0.1));
  const boundaries: { lon: number; id: string }[] = [];
  for (let i = 0; i < N; i++) {
    const prev = ids[(i + N - 1) % N];
    if (ids[i] === prev) continue;
    let lo = (i - 1) * 0.1, hi = i * 0.1;
    for (let k = 0; k < 17; k++) {
      const mid = (lo + hi) / 2;
      if (at(norm360(mid)) === prev) lo = mid; else hi = mid;
    }
    boundaries.push({ lon: norm360(hi), id: ids[i] });
  }
  if (!boundaries.length) return [{ id: ids[0], start: 0, end: 360 }];
  return boundaries.map((b, i) => {
    const next = boundaries[(i + 1) % boundaries.length];
    const width = norm360(next.lon - b.lon) || 360;
    return { id: b.id, start: b.lon, end: b.lon + width };
  });
}

// ---------------------------------------------------------------------------
// Transits
// ---------------------------------------------------------------------------

/** Orbs for transits to a natal chart (degrees). */
export const TRANSIT_ORBS: Partial<Record<PointId, number>> = {
  Sun: 2, Moon: 2, Mercury: 1.5, Venus: 1.5, Mars: 1.5, Jupiter: 1, Saturn: 1, Uranus: 1, Neptune: 1, Pluto: 1,
};

/**
 * Aspects from the planets at `date` (Aspect.a, the transiting body) to the
 * natal chart's points (Aspect.b: planets, nodes and angles). Nodes take
 * conjunctions only. `applying` treats natal points as fixed.
 */
export function transitsToChart(natal: Chart, date: Date): Aspect[] {
  const now = computeChart({
    date, lat: natal.lat, lon: natal.lon, zodiac: natal.zodiac, ayanamsa: natal.ayanamsaKind ?? 'lahiri', houseSystem: natal.houseSystem,
  });
  const all: AspectType[] = ASPECT_ANGLES.map(([x]) => x);
  const out: Aspect[] = [];
  for (const tp of now.points) {
    const orb = TRANSIT_ORBS[tp.id];
    if (orb === undefined) continue;
    const orbs: Record<AspectType, number> = { conjunction: orb, sextile: orb, square: orb, trine: orb, opposition: orb };
    for (const np of natal.points) {
      const allowed = isNode(np.id) ? (['conjunction'] as AspectType[]) : all;
      const asp = aspectBetween({ id: tp.id, lon: tp.longitude, speed: tp.speed }, { id: np.id, lon: np.longitude, speed: 0 }, orbs, allowed);
      if (asp) out.push(asp);
    }
  }
  return out.sort((x, y) => x.orb - y.orb);
}
