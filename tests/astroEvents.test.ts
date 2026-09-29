import { describe, expect, it } from 'vitest';
import { computeAstroEvents, personalNote, type AstroEvent } from '../src/esoteric/astroEvents';
import { computeChart, houseOf, norm180, zodiacLongitude } from '../src/esoteric/astrology';

const Y2026 = computeAstroEvents(new Date('2026-01-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z'), { timeZone: 'UTC' });
const find = (pred: (e: AstroEvent) => boolean) => Y2026.filter(pred);
const minutes = (a: Date, b: string) => Math.abs(a.getTime() - new Date(b).getTime()) / 60e3;

describe('2026 events', () => {
  it('are sorted, in range and have unique ids', () => {
    for (let i = 1; i < Y2026.length; i++) expect(Y2026[i].date.getTime()).toBeGreaterThanOrEqual(Y2026[i - 1].date.getTime());
    expect(new Set(Y2026.map((e) => e.id)).size).toBe(Y2026.length);
    expect(Y2026[0].date.getTime()).toBeGreaterThanOrEqual(Date.UTC(2026, 0, 1));
    expect(Y2026[Y2026.length - 1].date.getTime()).toBeLessThan(Date.UTC(2027, 0, 1));
  });

  // JPL Horizons (DE441 / planetary satellite ephemerides), geocentric apparent ecliptic longitude of date
  // (QUANTITIES=31) evaluated at the ingress moments this module found: each lies on the sign boundary
  // within 0.01°. Tolerance on the time = 0.01° / daily motion.
  const INGRESSES: { id: string; body: string; sign: string; at: string; horizonsLon: number; boundary: number; speed: number }[] = [
    { id: 'Neptune:Aries', body: 'Neptune', sign: 'Aries', at: '2026-01-26T14:30:38.754Z', horizonsLon: 359.9967395, boundary: 360, speed: 0.006 },
    { id: 'Saturn:Aries', body: 'Saturn', sign: 'Aries', at: '2026-02-14T00:39:31.646Z', horizonsLon: 0.0021265, boundary: 0, speed: 0.1 },
    { id: 'Sun:Aries', body: 'Sun', sign: 'Aries', at: '2026-03-20T14:45:34.167Z', horizonsLon: 359.9997192, boundary: 360, speed: 1 },
    { id: 'Uranus:Gemini', body: 'Uranus', sign: 'Gemini', at: '2026-04-26T01:01:14.597Z', horizonsLon: 60.0003654, boundary: 60, speed: 0.05 },
    { id: 'Jupiter:Leo', body: 'Jupiter', sign: 'Leo', at: '2026-06-30T05:56:14.890Z', horizonsLon: 120.0005738, boundary: 120, speed: 0.23 },
    { id: 'Venus:Libra', body: 'Venus', sign: 'Libra', at: '2026-08-06T19:13:47.380Z', horizonsLon: 180.0007095, boundary: 180, speed: 1.2 },
    { id: 'Sun:Libra', body: 'Sun', sign: 'Libra', at: '2026-09-23T00:05:40.466Z', horizonsLon: 180.0002961, boundary: 180, speed: 1 },
    { id: 'Mars:Leo', body: 'Mars', sign: 'Leo', at: '2026-09-28T02:49:01.149Z', horizonsLon: 120.0000481, boundary: 120, speed: 0.6 },
    { id: 'Mercury:Scorpio', body: 'Mercury', sign: 'Scorpio', at: '2026-09-30T11:44:42.092Z', horizonsLon: 210.0002646, boundary: 210, speed: 1.3 },
    { id: 'Venus:Libra', body: 'Venus', sign: 'Libra', at: '2026-10-25T08:56:57.736Z', horizonsLon: 210.0054308, boundary: 210, speed: 0.6 },
  ];

  it('sign ingresses agree with JPL Horizons', () => {
    for (const ref of INGRESSES) {
      expect(Math.abs(norm180(ref.horizonsLon - ref.boundary))).toBeLessThan(0.01);
      const ev = find((e) => e.kind === 'ingress' && e.id.startsWith(`ingress:${ref.id}:`) && minutes(e.date, ref.at) < 60 * 24);
      expect(ev, ref.id + ' ' + ref.at).toHaveLength(1);
      expect(minutes(ev[0].date, ref.at)).toBeLessThan((0.01 / ref.speed) * 1440);
    }
  });

  it('Jupiter enters Leo on 30 June 2026 (UTC)', () => {
    const ev = find((e) => e.kind === 'ingress' && e.body === 'Jupiter' && e.sign === 4);
    expect(ev).toHaveLength(1);
    expect(ev[0].date.toISOString().slice(0, 10)).toBe('2026-06-30');
    expect(ev[0].fromSign).toBe(3);
    expect(ev[0].title).toBe('Jupiter enters Leo');
    expect(ev[0].duration).toBe('until Jul 26, 2027');
  });

  it('Mercury retrograde periods match station times derived from Horizons', () => {
    // Extrema of Horizons' 30-minute ObsEcLon series (parabolic fit).
    const HORIZONS_STATIONS: [string, string][] = [
      ['station-retrograde', '2026-02-26T06:48:10Z'], ['station-direct', '2026-03-20T19:32:50Z'],
      ['station-retrograde', '2026-06-29T17:35:56Z'], ['station-direct', '2026-07-23T22:57:53Z'],
      ['station-retrograde', '2026-10-24T07:12:42Z'], ['station-direct', '2026-11-13T15:53:52Z'],
    ];
    const ours = find((e) => e.body === 'Mercury' && e.kind.startsWith('station'));
    expect(ours.map((e) => e.kind)).toEqual(HORIZONS_STATIONS.map(([k]) => k));
    ours.forEach((e, i) => expect(minutes(e.date, HORIZONS_STATIONS[i][1])).toBeLessThan(30));
    expect(ours[0].title).toBe('Mercury stations retrograde in Pisces');
    expect(ours[0].duration).toBe('retrograde until Mar 20, 2026');
  });

  it('handles retrograde re-entry into the previous sign (Venus, Oct 2026)', () => {
    const venus = find((e) => e.kind === 'ingress' && e.body === 'Venus' && e.date.getUTCMonth() >= 8);
    // Enters Scorpio (Sep 10), backs into Libra (Oct 25), re-enters Scorpio (Dec 4).
    expect(venus.map((e) => [e.sign, !!e.retrograde])).toEqual([[7, false], [6, true], [7, false]]);
    expect(venus[1].title).toBe('Venus re-enters Libra (retrograde)');
    expect(venus[1].degree).toBeGreaterThan(29.99);
    expect(venus[1].fromSign).toBe(7);
  });

  it('finds the 2026 eclipses in the right signs', () => {
    const ecl = find((e) => e.kind.endsWith('eclipse')).map((e) => [e.kind, e.eclipseKind, e.date.toISOString().slice(0, 10), e.sign]);
    expect(ecl).toEqual([
      ['solar-eclipse', 'annular', '2026-02-17', 10],
      ['lunar-eclipse', 'total', '2026-03-03', 5],
      ['solar-eclipse', 'total', '2026-08-12', 4],
      ['lunar-eclipse', 'partial', '2026-08-28', 11],
    ]);
    // The eclipse replaces the coinciding lunation.
    expect(find((e) => e.kind === 'new-moon' && e.date.toISOString().startsWith('2026-08-12'))).toHaveLength(0);
    expect(find((e) => e.kind === 'new-moon').length + find((e) => e.kind === 'solar-eclipse').length).toBe(12);
    expect(find((e) => e.kind === 'full-moon').length + find((e) => e.kind === 'lunar-eclipse').length).toBe(13); // blue moon on May 31
  });

  it('New and Full Moons carry the Moon’s sign', () => {
    for (const e of find((x) => x.kind === 'new-moon' || x.kind === 'full-moon')) {
      const sun = zodiacLongitude('Sun', e.date), moon = zodiacLongitude('Moon', e.date);
      expect(Math.abs(norm180(moon - sun - (e.kind === 'new-moon' ? 0 : 180)))).toBeLessThan(0.1);
      expect(e.sign).toBe(Math.floor(moon / 30));
    }
  });

  it('finds the exact Saturn–Neptune conjunction of 20 Feb 2026 at ~0°45′ Aries', () => {
    const c = find((e) => e.kind === 'aspect' && e.body === 'Saturn' && e.body2 === 'Neptune' && e.aspect === 'conjunction');
    expect(c).toHaveLength(1);
    expect(c[0].date.toISOString().slice(0, 10)).toBe('2026-02-20');
    expect(c[0].sign).toBe(0);
    expect(c[0].degree).toBeCloseTo(0.76, 1);
    for (const e of find((x) => x.kind === 'aspect')) {
      const d = Math.abs(norm180(zodiacLongitude(e.body as 'Jupiter', e.date) - zodiacLongitude(e.body2 as 'Jupiter', e.date)));
      expect(Math.min(...[0, 60, 90, 120, 180].map((a) => Math.abs(d - a)))).toBeLessThan(1e-3);
    }
  });

  it('sidereal mode: the Sun enters sidereal (Lahiri) Aries on 14 April 2026 (Mesha Sankranti)', () => {
    const ev = computeAstroEvents(new Date('2026-04-01T00:00:00Z'), new Date('2026-05-01T00:00:00Z'), { zodiac: 'sidereal', ayanamsa: 'lahiri' })
      .filter((e) => e.kind === 'ingress' && e.body === 'Sun');
    expect(ev).toHaveLength(1);
    expect(ev[0].sign).toBe(0);
    expect(ev[0].date.toISOString().slice(0, 10)).toBe('2026-04-14');
  });

  it('optionally includes Moon ingresses', () => {
    const ev = computeAstroEvents(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-08T00:00:00Z'), { includeMoonIngress: true });
    const moon = ev.filter((e) => e.kind === 'ingress' && e.body === 'Moon');
    expect(moon.length).toBeGreaterThanOrEqual(2);
    expect(moon.length).toBeLessThanOrEqual(4);
    for (const e of moon) expect(Math.abs(norm180(zodiacLongitude('Moon', e.date) - e.sign * 30))).toBeLessThan(1e-3);
  });

  it('every event has title and a traditional mundane reading', () => {
    for (const e of Y2026) {
      expect(e.title.length).toBeGreaterThan(5);
      expect(e.world).toMatch(/[Tt]raditionally/);
    }
  });
});

describe('personal notes', () => {
  const natal = computeChart({ date: new Date('1990-01-01T00:00:00Z'), lat: 51.5074, lon: -0.1278 });

  it('places each event in a natal house and lists close contacts', () => {
    for (const e of Y2026) {
      const n = personalNote(e, natal);
      expect(n.house).toBe(houseOf(e.longitude, natal.cusps));
      expect(n.text).toMatch(new RegExp(`your ${n.house}(st|nd|rd|th) house`));
      for (const c of n.contacts) expect(c.orb).toBeLessThanOrEqual(3);
    }
  });

  it('reads Jupiter entering Leo for this chart', () => {
    const e = Y2026.find((x) => x.kind === 'ingress' && x.body === 'Jupiter' && x.sign === 4)!;
    const n = personalNote(e, natal);
    // London 1990 Placidus: 11th cusp 135.0°, 12th 164.2° → 120° is in the 10th house.
    expect(n.house).toBe(10);
    expect(n.text).toContain('Jupiter enters Leo in your 10th house (Vocation)');
  });

  it('works across zodiacs (sidereal natal chart, tropical events)', () => {
    const sid = computeChart({ date: natal.date, lat: natal.lat, lon: natal.lon, zodiac: 'sidereal' });
    const e = Y2026.find((x) => x.kind === 'full-moon')!;
    expect(personalNote(e, sid).house).toBe(personalNote(e, natal).house);
  });
});
