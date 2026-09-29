/**
 * Small solar-system bodies: comets (MPC CometEls.txt) and bright asteroids
 * (JPL SBDB osculating elements), propagated as two-body heliocentric orbits.
 *
 * Propagation uses the universal-variable form of Kepler's equation written
 * about perihelion with Stumpff functions, so elliptic, parabolic and
 * hyperbolic orbits share one well-conditioned solver (no singularity at e = 1).
 * Positions are heliocentric, equatorial J2000 (EQJ), in AU.
 */
import * as Astronomy from 'astronomy-engine';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Angular elements shared by all orbits (degrees, ecliptic & equinox J2000). */
interface OrbitAngles {
  /** Eccentricity. */
  e: number;
  /** Inclination. */
  i: number;
  /** Longitude of the ascending node Ω. */
  om: number;
  /** Argument of perihelion ω. */
  w: number;
}

export interface CometElements extends OrbitAngles {
  kind: 'comet';
  /** Packed MPC designation, unique within the file (e.g. "0002P", "CK25R020"). */
  id: string;
  /** Display name, e.g. "2P/Encke" or "C/2025 R2 (SWAN)". */
  name: string;
  /** MPC orbit type letter: C, P, D, X, A or I. */
  orbitType: string;
  /** Perihelion distance, AU. */
  q: number;
  /** Time of perihelion passage, JD (TT). */
  tp: number;
  /** Osculation epoch, JD (TT), or null when absent. */
  epoch: number | null;
  /** Total absolute magnitude (NaN when absent). */
  H: number;
  /** Activity slope n in m = H + 5 log Δ + 2.5 n log r. */
  G: number;
}

export interface AsteroidElements extends OrbitAngles {
  kind: 'asteroid';
  id: string;
  name: string;
  /** Minor-planet number. */
  number: number;
  /** Osculation epoch, JD (TDB). */
  epoch: number;
  /** Semi-major axis, AU. */
  a: number;
  /** Mean anomaly at epoch, degrees. */
  ma: number;
  /** Absolute magnitude H of the IAU H–G system. */
  H: number;
  /** Slope parameter G of the IAU H–G system. */
  G: number;
  /** Mean diameter, km, when known. */
  diameter: number | null;
}

export type SmallBodyElements = CometElements | AsteroidElements;

export interface SmallBodyState {
  /** Heliocentric position at the requested time, EQJ AU. */
  helio: Vec3;
  /** Observer-to-body vector (light-time corrected), EQJ AU. */
  geo: Vec3;
  /** Heliocentric distance at light-emission time, AU. */
  r: number;
  /** Observer distance, AU. */
  delta: number;
  /** Astrometric right ascension, J2000, hours. */
  ra: number;
  /** Astrometric declination, J2000, degrees. */
  dec: number;
  /** Predicted visual magnitude (NaN when H is unknown). */
  mag: number;
  /** Sun–observer–body angle, degrees. */
  elongation: number;
  /** Sun–body–observer angle, degrees. */
  phaseAngle: number;
  /** IAU constellation abbreviation, e.g. "Ori". */
  constellation: string;
  /** Unit vector pointing anti-sunward from the body, EQJ. */
  tailDir: Vec3;
  /** Rough visual tail length, AU (0 for asteroids and inactive comets). */
  tailLengthAU: number;
}

/** Gaussian gravitational constant k, AU^1.5 / day (√GM☉). */
export const GAUSS_K = 0.01720209895;
const JD_J2000 = 2451545.0;
const DEG = Math.PI / 180;
const DAYS_PER_YEAR = 365.25;

// ------------------------------------------------------------------ parsing

/** Julian Date of a (proleptic Gregorian) calendar date with fractional day. */
function julianDate(year: number, month: number, day: number): number {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
}

/** Parses a 1-based inclusive column range as a number (NaN when blank). */
function col(line: string, from: number, to: number): number {
  const s = line.slice(from - 1, to).trim();
  return s === '' ? NaN : Number(s);
}

/**
 * Parses the Minor Planet Center `CometEls.txt` fixed-width format.
 * Lines lacking a usable orbit are skipped; a blank slope defaults to 4.
 */
export function parseCometEls(text: string): CometElements[] {
  const out: CometElements[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length < 80) continue;
    const q = col(line, 31, 39);
    const e = col(line, 42, 49);
    const i = col(line, 72, 79);
    const om = col(line, 62, 69);
    const w = col(line, 52, 59);
    const [y, m, d] = [col(line, 15, 18), col(line, 20, 21), col(line, 23, 29)];
    if (![q, e, i, om, w, y, m, d].every(Number.isFinite) || q <= 0 || e < 0) continue;

    const ey = col(line, 82, 85);
    const epoch = Number.isFinite(ey) ? julianDate(ey, col(line, 86, 87), col(line, 88, 89)) : null;
    const packed = line.slice(0, 12).replace(/\s+/g, '');
    const G = col(line, 97, 100);
    out.push({
      kind: 'comet',
      id: packed,
      name: line.slice(102, 158).trim() || packed,
      orbitType: line.charAt(4),
      q,
      e,
      i,
      om,
      w,
      tp: julianDate(y, m, d),
      epoch,
      H: col(line, 92, 95),
      G: Number.isFinite(G) ? G : 4,
    });
  }
  return out;
}

