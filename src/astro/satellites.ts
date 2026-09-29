/**
 * Artificial satellites: TLE parsing, SGP4 look angles, Earth-shadow tests,
 * pass prediction and visual magnitude estimates.
 *
 * Satellite positions come from satellite.js (SGP4, TEME frame). The Sun comes
 * from astronomy-engine (J2000 frame); the ~0.4° frame difference is
 * negligible for shadow and phase-angle purposes.
 */
import {
  checkForDecay,
  constants,
  degreesLat,
  degreesLong,
  degreesToRadians,
  ecfToEci,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  geodeticToEcf,
  gstime,
  radiansToDegrees,
  sgp4,
  shadowFraction,
  twoline2satrec,
  type EcfVec3,
  type EciVec3,
  type GeodeticLocation,
  type SatRec,
} from 'satellite.js';
import { Body, Equator, GeoVector, Horizon, Observer as AstroObserver } from 'astronomy-engine';

/** Observer position: WGS84 latitude/longitude in degrees, elevation in metres. */
export interface ObserverLocation {
  lat: number;
  lon: number;
  elevation: number;
}

export interface SatelliteEntry {
  /** Short display name, e.g. "ISS". */
  name: string;
  /** Name as given in the TLE file, e.g. "ISS (ZARYA)". */
  fullName: string;
  noradId: number;
  satrec: SatRec;
  /** Element-set epoch. */
  epoch: Date;
  /** International designator, e.g. "1998-067A". */
  intlDes?: string;
  /** ISS, Tiangong and Hubble. */
  featured: boolean;
  /** Intrinsic magnitude at 1000 km range and 90° phase angle. */
  stdMag: number;
}

export interface SatLook {
  /** Azimuth in degrees, from north through east. */
  az: number;
  /** Altitude above the horizon in degrees. */
  alt: number;
  rangeKm: number;
  /** Height above the WGS84 ellipsoid. */
  altitudeKm: number;
  velocityKmS: number;
  /** True when the satellite is outside the Earth's shadow. */
  sunlit: boolean;
  /** Estimated visual magnitude if sunlit (range and phase-angle model). */
  mag: number;
  /** Sub-satellite latitude in degrees. */
  lat: number;
  /** Sub-satellite longitude in degrees (−180…180). */
  lon: number;
}

export interface SatPoint {
  time: Date;
  az: number;
  alt: number;
}

export interface TrackPoint extends SatPoint {
  sunlit: boolean;
}

export interface SatPass {
  rise: SatPoint;
  culmination: SatPoint;
  set: SatPoint;
  maxAlt: number;
  /** Some part of the pass is sunlit while the observer is in darkness. */
  visible: boolean;
  /** First visible moment (only when `visible`). */
  visibleStart?: SatPoint;
  /** Last visible moment (only when `visible`). */
  visibleEnd?: SatPoint;
  /** Brightest estimated magnitude while visible, or at culmination when not visible. */
  peakMag: number;
  durationSec: number;
}

/** Featured satellites in display order, with display names and standard magnitudes. */
const FEATURED: ReadonlyMap<number, { name: string; stdMag: number }> = new Map([
  [25544, { name: 'ISS', stdMag: -1.8 }],
  [48274, { name: 'Tiangong', stdMag: -1.0 }],
  [20580, { name: 'Hubble', stdMag: 2.2 }],
]);
const FEATURED_ORDER = [...FEATURED.keys()];
const DEFAULT_STD_MAG = 4.0;

const MS_PER_DAY = 86_400_000;
const JD_UNIX_EPOCH = 2_440_587.5;
const KM_PER_AU = 149_597_870.7;
const { earthRadius } = constants;

// ---------------------------------------------------------------------------
// TLE parsing
// ---------------------------------------------------------------------------

/** Parse 3-line (or bare 2-line) TLE text. Duplicates keep the newest epoch; featured satellites come first. */
export function parseTLE(text: string): SatelliteEntry[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const entries: SatelliteEntry[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const l1 = lines[i];
    const l2 = lines[i + 1];
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    const prev = i > 0 ? lines[i - 1].trim() : '';
    const name = prev && !/^[12] /.test(prev) ? prev.replace(/\s+/g, ' ') : '';
    const entry = makeEntry(name, l1, l2);
    if (entry) entries.push(entry);
    i++;
  }
  return finalize(entries);
}

/** Merge two catalogues, keeping the newer element set per NORAD id (ties go to `live`). */
export function mergeTLE(bundled: SatelliteEntry[], live: SatelliteEntry[]): SatelliteEntry[] {
  return finalize([...bundled, ...live]);
}

