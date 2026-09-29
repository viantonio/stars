import { describe, expect, it } from 'vitest';
import * as A from 'astronomy-engine';
import {
  aspectBetween, computeAngles, computeChart, eclipticConstellations, formatLongitude, meanNodeLongitude, norm180, norm360,
  planetaryHour, transitsToChart, zodiacSignOf, DEFAULT_ORBS, TRANSIT_ORBS,
} from '../src/esoteric/astrology';
import { ayanamsaValue } from '../src/esoteric/ayanamsa';
import {
  activePaths, ASPECT_INFO, ELEMENTS, EMERALD_TABLET, gematria, HEBREW_LETTERS, MOON_PHASE_MEANINGS, moonPhaseMeaning, PLANETS,
  planetLetter, SEPHIROTH, SIGNS,
} from '../src/esoteric/correspondences';
import type { Chart, PointId } from '../src/esoteric/types';

const pt = (c: Chart, id: PointId) => c.points.find((p) => p.id === id)!;
const MARIPOSA = { lat: 37.4849, lon: -119.9663 };
const T0 = new Date('2026-09-29T12:00:00Z');

describe('planet positions vs JPL Horizons', () => {
  // Horizons (DE441), geocentric (500@399), QUANTITIES=31 "ObsEcLon": apparent ecliptic longitude
  // of date (IAU76/80), light-time + aberration, 2026-Sep-29 12:00 UT. Fetched 2026-09-29.
  const HORIZONS: [PointId, number, number][] = [
    ['Sun', 186.3654630, 0.0001798],
    ['Moon', 42.5421105, 4.9507551],
    ['Mercury', 208.6694469, -1.5667683],
    ['Mars', 120.8117739, 0.9896915],
    ['Jupiter', 139.3211119, 0.5932656],
    ['Pluto', 303.1333768, -4.2939533],
  ];
  const chart = computeChart({ date: T0, ...MARIPOSA });
  for (const [id, lon, lat] of HORIZONS) {
    it(`${id} longitude within ${id === 'Moon' ? 0.05 : 0.02}°`, () => {
      const p = pt(chart, id);
      expect(Math.abs(norm180(p.longitude - lon))).toBeLessThan(id === 'Moon' ? 0.05 : 0.02);
      expect(Math.abs(p.latitude - lat)).toBeLessThan(0.01);
    });
  }

  it('speeds and retrograde flags are sensible', () => {
    expect(pt(chart, 'Sun').speed).toBeGreaterThan(0.95);
    expect(pt(chart, 'Sun').speed).toBeLessThan(1.03);
    expect(pt(chart, 'Moon').speed).toBeGreaterThan(11);
    expect(pt(chart, 'Saturn').retrograde).toBe(true); // Saturn retrograde Jul 26 – Dec 10 2026
    expect(pt(chart, 'Mars').retrograde).toBe(false);
    expect(pt(chart, 'NorthNode').speed).toBeCloseTo(-0.0529, 3);
    expect(norm360(pt(chart, 'SouthNode').longitude - pt(chart, 'NorthNode').longitude)).toBeCloseTo(180, 9);
  });

  it('reports the IAU constellation physically behind each body', () => {
    expect(pt(chart, 'Sun').constellation).toBe('Vir'); // tropical Libra, sky Virgo
    expect(pt(chart, 'Jupiter').constellation).toBe('Leo');
    expect(pt(chart, 'Saturn').constellation).toBe('Cet'); // outside the 13 ecliptic constellations
  });
});