/**
 * Validates asteroid elements as written by scripts/fetch-asteroids.mjs,
 * accepting either `{ bodies: [...] }` or a bare array. Invalid entries are dropped.
 */
export function parseAsteroids(json: unknown): AsteroidElements[] {
  const list = Array.isArray(json) ? json : (json as { bodies?: unknown })?.bodies;
  if (!Array.isArray(list)) return [];
  const out: AsteroidElements[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const n = (k: string) => (typeof raw?.[k] === 'number' ? (raw[k] as number) : NaN);
    const el = {
      number: n('number'),
      epoch: n('epoch'),
      a: n('a'),
      e: n('e'),
      i: n('i'),
      om: n('om'),
      w: n('w'),
      ma: n('ma'),
      H: n('H'),
    };
    if (!Object.values(el).every(Number.isFinite) || el.a <= 0 || el.e >= 1) continue;
    const G = n('G');
    const diameter = n('diameter');
    out.push({
      kind: 'asteroid',
      id: `ast-${el.number}`,
      name: typeof raw.name === 'string' && raw.name ? raw.name : `(${el.number})`,
      ...el,
      G: Number.isFinite(G) ? G : 0.15,
      diameter: Number.isFinite(diameter) ? diameter : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- propagator

/** Perihelion-referenced orbit with its EQJ orientation basis. */
interface Orbit {
  q: number;
  e: number;
  /** Perihelion time, TT days since J2000. */
  tp: number;
  /** Unit vector towards perihelion, EQJ. */
  P: Vec3;
  /** Unit vector 90° ahead of P in the orbit plane, EQJ. */
  Q: Vec3;
}

const ECL_TO_EQJ = Astronomy.Rotation_ECL_EQJ().rot;

function eclToEqj(x: number, y: number, z: number): Vec3 {
  const r = ECL_TO_EQJ;
  return {
    x: r[0][0] * x + r[1][0] * y + r[2][0] * z,
    y: r[0][1] * x + r[1][1] * y + r[2][1] * z,
    z: r[0][2] * x + r[1][2] * y + r[2][2] * z,
  };
}

const orbitCache = new WeakMap<SmallBodyElements, Orbit>();

function orbitOf(el: SmallBodyElements): Orbit {
  let orbit = orbitCache.get(el);
  if (orbit) return orbit;

  let q: number;
  let tp: number;
  if (el.kind === 'comet') {
    q = el.q;
    tp = el.tp - JD_J2000;
  } else {
    q = el.a * (1 - el.e);
    const n = GAUSS_K / el.a ** 1.5; // rad/day
    const M = Math.atan2(Math.sin(el.ma * DEG), Math.cos(el.ma * DEG)); // (-π, π]
    tp = el.epoch - JD_J2000 - M / n;
  }

  const [so, co] = [Math.sin(el.om * DEG), Math.cos(el.om * DEG)];
  const [sw, cw] = [Math.sin(el.w * DEG), Math.cos(el.w * DEG)];
  const [si, ci] = [Math.sin(el.i * DEG), Math.cos(el.i * DEG)];
  orbit = {
    q,
    e: el.e,
    tp,
    P: eclToEqj(cw * co - sw * so * ci, cw * so + sw * co * ci, sw * si),
    Q: eclToEqj(-sw * co - cw * so * ci, -sw * so + cw * co * ci, cw * si),
  };
  orbitCache.set(el, orbit);
  return orbit;
}

/** Stumpff functions c1, c2, c3 of z (series near zero to avoid cancellation). */
function stumpff(z: number): [number, number, number] {
  if (Math.abs(z) < 1) {
    let c2 = 0;
    let c3 = 0;
    let t2 = 1 / 2;
    let t3 = 1 / 6;
    for (let j = 0; j < 12; j++) {
      c2 += t2;
      c3 += t3;
      t2 *= -z / ((2 * j + 3) * (2 * j + 4));
      t3 *= -z / ((2 * j + 4) * (2 * j + 5));
    }
    return [1 - z * c3, c2, c3];
  }
  if (z > 0) {
    const s = Math.sqrt(z);
    return [Math.sin(s) / s, (1 - Math.cos(s)) / z, (s - Math.sin(s)) / (z * s)];
  }
  const s = Math.sqrt(-z);
  return [Math.sinh(s) / s, (Math.cosh(s) - 1) / -z, (Math.sinh(s) - s) / (-z * s)];
}

/** Starting value for the universal anomaly χ ≥ 0 given T = k·|Δt|. */
function initialChi(q: number, e: number, alpha: number, T: number): number {
  if (e < 0.98) {
    // Elliptic: classic eccentric-anomaly starter, χ = E/√α.
    const M = T * alpha ** 1.5;
    return Math.min(M + 0.85 * e, Math.PI) / Math.sqrt(alpha);
  }
  if (e > 1.02) {
    // Hyperbolic: H ≈ ln(2N/e + 1.8), χ = H/√(−α).
    const N = T * (-alpha) ** 1.5;
    return Math.log((2 * N) / e + 1.8) / Math.sqrt(-alpha);
  }
  // Near-parabolic: exact solution of Barker's equation D + D³/3 = T/√(2q³).
  const s = (1.5 * T) / Math.sqrt(2 * q ** 3);
  const Y = Math.cbrt(s + Math.hypot(s, 1));
  return Math.sqrt(2 * q) * (Y - 1 / Y);
}

/**
 * Solves Kepler's equation in universal form, k·Δt = qχ + eχ³c3(αχ²) with α = (1−e)/q,
 * returning the perifocal position (x towards perihelion) and radius in AU.
 * Valid for any e ≥ 0; `dt` is time since perihelion in days.
 */
export function perifocalPosition(q: number, e: number, dt: number): { x: number; y: number; r: number } {
  const alpha = (1 - e) / q;
  if (alpha > 0) {
    // Elliptic: wrap to the nearest perihelion passage so |E| ≤ π.
    const period = (2 * Math.PI) / (GAUSS_K * alpha ** 1.5);
    dt -= period * Math.round(dt / period);
  }
  const sign = dt < 0 ? -1 : 1; // the equation is odd in χ
  const T = GAUSS_K * Math.abs(dt);

  // Safeguarded Newton: F(χ) is monotonic, bracketed by [0, T/q] (and |E| ≤ π).
  let lo = 0;
  let hi = alpha > 0 ? Math.min(T / q, Math.PI / Math.sqrt(alpha)) : T / q;
  let chi = Math.min(Math.max(initialChi(q, e, alpha, T), lo), hi);
  let c: [number, number, number] = stumpff(alpha * chi * chi);
  for (let iter = 0; iter < 100; iter++) {
    const F = q * chi + e * chi ** 3 * c[2] - T;
    const step = F / (q + e * chi * chi * c[1]); // dF/dχ = r
    if (Math.abs(step) <= 1e-15 * chi || F === 0) break;
    if (F > 0) hi = chi;
    else lo = chi;
    chi -= step;
    if (!(chi > lo && chi < hi)) chi = 0.5 * (lo + hi);
    c = stumpff(alpha * chi * chi);
  }

  const chi2 = chi * chi;
  return {
    x: q - chi2 * c[1],
    y: sign * chi * Math.sqrt(q * (1 + e)) * c[0],
    r: q + e * chi2 * c[1],
  };
}

function positionAt(orbit: Orbit, tt: number): Vec3 {
  const { x, y } = perifocalPosition(orbit.q, orbit.e, tt - orbit.tp);
  const { P, Q } = orbit;
  return { x: x * P.x + y * Q.x, y: x * P.y + y * Q.y, z: x * P.z + y * Q.z };
}

/** Geometric heliocentric position, EQJ AU. */
export function helioPosition(el: SmallBodyElements, time: Astronomy.AstroTime | Date): Vec3 {
  return positionAt(orbitOf(el), Astronomy.MakeTime(time).tt);
}

// -------------------------------------------------------------- observables

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const angleDeg = (a: Vec3, b: Vec3): number =>
  Math.acos(Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y + a.z * b.z) / (len(a) * len(b))))) / DEG;

/** IAU H–G asteroid magnitude. */
function asteroidMagnitude(H: number, G: number, r: number, delta: number, phaseDeg: number): number {
  const tanHalf = Math.tan((phaseDeg * DEG) / 2);
  const phi1 = Math.exp(-3.33 * tanHalf ** 0.63);
  const phi2 = Math.exp(-1.87 * tanHalf ** 1.22);
  return H + 5 * Math.log10(r * delta) - 2.5 * Math.log10((1 - G) * phi1 + G * phi2);
}

/**
 * Heuristic visual tail length: scales with the comet's heliocentric brightness
 * H + 2.5n·log r and fades out beyond ~3 AU. Clamped to ≤ 0.3 AU.
 */
function cometTailLength(el: CometElements, r: number): number {
  if (!Number.isFinite(el.H)) return 0;
  const helioMag = el.H + 2.5 * el.G * Math.log10(r);
  const len = (0.1 * 10 ** (0.2 * (8 - helioMag))) / (1 + (r / 3) ** 6);
  return len < 0.005 ? 0 : Math.min(len, 0.3);
}

/**
 * Apparent state of a small body for an observer (geocentric when omitted),
 * with a single light-time iteration.
 */
export function smallBodyState(
  el: SmallBodyElements,
  time: Astronomy.AstroTime | Date,
  observer?: Astronomy.Observer,
): SmallBodyState {
  const t = Astronomy.MakeTime(time);
  const orbit = orbitOf(el);

  let obs: Vec3 = Astronomy.HelioVector(Astronomy.Body.Earth, t);
  if (observer) {
    const o = Astronomy.ObserverVector(t, observer, false);
    obs = { x: obs.x + o.x, y: obs.y + o.y, z: obs.z + o.z };
  }

  const helio = positionAt(orbit, t.tt);
  const emitted = positionAt(orbit, t.tt - len(sub(helio, obs)) / Astronomy.C_AUDAY);
  const geo = sub(emitted, obs);
  const r = len(emitted);
  const delta = len(geo);

  const eq = Astronomy.EquatorFromVector(new Astronomy.Vector(geo.x, geo.y, geo.z, t));
  const phaseAngle = angleDeg({ x: -emitted.x, y: -emitted.y, z: -emitted.z }, { x: -geo.x, y: -geo.y, z: -geo.z });
  const mag =
    el.kind === 'comet'
      ? el.H + 5 * Math.log10(delta) + 2.5 * el.G * Math.log10(r)
      : asteroidMagnitude(el.H, el.G, r, delta, phaseAngle);

  return {
    helio,
    geo,
    r,
    delta,
    ra: eq.ra,
    dec: eq.dec,
    mag,
    elongation: angleDeg({ x: -obs.x, y: -obs.y, z: -obs.z }, geo),
    phaseAngle,
    constellation: Astronomy.Constellation(eq.ra, eq.dec).symbol,
    tailDir: { x: emitted.x / r, y: emitted.y / r, z: emitted.z / r },
    tailLengthAU: el.kind === 'comet' ? cometTailLength(el, r) : 0,
  };
}

/** Open (e ≥ 1) orbits further than this from perihelion are skipped by {@link brightComets}. */
const SKIP_OPEN_ORBIT_DAYS = 15 * DAYS_PER_YEAR;

/**
 * Bodies brighter than `limitMag`, brightest first. Parabolic/hyperbolic comets
 * more than 15 years from perihelion are skipped without propagation.
 */
export function brightComets<T extends SmallBodyElements>(
  list: readonly T[],
  time: Astronomy.AstroTime | Date,
  observer?: Astronomy.Observer,
  limitMag = 12,
): { el: T; state: SmallBodyState }[] {
  const t = Astronomy.MakeTime(time);
  const out: { el: T; state: SmallBodyState }[] = [];
  for (const el of list) {
    const orbit = orbitOf(el);
    if (orbit.e >= 1 && Math.abs(t.tt - orbit.tp) > SKIP_OPEN_ORBIT_DAYS) continue;
    const state = smallBodyState(el, t, observer);
    if (state.mag <= limitMag) out.push({ el, state });
  }
  return out.sort((a, b) => a.state.mag - b.state.mag);
}

/**
 * Orbit outline as heliocentric EQJ points (AU), sampled uniformly in true anomaly
 * so the perihelion passage is well resolved. Closed ellipses are returned as a
 * loop (first point repeated); open or very elongated orbits are cut where
 * r exceeds max(30 AU, 1.2 × the body's current distance).
 */
export function orbitPolyline(el: SmallBodyElements, time: Astronomy.AstroTime | Date, segments = 256): Vec3[] {
  const orbit = orbitOf(el);
  const { q, e, P, Q } = orbit;
  const rNow = perifocalPosition(q, e, Astronomy.MakeTime(time).tt - orbit.tp).r;
  const rMax = Math.max(30, 1.2 * rNow);
  const p = q * (1 + e); // semi-latus rectum

  // r(ν) = p / (1 + e cos ν) ≤ rMax  ⇔  cos ν ≥ (p/rMax − 1)/e
  const aphelion = e < 1 ? p / (1 - e) : Infinity;
  const nuMax = aphelion <= rMax ? Math.PI : Math.acos(Math.min(1, (p / rMax - 1) / e));

  const points: Vec3[] = [];
  for (let k = 0; k <= segments; k++) {
    const nu = -nuMax + (2 * nuMax * k) / segments;
    const r = p / (1 + e * Math.cos(nu));
    const x = r * Math.cos(nu);
    const y = r * Math.sin(nu);
    points.push({ x: x * P.x + y * Q.x, y: x * P.y + y * Q.y, z: x * P.z + y * Q.z });
  }
  return points;
}