function makeEntry(fullName: string, line1: string, line2: string): SatelliteEntry | null {
  let satrec: SatRec;
  try {
    satrec = twoline2satrec(line1, line2);
  } catch {
    return null;
  }
  const noradId = Number.parseInt(line1.slice(2, 7), 10);
  if (satrec.error !== 0 || !Number.isFinite(noradId)) return null;
  const featured = FEATURED.get(noradId);
  const full = fullName || `NORAD ${noradId}`;
  return {
    name: featured?.name ?? full,
    fullName: full,
    noradId,
    satrec,
    epoch: new Date((satrec.jdsatepoch - JD_UNIX_EPOCH) * MS_PER_DAY),
    intlDes: parseIntlDes(line1.slice(9, 17)),
    featured: featured !== undefined,
    stdMag: featured?.stdMag ?? DEFAULT_STD_MAG,
  };
}

/** "98067A" → "1998-067A". */
function parseIntlDes(field: string): string | undefined {
  const m = /^(\d{2})(\d{3})(\w*)$/.exec(field.trim());
  if (!m) return undefined;
  const yy = Number(m[1]);
  return `${yy < 57 ? 2000 + yy : 1900 + yy}-${m[2]}${m[3]}`;
}

/** Dedupe by NORAD id (newest epoch wins) and move featured satellites to the front. */
function finalize(entries: SatelliteEntry[]): SatelliteEntry[] {
  const byId = new Map<number, SatelliteEntry>();
  for (const e of entries) {
    const cur = byId.get(e.noradId);
    if (!cur || e.epoch.getTime() >= cur.epoch.getTime()) byId.set(e.noradId, e);
  }
  const all = [...byId.values()];
  const featured = FEATURED_ORDER.flatMap((id) => byId.get(id) ?? []);
  return [...featured, ...all.filter((e) => !e.featured)];
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Site {
  geo: GeodeticLocation;
  ecf: EcfVec3<number>;
}

interface Look {
  az: number;
  alt: number;
  rangeKm: number;
  eci: EciVec3<number>;
  vel: EciVec3<number>;
  gmst: number;
}

function toSite(o: ObserverLocation): Site {
  const geo = {
    latitude: degreesToRadians(o.lat),
    longitude: degreesToRadians(o.lon),
    height: o.elevation / 1000,
  };
  return { geo, ecf: geodeticToEcf(geo) };
}

/** SGP4 state and topocentric look angles at `ms` (Unix ms), or null if propagation fails. */
function lookAt(sat: SatelliteEntry, site: Site, ms: number): Look | null {
  const jd = ms / MS_PER_DAY + JD_UNIX_EPOCH;
  const pv = sgp4(sat.satrec, (jd - sat.satrec.jdsatepoch) * 1440);
  if (!pv || checkForDecay(sat.satrec)) return null;
  const gmst = gstime(jd);
  const la = ecfToLookAngles(site.geo, eciToEcf(pv.position, gmst));
  return {
    az: radiansToDegrees(la.azimuth),
    alt: radiansToDegrees(la.elevation),
    rangeKm: la.rangeSat,
    eci: pv.position,
    vel: pv.velocity,
    gmst,
  };
}

let sunCacheKey = Number.NaN;
let sunCacheAU: EciVec3<number> = { x: 1, y: 0, z: 0 };

/** Geocentric Sun vector in AU, cached per minute (the Sun moves ~0.0007° in that time). */
function sunAU(ms: number): EciVec3<number> {
  const key = Math.round(ms / 60_000);
  if (key !== sunCacheKey) {
    const v = GeoVector(Body.Sun, new Date(key * 60_000), false);
    sunCacheAU = { x: v.x, y: v.y, z: v.z };
    sunCacheKey = key;
  }
  return sunCacheAU;
}

/** Conical Earth-shadow test: sunlit unless at least half the solar disc is hidden. */
function isSunlit(eci: EciVec3<number>, ms: number): boolean {
  return shadowFraction(sunAU(ms), eci) < 0.5;
}

/**
 * Estimated visual magnitude: standard magnitude scaled for range and for a
 * diffuse-sphere phase law (0 correction at 90° phase angle).
 */
function magnitude(sat: SatelliteEntry, site: Site, look: Look, ms: number): number {
  const sun = sunAU(ms);
  const obs = ecfToEci(site.ecf, look.gmst);
  const s = { x: sun.x * KM_PER_AU - look.eci.x, y: sun.y * KM_PER_AU - look.eci.y, z: sun.z * KM_PER_AU - look.eci.z };
  const o = { x: obs.x - look.eci.x, y: obs.y - look.eci.y, z: obs.z - look.eci.z };
  const cos = (s.x * o.x + s.y * o.y + s.z * o.z) / (Math.hypot(s.x, s.y, s.z) * Math.hypot(o.x, o.y, o.z));
  const phase = Math.acos(Math.min(1, Math.max(-1, cos)));
  const phaseTerm = Math.max(1e-3, Math.sin(phase) + (Math.PI - phase) * Math.cos(phase));
  return sat.stdMag + 5 * Math.log10(look.rangeKm / 1000) - 2.5 * Math.log10(phaseTerm);
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

/** Where the satellite is in the observer's sky at `date`; null if propagation fails (decayed or invalid). */
export function satelliteLook(entry: SatelliteEntry, date: Date, observer: ObserverLocation): SatLook | null {
  const ms = date.getTime();
  const site = toSite(observer);
  const look = lookAt(entry, site, ms);
  if (!look) return null;
  const geo = eciToGeodetic(look.eci, look.gmst);
  return {
    az: look.az,
    alt: look.alt,
    rangeKm: look.rangeKm,
    altitudeKm: geo.height,
    velocityKmS: Math.hypot(look.vel.x, look.vel.y, look.vel.z),
    sunlit: isSunlit(look.eci, ms),
    mag: magnitude(entry, site, look, ms),
    lat: degreesLat(geo.latitude),
    lon: degreesLong(geo.longitude),
  };
}

/** True when the Sun is more than 6° below the horizon (civil twilight has ended). */
export function observerInDarkness(date: Date, observer: ObserverLocation): boolean {
  const obs = new AstroObserver(observer.lat, observer.lon, observer.elevation);
  const eq = Equator(Body.Sun, date, obs, true, true);
  return Horizon(date, obs, eq.ra, eq.dec).altitude < -6;
}

const COARSE_STEP_MS = 30_000;
const VIS_STEP_MS = 10_000;
const REFINE_MS = 1_000;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

/**
 * Passes above the horizon starting within `days` of `start` whose maximum
 * altitude reaches `minAlt` degrees. A pass already in progress at `start`
 * rises at `start`; a pass in progress at the end of the window runs to its set.
 */
export function predictPasses(
  entry: SatelliteEntry,
  observer: ObserverLocation,
  start: Date,
  days = 5,
  minAlt = 10,
): SatPass[] {
  const site = toSite(observer);
  const alt = (ms: number) => lookAt(entry, site, ms)?.alt ?? Number.NaN;
  const above = (ms: number) => alt(ms) > 0;
  const skip = horizonSkip(entry, site);
  const t0 = start.getTime();
  const tEnd = t0 + days * MS_PER_DAY;
  const tHardEnd = tEnd + MS_PER_DAY;
  const passes: SatPass[] = [];

  let riseT: number | null = null;
  let bestT = t0;
  let bestAlt = -90;
  let prevT = t0;
  for (let t = t0; riseT === null ? t <= tEnd : t <= tHardEnd; ) {
    const look = lookAt(entry, site, t);
    if (!look) break;
    if (riseT === null) {
      if (look.alt > 0) {
        riseT = t === t0 ? t0 : bisect(prevT, t, above);
        bestT = t;
        bestAlt = look.alt;
      }
    } else {
      if (look.alt > bestAlt) {
        bestT = t;
        bestAlt = look.alt;
      }
      if (look.alt <= 0) {
        const setT = bisect(prevT, t, above);
        const culmT = goldenMax(Math.max(riseT, bestT - COARSE_STEP_MS), Math.min(setT, bestT + COARSE_STEP_MS), alt);
        const pass = buildPass(entry, site, observer, riseT, culmT, setT, minAlt);
        if (pass) passes.push(pass);
        riseT = null;
      }
    }
    prevT = t;
    t += riseT === null ? skip(look) : COARSE_STEP_MS;
  }
  return passes;
}

/**
 * Returns how far (a multiple of the coarse step) the scan can safely jump
 * while the satellite is below the horizon. The satellite can only rise once
 * its geocentric angle from the observer drops below the horizon limit
 * acos(R⊕ / r_apogee), and that angle shrinks no faster than the orbital
 * angular rate at perigee plus Earth's rotation.
 */
function horizonSkip(entry: SatelliteEntry, site: Site): (look: Look) => number {
  const { no, ecco, alta } = entry.satrec;
  const polarRadiusKm = 6356.75;
  const limit = Math.acos(polarRadiusKm / ((1 + alta) * earthRadius)) + degreesToRadians(1);
  const earthRate = (2 * Math.PI) / 1436.07; // rad/min, sidereal
  const maxRate = 1.1 * (no * (1 + ecco) ** 2 / (1 - ecco * ecco) ** 1.5 + earthRate);
  return (look) => {
    const o = ecfToEci(site.ecf, look.gmst);
    const e = look.eci;
    const cos = (o.x * e.x + o.y * e.y + o.z * e.z) / (Math.hypot(o.x, o.y, o.z) * Math.hypot(e.x, e.y, e.z));
    const safeMs = ((Math.acos(Math.min(1, cos)) - limit) / maxRate) * 60_000;
    return Math.max(1, Math.floor(safeMs / COARSE_STEP_MS)) * COARSE_STEP_MS;
  };
}

/** Ground-relative sky path around `center`, for drawing a selected satellite's track. */
export function satelliteTrack(
  entry: SatelliteEntry,
  observer: ObserverLocation,
  center: Date,
  minutesBefore: number,
  minutesAfter: number,
  stepSec: number,
): TrackPoint[] {
  const site = toSite(observer);
  const stepMs = Math.max(1, stepSec) * 1000;
  const end = center.getTime() + minutesAfter * 60_000;
  const track: TrackPoint[] = [];
  for (let ms = center.getTime() - minutesBefore * 60_000; ms <= end; ms += stepMs) {
    const look = lookAt(entry, site, ms);
    if (look) track.push({ time: new Date(ms), az: look.az, alt: look.alt, sunlit: isSunlit(look.eci, ms) });
  }
  return track;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 16-point compass direction for an azimuth in degrees, e.g. 337.5 → "NNW". */
export function azimuthToCompass(az: number): string {
  return COMPASS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}

// ---------------------------------------------------------------------------
// Pass helpers
// ---------------------------------------------------------------------------

/** Time (±0.5 s) where `pred` flips between `a` and `b`, given pred(a) !== pred(b). */
function bisect(a: number, b: number, pred: (ms: number) => boolean): number {
  const atA = pred(a);
  while (b - a > REFINE_MS) {
    const mid = (a + b) / 2;
    if (pred(mid) === atA) a = mid;
    else b = mid;
  }
  return Math.round((a + b) / 2);
}

/** Golden-section search for the maximum of a unimodal `f` on [a, b]. */
function goldenMax(a: number, b: number, f: (ms: number) => number): number {
  let c = b - GOLDEN * (b - a);
  let d = a + GOLDEN * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (b - a > REFINE_MS) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - GOLDEN * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + GOLDEN * (b - a);
      fd = f(d);
    }
  }
  return Math.round((a + b) / 2);
}

function buildPass(
  entry: SatelliteEntry,
  site: Site,
  observer: ObserverLocation,
  riseT: number,
  culmT: number,
  setT: number,
  minAlt: number,
): SatPass | null {
  const culm = lookAt(entry, site, culmT);
  if (!culm || culm.alt < minAlt) return null;
  const point = (ms: number): SatPoint => {
    const l = lookAt(entry, site, ms);
    return { time: new Date(ms), az: l?.az ?? Number.NaN, alt: l?.alt ?? Number.NaN };
  };

  // Observer darkness changes slowly: evaluate it once per minute.
  const darkByMinute = new Map<number, boolean>();
  const dark = (ms: number) => {
    const key = Math.floor(ms / 60_000);
    let d = darkByMinute.get(key);
    if (d === undefined) darkByMinute.set(key, (d = observerInDarkness(new Date(ms), observer)));
    return d;
  };
  const visibleAt = (ms: number) => {
    const l = lookAt(entry, site, ms);
    return l !== null && dark(ms) && isSunlit(l.eci, ms);
  };

  let firstVis: number | null = null;
  let lastVis: number | null = null;
  let peakMag = Number.POSITIVE_INFINITY;
  // Twilight changes monotonically over a pass: skip sampling if it is light at both ends.
  if (dark(riseT) || dark(setT)) {
    let prev = riseT;
    for (let ms = riseT; ; ms = Math.min(ms + VIS_STEP_MS, setT)) {
      if (visibleAt(ms)) {
        if (firstVis === null) firstVis = ms === riseT ? ms : bisect(prev, ms, visibleAt);
        lastVis = ms;
        const l = lookAt(entry, site, ms);
        if (l) peakMag = Math.min(peakMag, magnitude(entry, site, l, ms));
      } else if (lastVis === prev) {
        lastVis = bisect(prev, ms, visibleAt);
      }
      if (ms >= setT) break;
      prev = ms;
    }
  }
  const visible = firstVis !== null && lastVis !== null;
  if (!visible || visibleAt(culmT)) peakMag = Math.min(peakMag, magnitude(entry, site, culm, culmT));

  return {
    rise: point(riseT),
    culmination: { time: new Date(culmT), az: culm.az, alt: culm.alt },
    set: point(setT),
    maxAlt: culm.alt,
    visible,
    ...(firstVis !== null && lastVis !== null ? { visibleStart: point(firstVis), visibleEnd: point(lastVis) } : {}),
    peakMag,
    durationSec: Math.round((setT - riseT) / 1000),
  };
}