// Swiss Ephemeris 2.10.03 (pyswisseph), swe.houses(jd_ut, lat, lon, b'P'); mean node swe.MEAN_NODE.
const SWISS: { name: string; lat: number; lon: number; date: string; asc: number; mc: number; cusps: number[]; node: number }[] = [
  { name: 'Mariposa', lat: 37.4849, lon: -119.9663, date: '2026-09-29T12:00:00Z', asc: 162.2848, mc: 69.9421, node: 327.79456,
    cusps: [162.2848, 187.4013, 217.0073, 249.9421, 283.4013, 314.5665, 342.2848, 7.4013, 37.0073, 69.9421, 103.4013, 134.5665] },
  { name: 'Sacramento', lat: 38.5816, lon: -121.4944, date: '2026-03-20T20:00:00Z', asc: 104.9825, mc: 356.589, node: 337.99641,
    cusps: [104.9825, 125.1349, 147.9979, 176.589, 212.4003, 251.037, 284.9825, 305.1349, 327.9979, 356.589, 32.4003, 71.037] },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093, date: '2026-06-21T02:00:00Z', asc: 180.7686, mc: 90.4587, node: 333.11188,
    cusps: [180.7686, 219.6674, 247.4249, 270.4587, 293.5607, 321.5457, 0.7686, 39.6674, 67.4249, 90.4587, 113.5607, 141.5457] },
  { name: 'London', lat: 51.5074, lon: -0.1278, date: '1990-01-01T00:00:00Z', asc: 187.2341, mc: 99.428, node: 318.46146,
    cusps: [187.2341, 211.9554, 242.8399, 279.428, 315.0038, 344.2498, 7.2341, 31.9554, 62.8399, 99.428, 135.0038, 164.2498] },
];

describe('angles and houses', () => {
  for (const s of SWISS) {
    it(`${s.name}: Ascendant, MC, Placidus cusps and mean node match the Swiss Ephemeris`, () => {
      const c = computeChart({ date: new Date(s.date), lat: s.lat, lon: s.lon });
      expect(Math.abs(norm180(pt(c, 'Ascendant').longitude - s.asc))).toBeLessThan(0.005);
      expect(Math.abs(norm180(pt(c, 'Midheaven').longitude - s.mc))).toBeLessThan(0.005);
      c.cusps.forEach((x, i) => expect(Math.abs(norm180(x - s.cusps[i]))).toBeLessThan(0.005));
      expect(Math.abs(norm180(meanNodeLongitude(new Date(s.date)) - s.node))).toBeLessThan(0.001);
      expect(c.housesFallback).toBeUndefined();
    });
  }

  it('above the polar circle Placidus falls back to Porphyry (Swiss Ephemeris, Tromsø)', () => {
    const c = computeChart({ date: new Date('2026-01-15T10:00:00Z'), lat: 69.65, lon: 18.96 });
    expect(c.housesFallback).toBe('porphyry');
    const ref = [307.2079, 359.0485, 50.8891, 102.7297, 110.8891, 119.0485, 127.2079, 179.0485, 230.8891, 282.7297, 290.8891, 299.0485];
    c.cusps.forEach((x, i) => expect(Math.abs(norm180(x - ref[i]))).toBeLessThan(0.005));
  });

  /** Horizontal coordinates (no refraction) of an ecliptic-of-date point. */
  const altAz = (date: Date, lat: number, lon: number, eclLon: number) => {
    const t = A.MakeTime(date);
    const obs = new A.Observer(lat, lon, 0);
    const eqd = A.RotateVector(A.Rotation_ECT_EQD(t), A.VectorFromSphere(new A.Spherical(0, eclLon, 1), t));
    const hor = A.HorizonFromVector(A.RotateVector(A.Rotation_EQD_HOR(t, obs), eqd), '');
    const ra = A.EquatorFromVector(eqd).ra;
    const ha = norm180((A.SiderealTime(t) * 15 + lon) - ra * 15);
    return { alt: hor.lat, az: hor.lon, ha };
  };

  const sites = [[37.48, -119.97], [-33.87, 151.21], [51.5, -0.13], [0, 30], [64.1, -21.9], [69.65, 18.96], [-60, -70]];
  const dates = ['2026-01-01T00:00:00Z', '2026-04-11T07:30:00Z', '2026-07-19T15:45:00Z', '2026-10-30T22:10:00Z'];

  it('the Ascendant lies on the eastern horizon and the MC on the upper meridian', () => {
    for (const [lat, lon] of sites) {
      for (const d of dates) {
        const date = new Date(d);
        const a = computeAngles(date, lat, lon);
        const asc = altAz(date, lat, lon, a.ascendant);
        expect(Math.abs(asc.alt)).toBeLessThan(0.05);
        expect(asc.az).toBeGreaterThan(0);
        expect(asc.az).toBeLessThan(180);
        const mc = altAz(date, lat, lon, a.midheaven);
        expect(Math.abs(mc.ha)).toBeLessThan(0.001);
      }
    }
  });

  it('Placidus cusps trisect the semi-arcs in time (the defining property)', () => {
    for (const [lat, lon] of sites.filter(([la]) => Math.abs(la) < 66)) {
      for (const d of dates) {
        const date = new Date(d);
        const c = computeChart({ date, lat, lon });
        const check = (cusp: number, expected: (dsa: number) => number) => {
          const t = A.MakeTime(date);
          const eqd = A.EquatorFromVector(A.RotateVector(A.Rotation_ECT_EQD(t), A.VectorFromSphere(new A.Spherical(0, cusp, 1), t)));
          const dsa = Math.acos(-Math.tan(lat * Math.PI / 180) * Math.tan(eqd.dec * Math.PI / 180)) * 180 / Math.PI;
          const ha = norm180(A.SiderealTime(t) * 15 + lon - eqd.ra * 15);
          expect(Math.abs(norm180(ha - expected(dsa)))).toBeLessThan(0.01);
        };
        check(c.cusps[10], (dsa) => -dsa / 3); // 11th: 1/3 of the diurnal semi-arc east of the MC
        check(c.cusps[11], (dsa) => -2 * dsa / 3); // 12th
        check(c.cusps[2], (dsa) => -180 + (180 - dsa) / 3); // 3rd: 1/3 of the nocturnal semi-arc from the IC
        check(c.cusps[1], (dsa) => -180 + 2 * (180 - dsa) / 3); // 2nd
      }
    }
  });

  it('equal and whole-sign houses', () => {
    const eq = computeChart({ date: T0, ...MARIPOSA, houseSystem: 'equal' });
    const asc = pt(eq, 'Ascendant').longitude;
    eq.cusps.forEach((c, i) => expect(norm180(c - asc - 30 * i)).toBeCloseTo(0, 9));
    const ws = computeChart({ date: T0, ...MARIPOSA, houseSystem: 'whole-sign' });
    expect(ws.cusps[0]).toBe(Math.floor(asc / 30) * 30);
    ws.cusps.forEach((c) => expect(c % 30).toBe(0));
    expect(pt(ws, 'Ascendant').house).toBe(1);
    for (const p of ws.points) expect(p.house).toBe(((p.sign - ws.cusps[0] / 30 + 12) % 12) + 1);
  });

  it('places points in houses consistently with the cusps', () => {
    const c = computeChart({ date: T0, ...MARIPOSA });
    expect(pt(c, 'Ascendant').house).toBe(1);
    expect(pt(c, 'Midheaven').house).toBe(10);
    for (const p of c.points.filter((q) => q.id !== 'Ascendant' && q.id !== 'Midheaven')) {
      const start = c.cusps[p.house - 1], end = c.cusps[p.house % 12];
      expect(norm360(p.longitude - start)).toBeLessThan(norm360(end - start));
    }
  });
});

