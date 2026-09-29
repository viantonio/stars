import * as Astronomy from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import {
  GAUSS_K,
  brightComets,
  helioPosition,
  orbitPolyline,
  parseAsteroids,
  parseCometEls,
  perifocalPosition,
  smallBodyState,
} from '../src/astro/smallbodies';
import asteroidsJson from '../public/data/asteroids.json';
import cometEls from '../public/data/CometEls.txt?raw';

const comets = parseCometEls(cometEls);
const asteroids = parseAsteroids(asteroidsJson);
const comet = (name: string) => comets.find((c) => c.name === name)!;

/** 2026-10-01 00:00 TT (JD 2461314.5), the epoch of the Horizons reference values below. */
const T_REF = Astronomy.AstroTime.FromTerrestrialTime(2461314.5 - 2451545);

/** Great-circle separation in degrees between two RA (hours) / Dec (deg) pairs. */
function separation(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const r = Math.PI / 180;
  const cos =
    Math.sin(dec1 * r) * Math.sin(dec2 * r) + Math.cos(dec1 * r) * Math.cos(dec2 * r) * Math.cos((ra1 - ra2) * 15 * r);
  return Math.acos(Math.min(1, cos)) / r;
}

describe('parseCometEls', () => {
  it('parses the bundled MPC file', () => {
    expect(comets.length).toBeGreaterThan(500);
    expect(new Set(comets.map((c) => c.id)).size).toBe(comets.length);
  });

  it('reads known periodic comets with plausible elements', () => {
    const halley = comet('1P/Halley');
    expect(halley).toMatchObject({ id: '0001P', orbitType: 'P', q: 0.571029, e: 0.968025, i: 162.19, H: 5.5, G: 3.2 });
    expect(halley.tp).toBeCloseTo(2474038.6609, 3); // 2061-08-02.1609 TT
    const encke = comet('2P/Encke');
    expect(encke.q).toBeCloseTo(0.33861, 5);
    expect(encke.epoch).toBe(2461311.5); // 2026-09-28
    expect(comet('C/1995 O1 (Hale-Bopp)').orbitType).toBe('C');
  });

  it('tolerates blank magnitude parameters and epochs', () => {
    const line =
      '    CK25R030  2026 04 19.8923  0.498615  1.000342  162.2277   38.7000  124.7301                        C/2025 R3 (PANSTARRS)';
    const [c] = parseCometEls(line + '   \n\n');
    expect(c).toMatchObject({ name: 'C/2025 R3 (PANSTARRS)', epoch: null, G: 4 });
    expect(c.H).toBeNaN();
  });
});

describe('parseAsteroids', () => {
  it('loads the SBDB snapshot', () => {
    expect(asteroids.map((a) => a.number)).toEqual(expect.arrayContaining([1, 2, 3, 4, 6, 7, 433]));
    const ceres = asteroids.find((a) => a.number === 1)!;
    expect(ceres).toMatchObject({ kind: 'asteroid', name: 'Ceres' });
    expect(ceres.a).toBeCloseTo(2.766, 2);
  });

  it('drops malformed entries', () => {
    expect(parseAsteroids({ bodies: [{ name: 'x', number: 1 }] })).toEqual([]);
    expect(parseAsteroids(null)).toEqual([]);
  });
});