describe('sidereal zodiac', () => {
  it('Lahiri ayanamsa is ≈24.2° in 2026', () => {
    expect(ayanamsaValue(new Date('2026-01-01T00:00:00Z'), 'lahiri')).toBeGreaterThan(24.15);
    expect(ayanamsaValue(new Date('2026-01-01T00:00:00Z'), 'lahiri')).toBeLessThan(24.25);
  });

  it('matches Swiss Ephemeris mean ayanamsa (swe_get_ayanamsa_ut) to ~1″', () => {
    expect(ayanamsaValue(T0, 'lahiri')).toBeCloseTo(24.230688621945774, 3);
    expect(Math.abs(ayanamsaValue(T0, 'lahiri') - 24.230688621945774)).toBeLessThan(0.0003);
    expect(Math.abs(ayanamsaValue(new Date(Date.UTC(2000, 0, 1, 12)), 'lahiri') - 23.857092353708822)).toBeLessThan(0.0003);
    expect(Math.abs(ayanamsaValue(T0, 'fagan-bradley') - 25.113896266256234)).toBeLessThan(0.0003);
    expect(Math.abs(ayanamsaValue(new Date(Date.UTC(2000, 0, 1, 12)), 'fagan-bradley') - 24.740299994434963)).toBeLessThan(0.0003);
  });

  it('sidereal positions subtract the true ayanamsa (Swiss Ephemeris FLG_SIDEREAL Sun)', () => {
    const c = computeChart({ date: T0, ...MARIPOSA, zodiac: 'sidereal' });
    expect(Math.abs(pt(c, 'Sun').longitude - 162.132499499747)).toBeLessThan(0.002);
    expect(c.ayanamsa).toBeCloseTo(24.23297, 3); // swe_get_ayanamsa_ex_ut (with nutation)
    const trop = computeChart({ date: T0, ...MARIPOSA });
    for (const id of ['Moon', 'Ascendant', 'Midheaven', 'NorthNode'] as PointId[]) {
      expect(norm180(pt(trop, id).longitude - pt(c, id).longitude - c.ayanamsa)).toBeCloseTo(0, 9);
    }
    trop.cusps.forEach((x, i) => expect(norm180(x - c.cusps[i] - c.ayanamsa)).toBeCloseTo(0, 9));
    // Aspects do not depend on the zodiac.
    expect(c.aspects.map((a) => `${a.a}-${a.b}-${a.type}`)).toEqual(trop.aspects.map((a) => `${a.a}-${a.b}-${a.type}`));
  });
});

describe('aspects', () => {
  const c = computeChart({ date: T0, ...MARIPOSA });

  it('every aspect is within its orb and uses the allowed types', () => {
    expect(c.aspects.length).toBeGreaterThan(5);
    for (const a of c.aspects) {
      const la = pt(c, a.a).longitude, lb = pt(c, a.b).longitude;
      const sep = Math.abs(norm180(lb - la));
      expect(Math.abs(Math.abs(sep - a.angle) - a.orb)).toBeLessThan(1e-9);
      const lum = ['Sun', 'Moon'].includes(a.a) || ['Sun', 'Moon'].includes(a.b);
      expect(a.orb).toBeLessThanOrEqual(DEFAULT_ORBS[a.type] + (lum ? 2 : 0));
      if (a.a.endsWith('Node') || a.b.endsWith('Node')) expect(a.type).toBe('conjunction');
      expect(a.a.endsWith('Node') && a.b.endsWith('Node')).toBe(false);
    }
    // Neptune 2°54′ Aries sextile Pluto 3°07′ Aquarius (orb ≈0.23°).
    expect(c.aspects.find((a) => a.a === 'Neptune' && a.b === 'Pluto')?.type).toBe('sextile');
  });

  it('applying vs separating follows the relative motion', () => {
    const orbs = { ...DEFAULT_ORBS };
    // Faster body behind a slower one, closing in: applying conjunction.
    expect(aspectBetween({ id: 'Moon', lon: 10, speed: 13 }, { id: 'Saturn', lon: 14, speed: 0.1 }, orbs, ['conjunction'])!.applying).toBe(true);
    expect(aspectBetween({ id: 'Moon', lon: 18, speed: 13 }, { id: 'Saturn', lon: 14, speed: 0.1 }, orbs, ['conjunction'])!.applying).toBe(false);
    // Square forming: separation 85° and growing.
    expect(aspectBetween({ id: 'Mars', lon: 0, speed: 0.1 }, { id: 'Venus', lon: 85, speed: 1.2 }, orbs, ['square'])!.applying).toBe(true);
    expect(aspectBetween({ id: 'Mars', lon: 0, speed: 0.1 }, { id: 'Venus', lon: 275, speed: 1.2 }, orbs, ['square'])!.applying).toBe(false);
  });

  it('transits to a natal chart use tight orbs', () => {
    const natal = computeChart({ date: new Date('1990-01-01T00:00:00Z'), lat: 51.5074, lon: -0.1278 });
    const tr = transitsToChart(natal, T0);
    for (const a of tr) expect(a.orb).toBeLessThanOrEqual(TRANSIT_ORBS[a.a]!);
    // A chart transiting itself: every planet exactly conjunct its own natal place.
    const self = transitsToChart(natal, natal.date).filter((a) => a.a === a.b);
    expect(self.length).toBe(10);
    for (const a of self) { expect(a.type).toBe('conjunction'); expect(a.orb).toBeLessThan(1e-9); }
  });
});