describe('Kepler propagator', () => {
  /** Reference elliptic solution via eccentric anomaly E. */
  function ellipticRef(q: number, e: number, dt: number) {
    const a = q / (1 - e);
    const M = (GAUSS_K / a ** 1.5) * dt;
    let E = M;
    for (let k = 0; k < 200; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    return { x: a * (Math.cos(E) - e), y: a * Math.sqrt(1 - e * e) * Math.sin(E) };
  }

  /** Reference hyperbolic solution via hyperbolic anomaly H. */
  function hyperbolicRef(q: number, e: number, dt: number) {
    const a = q / (e - 1);
    const N = (GAUSS_K / a ** 1.5) * dt;
    let H = Math.asinh(N / e);
    for (let k = 0; k < 200; k++) H -= (e * Math.sinh(H) - H - N) / (e * Math.cosh(H) - 1);
    return { x: a * (e - Math.cosh(H)), y: a * Math.sqrt(e * e - 1) * Math.sinh(H) };
  }

  it('matches the classical elliptic and hyperbolic solutions', () => {
    for (const dt of [-4000, -365, -12.5, 0.3, 90, 1000]) {
      for (const [q, e] of [[2.55, 0.08], [0.33, 0.85], [1.2, 0.97]]) {
        const p = perifocalPosition(q, e, dt);
        const ref = ellipticRef(q, e, dt);
        expect(Math.hypot(p.x - ref.x, p.y - ref.y)).toBeLessThan(1e-9);
        expect(p.r).toBeCloseTo(Math.hypot(ref.x, ref.y), 10);
      }
      for (const [q, e] of [[1.36, 6.14], [0.5, 1.2]]) {
        const p = perifocalPosition(q, e, dt);
        const ref = hyperbolicRef(q, e, dt);
        expect(Math.hypot(p.x - ref.x, p.y - ref.y) / p.r).toBeLessThan(1e-11);
      }
    }
  });

  it('reproduces Barker’s equation for e = 1', () => {
    const q = 0.8;
    for (const D of [-5, -0.3, 0, 0.01, 1, 12]) {
      const dt = (Math.sqrt(2 * q ** 3) / GAUSS_K) * (D + D ** 3 / 3);
      const p = perifocalPosition(q, 1, dt);
      expect(p.x).toBeCloseTo(q * (1 - D * D), 9);
      expect(p.y).toBeCloseTo(2 * q * D, 9);
    }
  });

  it('is continuous in r(t) across e = 1', () => {
    const q = 0.5;
    const es = [0.9999, 0.99999, 0.999999, 1, 1.000001, 1.00001, 1.0001, 1.0007];
    for (const dt of [-3000, -200, -5, 0, 1e-3, 30, 400, 3650]) {
      const rs = es.map((e) => perifocalPosition(q, e, dt).r);
      for (let k = 1; k < es.length; k++) {
        const de = es[k] - es[k - 1];
        // r varies smoothly with e: |Δr| ≲ C·Δe with modest C, even far from perihelion.
        expect(Math.abs(rs[k] - rs[k - 1])).toBeLessThan(2000 * de * Math.max(1, rs[k]));
        expect(rs[k]).toBeGreaterThanOrEqual(q - 1e-12);
      }
    }
  });

  it('is continuous in time through perihelion for a near-parabolic orbit', () => {
    const q = 0.3;
    for (const e of [0.9999, 1, 1.0007]) {
      let prev = perifocalPosition(q, e, -1);
      for (let dt = -1 + 0.01; dt <= 1; dt += 0.01) {
        const p = perifocalPosition(q, e, dt);
        expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(0.01);
        prev = p;
      }
    }
  });
});

describe('smallBodyState vs JPL Horizons (geocentric astrometric J2000, 2026-10-01 00:00 TT)', () => {
  // Values from https://ssd.jpl.nasa.gov/api/horizons.api (QUANTITIES='1,19,20', CENTER='500@399'),
  // fetched 2026-09-29: [RA deg, Dec deg, r AU, delta AU].
  const cases: [string, () => Parameters<typeof smallBodyState>[0], number[], number][] = [
    ['1 Ceres', () => asteroids.find((a) => a.number === 1)!, [107.137353171, 23.214164519, 2.67344804, 2.62660004], 0.05],
    ['2P/Encke', () => comet('2P/Encke'), [12.658458415, 20.097337029, 2.15150798, 1.17695848], 0.2],
    ['C/2025 R3 (e = 1.0003)', () => comet('C/2025 R3 (PANSTARRS)'), [113.103143626, -25.799433449, 2.8824458, 2.99120655], 0.2],
    ['3I/ATLAS (e = 6.1)', () => comet('3I/ATLAS'), [108.421980029, 19.277281371, 11.82543586, 11.95635808], 0.2],
  ];

  it.each(cases)('%s', (_label, get, [ra, dec, r, delta], tolDeg) => {
    const s = smallBodyState(get(), T_REF);
    expect(separation(s.ra, s.dec, ra / 15, dec)).toBeLessThan(tolDeg);
    expect(Math.abs(s.r - r)).toBeLessThan(0.01);
    expect(Math.abs(s.delta - delta)).toBeLessThan(0.01);
  });

  it('derives consistent observables for Ceres', () => {
    const s = smallBodyState(asteroids.find((a) => a.number === 1)!, T_REF);
    expect(s.elongation).toBeCloseTo(81.75, 0); // Horizons S-O-T 81.7499
    expect(Math.abs(s.mag - 8.669)).toBeLessThan(0.1); // Horizons APmag (H–G)
    expect(s.constellation).toBe('Gem');
    expect(s.tailLengthAU).toBe(0);
    expect(Math.hypot(s.tailDir.x, s.tailDir.y, s.tailDir.z)).toBeCloseTo(1, 12);
  });

  it('applies topocentric parallax for a nearby observer', () => {
    const apophis = asteroids.find((a) => a.number === 99942);
    if (!apophis) return;
    const geo = smallBodyState(apophis, T_REF);
    const topo = smallBodyState(apophis, T_REF, new Astronomy.Observer(38.58, -121.49, 10));
    expect(Math.abs(topo.delta - geo.delta)).toBeLessThan(5e-5); // ≤ one Earth radius
    expect(topo.delta).not.toBe(geo.delta);
  });
});

describe('brightComets / orbitPolyline', () => {
  it('lists bright comets sorted by magnitude', () => {
    const list = brightComets(comets, T_REF, undefined, 14);
    expect(list.length).toBeGreaterThan(0);
    for (let k = 1; k < list.length; k++) expect(list[k].state.mag).toBeGreaterThanOrEqual(list[k - 1].state.mag);
    expect(list.every((c) => c.state.mag <= 14)).toBe(true);
  });

  it('gives an active comet a plausible tail', () => {
    const encke = comet('2P/Encke');
    const nearPerihelion = Astronomy.AstroTime.FromTerrestrialTime(encke.tp - 2451545);
    const s = smallBodyState(encke, nearPerihelion);
    expect(s.tailLengthAU).toBeGreaterThan(0);
    expect(s.tailLengthAU).toBeLessThanOrEqual(0.3);
    const hs = helioPosition(encke, nearPerihelion);
    expect(Math.hypot(hs.x, hs.y, hs.z)).toBeCloseTo(encke.q, 4);
  });

  it('closes elliptic orbits and bounds open ones', () => {
    const ceres = orbitPolyline(asteroids[0], T_REF, 64);
    expect(ceres).toHaveLength(65);
    expect(ceres[0].x).toBeCloseTo(ceres[64].x, 12);

    const hyper = comet('3I/ATLAS');
    const pts = orbitPolyline(hyper, T_REF, 100);
    const rs = pts.map((p) => Math.hypot(p.x, p.y, p.z));
    expect(Math.max(...rs)).toBeLessThanOrEqual(30 + 1e-9);
    expect(Math.min(...rs)).toBeCloseTo(hyper.q, 6);
  });
});