describe('planetary hours', () => {
  const obs = new A.Observer(MARIPOSA.lat, MARIPOSA.lon, 0);
  // Saturday 3 October 2026 in California.
  const rise = A.SearchRiseSet(A.Body.Sun, obs, +1, new Date('2026-10-03T10:00:00Z'), 1)!.date;
  const set = A.SearchRiseSet(A.Body.Sun, obs, -1, rise, 1)!.date;
  const hour = (set.getTime() - rise.getTime()) / 12;

  it('the first hour after sunrise on a Saturday is Saturn, the next Jupiter', () => {
    const h1 = planetaryHour(new Date(rise.getTime() + 60e3), MARIPOSA.lat, MARIPOSA.lon)!;
    expect(h1).toMatchObject({ ruler: 'Saturn', dayRuler: 'Saturn', index: 1, isDay: true });
    expect(Math.abs(h1.start.getTime() - rise.getTime())).toBeLessThan(1000);
    const h2 = planetaryHour(new Date(rise.getTime() + hour + 60e3), MARIPOSA.lat, MARIPOSA.lon)!;
    expect(h2).toMatchObject({ ruler: 'Jupiter', index: 2, isDay: true });
  });

  it('the night continues the Chaldean sequence of the day', () => {
    const n1 = planetaryHour(new Date(set.getTime() + 60e3), MARIPOSA.lat, MARIPOSA.lon)!;
    expect(n1).toMatchObject({ ruler: 'Mercury', dayRuler: 'Saturn', index: 1, isDay: false });
    // The first hour of the next day (Sunday) belongs to the Sun.
    const sun = A.SearchRiseSet(A.Body.Sun, obs, +1, set, 1)!.date;
    expect(planetaryHour(new Date(sun.getTime() + 60e3), MARIPOSA.lat, MARIPOSA.lon)).toMatchObject({ ruler: 'Sun', dayRuler: 'Sun', index: 1 });
  });

  it('returns null in the polar night', () => {
    expect(planetaryHour(new Date('2026-12-21T12:00:00Z'), 78.22, 15.65)).toBeNull();
  });
});

describe('formatting and signs', () => {
  it('formats longitudes within the sign', () => {
    expect(formatLongitude(164.37)).toBe('14°22′ ♍︎');
    expect(formatLongitude(29.99999)).toBe('29°59′ ♈︎');
    expect(formatLongitude(360)).toBe('0°00′ ♈︎');
    expect(zodiacSignOf(-1)).toMatchObject({ sign: 11, name: 'Pisces' });
    expect(zodiacSignOf(95.5).degree).toBeCloseTo(5.5, 9);
  });
});

describe('ecliptic constellations', () => {
  const segs = eclipticConstellations(T0);

  it('the ecliptic crosses 13 IAU constellations including Ophiuchus', () => {
    expect(segs.map((s) => s.id)).toEqual(['Ari', 'Tau', 'Gem', 'Cnc', 'Leo', 'Vir', 'Lib', 'Sco', 'Oph', 'Sgr', 'Cap', 'Aqr', 'Psc']);
    const total = segs.reduce((s, x) => s + (x.end - x.start), 0);
    expect(total).toBeCloseTo(360, 6);
    segs.forEach((s, i) => expect(norm360(segs[(i + 1) % segs.length].start - s.end)).toBeCloseTo(0, 6));
    // Scorpius holds the ecliptic for only ~7°, Virgo for ~44°.
    const w = (id: string) => { const s = segs.find((x) => x.id === id)!; return s.end - s.start; };
    expect(w('Sco')).toBeLessThan(8);
    expect(w('Vir')).toBeGreaterThan(43);
  });

  it('agrees with the constellation behind the Sun', () => {
    const c = computeChart({ date: T0, ...MARIPOSA });
    const sun = pt(c, 'Sun');
    const seg = segs.find((s) => norm360(sun.longitude - s.start) < s.end - s.start)!;
    expect(seg.id).toBe(sun.constellation);
  });
});

describe('correspondences', () => {
  it('has 22 unique Hebrew letters: 3 mothers, 7 doubles, 12 simples', () => {
    expect(HEBREW_LETTERS).toHaveLength(22);
    expect(new Set(HEBREW_LETTERS.map((l) => l.glyph)).size).toBe(22);
    expect(HEBREW_LETTERS.filter((l) => l.class === 'mother')).toHaveLength(3);
    expect(HEBREW_LETTERS.filter((l) => l.class === 'double')).toHaveLength(7);
    expect(HEBREW_LETTERS.filter((l) => l.class === 'simple')).toHaveLength(12);
    expect(HEBREW_LETTERS.reduce((s, l) => s + l.value, 0)).toBe(1495);
    expect(gematria('אמת')).toBe(441); // emet, "truth"
    expect(gematria('שלום')).toBe(376);
  });

  it('32 paths of wisdom = 10 sephiroth + 22 letters on paths 11..32', () => {
    expect(SEPHIROTH).toHaveLength(10);
    const paths = HEBREW_LETTERS.map((l) => l.path).sort((a, b) => a - b);
    expect(paths).toEqual(Array.from({ length: 22 }, (_, i) => 11 + i));
    expect(SEPHIROTH.length + paths.length).toBe(32);
    const edges = new Set(HEBREW_LETTERS.map((l) => l.connects.join('-')));
    expect(edges.size).toBe(22);
    for (const l of HEBREW_LETTERS) {
      expect(l.connects[0]).toBeLessThan(l.connects[1]);
      expect(l.connects[1]).toBeLessThanOrEqual(10);
    }
  });

  it('each sign has exactly one simple letter, matching the letter table', () => {
    expect(SIGNS).toHaveLength(12);
    expect(new Set(SIGNS.map((s) => s.letter)).size).toBe(12);
    for (const s of SIGNS) {
      const l = HEBREW_LETTERS.find((x) => x.glyph === s.letter)!;
      expect(l.class).toBe('simple');
      expect(l.attribution).toEqual({ kind: 'sign', id: s.name });
      expect(l.name).toBe(s.letterName);
      expect(s.glyph.endsWith('︎')).toBe(true);
    }
    for (const el of ELEMENTS) for (const i of el.signs) expect(SIGNS[i].element).toBe(el.name);
  });

  it('the seven doubles map one-to-one to the classical planets in both traditions', () => {
    const classical = PLANETS.filter((p) => p.classical);
    expect(classical).toHaveLength(7);
    for (const trad of ['golden-dawn', 'sefer-yetzirah'] as const) {
      const letters = classical.map((p) => planetLetter(p.id, trad)!);
      expect(new Set(letters.map((l) => l.glyph)).size).toBe(7);
      for (const l of letters) expect(l.class).toBe('double');
    }
    expect(planetLetter('Saturn', 'golden-dawn')!.name).toBe('Tav');
    expect(planetLetter('Mercury', 'golden-dawn')!.name).toBe('Bet');
    expect(planetLetter('Saturn', 'sefer-yetzirah')!.name).toBe('Bet');
    expect(planetLetter('Moon', 'sefer-yetzirah')!.name).toBe('Tav');
    for (const l of HEBREW_LETTERS.filter((x) => x.class === 'double')) {
      expect(PLANETS.find((p) => p.id === l.attribution.id)!.letterGD).toBe(l.glyph);
      expect(PLANETS.find((p) => p.id === l.syPlanet)!.letterSY).toBe(l.glyph);
    }
    for (const p of classical) expect(SEPHIROTH[p.sephira! - 1].planet).toBe(p.id);
  });

  it('aspect, Moon-phase and Emerald Tablet tables are complete', () => {
    expect(Object.values(ASPECT_INFO).map((a) => a.angle)).toEqual([0, 60, 90, 120, 180]);
    expect(MOON_PHASE_MEANINGS).toHaveLength(8);
    expect(moonPhaseMeaning(359.9).name).toBe('Balsamic');
    expect(moonPhaseMeaning(180).name).toBe('Full Moon');
    expect(EMERALD_TABLET[1]).toMatch(/below is like that which is above/);
  });

  it('activePaths lights sephiroth and paths from the chart', () => {
    const c = computeChart({ date: T0, ...MARIPOSA });
    const gd = activePaths(c, 'golden-dawn');
    expect(gd.sephiroth).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(gd.paths).toContain(30); // Sun ↔ Resh
    expect(gd.paths).toContain(22); // Sun in Libra ↔ Lamed
    const sy = activePaths(c, 'sefer-yetzirah');
    expect(sy.reasons.find((r) => r.point === 'Sun' && r.kind === 'planet-path')!.target).toBe(21); // Kaph
    for (const p of [...gd.paths, ...sy.paths]) { expect(p).toBeGreaterThanOrEqual(11); expect(p).toBeLessThanOrEqual(32); }
  });
});
