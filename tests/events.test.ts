import { describe, expect, it } from 'vitest';
import { computeEvents, moonPhaseName, tonightSummary, type SkyEvent } from '../src/astro/events';
import {
  METEOR_SHOWERS,
  activeShowers,
  expectedHourlyRate,
  showerActivity,
  showerPeakDate,
} from '../src/astro/meteors';
import { PRESET_LOCATIONS } from '../src/core/locations';

const mariposa = PRESET_LOCATIONS.find((s) => s.id === 'mariposa')!;
const sacramento = PRESET_LOCATIONS.find((s) => s.id === 'sacramento')!;

const HOUR = 3_600_000;
const near = (d: Date, iso: string, hours: number) => Math.abs(d.getTime() - Date.parse(iso)) <= hours * HOUR;

describe('meteor showers', () => {
  const perseids = METEOR_SHOWERS.find((s) => s.code === 'PER')!;

  it('lists the major IMO showers with unique codes', () => {
    const codes = METEOR_SHOWERS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of ['QUA', 'LYR', 'ETA', 'SDA', 'CAP', 'PER', 'DRA', 'ORI', 'STA', 'NTA', 'LEO', 'GEM', 'URS']) {
      expect(codes).toContain(c);
    }
  });

  it('puts the 2026 Perseid peak on the night of Aug 12–13', () => {
    const peak = showerPeakDate(perseids, 2026);
    expect(peak.getTime()).toBeGreaterThan(Date.parse('2026-08-12T00:00Z'));
    expect(peak.getTime()).toBeLessThan(Date.parse('2026-08-13T12:00Z'));
    expect(showerActivity(perseids, peak).zhr).toBeCloseTo(perseids.zhr, 0);
  });

  it('models activity falling off away from the peak and zero outside the active period', () => {
    const peak = showerPeakDate(perseids, 2026);
    const weekBefore = showerActivity(perseids, new Date(peak.getTime() - 7 * 24 * HOUR));
    expect(weekBefore.zhr).toBeGreaterThan(0);
    expect(weekBefore.zhr).toBeLessThan(perseids.zhr / 2);
    expect(weekBefore.radiantRa).toBeLessThan(perseids.radiantRa); // radiant drifts east over time
    expect(showerActivity(perseids, new Date('2026-12-01T00:00Z')).zhr).toBe(0);
  });

  it('reports active showers and a sensible visual rate', () => {
    const night = new Date('2026-12-14T10:00Z'); // 2 AM PST on Geminid night
    const active = activeShowers(night);
    expect(active[0].shower.code).toBe('GEM');
    const gem = active[0].shower;
    const rate = expectedHourlyRate(gem, night, mariposa, 6.5);
    expect(rate).toBeGreaterThan(80);
    expect(rate).toBeLessThanOrEqual(gem.zhr);
    // Radiant below the horizon in the late afternoon → no meteors.
    expect(expectedHourlyRate(gem, new Date('2026-12-13T23:00Z'), mariposa, 6.5)).toBe(0);
    // Light pollution cuts the rate sharply.
    expect(expectedHourlyRate(gem, night, sacramento, 4.5)).toBeLessThan(rate / 5);
  });
});

describe('computeEvents for 2026 (Mariposa)', () => {
  const t0 = performance.now();
  const events = computeEvents(mariposa, new Date('2026-01-01T00:00Z'), new Date('2027-01-01T00:00Z'));
  const elapsed = performance.now() - t0;
  const find = (pred: (e: SkyEvent) => boolean) => events.find(pred);

  it('is fast, sorted and has unique deterministic ids', () => {
    expect(elapsed).toBeLessThan(2000);
    for (let i = 1; i < events.length; i++) expect(events[i].date.getTime()).toBeGreaterThanOrEqual(events[i - 1].date.getTime());
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    const again = computeEvents(mariposa, new Date('2026-01-01T00:00Z'), new Date('2027-01-01T00:00Z'));
    expect(again.map((e) => e.id)).toEqual(events.map((e) => e.id));
  });

  it('finds the total lunar eclipse of 2026-03-03, visible from California', () => {
    const e = find((x) => x.kind === 'lunar-eclipse' && near(x.date, '2026-03-03T11:33Z', 1));
    expect(e).toBeDefined();
    expect(e!.title).toBe('Total Lunar Eclipse');
    expect(e!.visibleFromSite).toBe(true);
    expect(e!.importance).toBe(3);
  });

  it('flags the 2026-08-12 total solar eclipse as not visible from California', () => {
    const e = find((x) => x.kind === 'solar-eclipse' && near(x.date, '2026-08-12T17:46Z', 2));
    expect(e).toBeDefined();
    expect(e!.title).toBe('Total Solar Eclipse');
    expect(e!.visibleFromSite).toBe(false);
  });

  it('lists the Perseid peak with a moonlight note', () => {
    const e = find((x) => x.kind === 'meteor-shower' && x.title.startsWith('Perseids'));
    expect(e).toBeDefined();
    expect(e!.date.getTime()).toBeGreaterThan(Date.parse('2026-08-12T00:00Z'));
    expect(e!.date.getTime()).toBeLessThan(Date.parse('2026-08-13T12:00Z'));
    expect(e!.description).toMatch(/moon/i);
    expect(e!.importance).toBe(3); // new moon in 2026 — ideal
  });

  it('times the September equinox at ~00:05 UTC on 2026-09-23', () => {
    const e = find((x) => x.kind === 'season' && x.title === 'September Equinox');
    expect(e).toBeDefined();
    expect(near(e!.date, '2026-09-23T00:05Z', 0.1)).toBe(true);
  });

  it('names the Sept 26 full moon the Harvest Moon and Oct 26 the Hunter’s Moon', () => {
    const harvest = find((x) => x.kind === 'moon-phase' && x.title.startsWith('Harvest Moon'));
    expect(harvest).toBeDefined();
    expect(near(harvest!.date, '2026-09-26T16:49Z', 1)).toBe(true);
    const hunter = find((x) => x.kind === 'moon-phase' && x.title.startsWith("Hunter's Moon"));
    expect(near(hunter!.date, '2026-10-26T04:12Z', 1)).toBe(true);
  });

  it('marks the May 31 Blue Moon and the December supermoon', () => {
    const blue = find((x) => x.title.startsWith('Blue Moon'));
    expect(blue).toBeDefined();
    expect(near(blue!.date, '2026-05-31T08:45Z', 1)).toBe(true);
    const cold = find((x) => x.title.startsWith('Cold Moon'));
    expect(cold!.title).toContain('Supermoon');
  });

  it('finds Jupiter at opposition on 2026-01-10 and Saturn on 2026-10-04', () => {
    const jup = find((x) => x.kind === 'opposition' && x.bodies.includes('Jupiter'));
    expect(jup!.date.toISOString().slice(0, 10)).toBe('2026-01-10');
    expect(jup!.visibleFromSite).toBe(true);
    const sat = find((x) => x.kind === 'opposition' && x.bodies.includes('Saturn'));
    expect(sat!.date.toISOString().slice(0, 10)).toBe('2026-10-04');
  });

  it('finds the June 2026 Venus–Jupiter conjunction in the evening sky', () => {
    const e = find((x) => x.kind === 'conjunction' && x.bodies.includes('Venus') && x.bodies.includes('Jupiter'));
    expect(e).toBeDefined();
    expect(e!.date.toISOString().slice(0, 7)).toBe('2026-06');
    expect(e!.description).toMatch(/after dusk/);
  });

  it('includes Mercury greatest elongations', () => {
    const elong = events.filter((x) => x.kind === 'elongation' && x.bodies[0] === 'Mercury');
    expect(elong.length).toBeGreaterThanOrEqual(5);
    for (const e of elong) expect(e.title).toMatch(/Greatest (Morning|Evening) Elongation/);
  });
});

describe('planet parades', () => {
  it('detects the 2022 morning line-up and merges days into one window', () => {
    const events = computeEvents(mariposa, new Date('2022-03-20T00:00Z'), new Date('2022-05-20T00:00Z'))
      .filter((e) => e.kind === 'planet-parade');
    expect(events.length).toBeGreaterThanOrEqual(1);
    const p = events[0];
    expect(p.endDate!.getTime() - p.date.getTime()).toBeGreaterThan(7 * 24 * HOUR);
    for (const b of ['Venus', 'Mars', 'Saturn']) expect(p.bodies).toContain(b);
    expect(p.description).toMatch(/morning sky/);
  });
});

describe('tonightSummary', () => {
  const tonight = tonightSummary(mariposa, new Date('2026-09-29T20:00Z')); // 1 PM PDT

  it('gives sunset and twilight times for Mariposa on 2026-09-29', () => {
    // Sunset ≈ 6:46 PM PDT = 01:46 UTC on Sept 30.
    expect(near(tonight.sunset!, '2026-09-30T01:46Z', 0.25)).toBe(true);
    expect(tonight.civilDusk! > tonight.sunset!).toBe(true);
    expect(tonight.nauticalDusk! > tonight.civilDusk!).toBe(true);
    expect(tonight.astronomicalDusk! > tonight.nauticalDusk!).toBe(true);
    // Astronomical dusk ≈ 8:12 PM PDT.
    expect(near(tonight.astronomicalDusk!, '2026-09-30T03:12Z', 0.25)).toBe(true);
    expect(tonight.astronomicalDawn! < tonight.nauticalDawn!).toBe(true);
    expect(tonight.civilDawn! < tonight.sunrise!).toBe(true);
    expect(near(tonight.sunrise!, '2026-09-30T13:55Z', 0.25)).toBe(true);
  });

  it('uses the previous evening before local noon', () => {
    const early = tonightSummary(mariposa, new Date('2026-09-30T08:00Z')); // 1 AM PDT
    expect(early.sunset!.getTime()).toBe(tonight.sunset!.getTime());
  });

  it('describes the waning gibbous Moon after the Harvest Moon', () => {
    const { moon } = tonight;
    expect(moon.phaseName).toBe('Waning Gibbous');
    expect(moon.illumination).toBeGreaterThan(0.75);
    expect(moon.illumination).toBeLessThan(0.95);
    expect(moon.ageDays).toBeGreaterThan(18);
    expect(moon.ageDays).toBeLessThan(20);
    expect(near(moon.nextNewMoon, '2026-10-10T15:50Z', 1)).toBe(true);
    expect(near(moon.nextFullMoon, '2026-10-26T04:12Z', 1)).toBe(true);
    // The Moon rises shortly after astronomical dusk: only a sliver of moonless darkness.
    const darkMinutes = tonight.darkWindow.reduce((s, i) => s + (i.end.getTime() - i.start.getTime()), 0) / 60_000;
    expect(darkMinutes).toBeLessThan(60);
    expect(tonight.skyQuality.score).toBeLessThan(50);
  });

  it('reports planet visibility', () => {
    const byName = Object.fromEntries(tonight.planets.map((p) => [p.body, p]));
    expect(Object.keys(byName)).toEqual(['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']);
    // Saturn is days from opposition: up all night.
    expect(byName.Saturn.visibleTonight).toBe(true);
    expect(byName.Saturn.elongation).toBeGreaterThan(160);
    expect(byName.Saturn.constellation).toBe('Cetus');
    // Venus is a brilliant evening star, low in the west-southwest.
    expect(byName.Venus.visibleTonight).toBe(true);
    expect(byName.Venus.mag).toBeLessThan(-4);
    expect(byName.Venus.note).toMatch(/after sunset/);
    // Jupiter and Mars are morning objects.
    expect(byName.Jupiter.note).toMatch(/before dawn/);
    expect(byName.Mars.note).toMatch(/before dawn/);
  });

  it('rates a moonless dark site above a moonlit city', () => {
    const newMoonDark = tonightSummary(mariposa, new Date('2026-10-10T20:00Z'));
    const newMoonCity = tonightSummary(sacramento, new Date('2026-10-10T20:00Z'));
    expect(newMoonDark.skyQuality.score).toBeGreaterThan(70);
    expect(newMoonDark.darkWindow.length).toBeGreaterThan(0);
    expect(newMoonCity.skyQuality.score).toBeLessThan(newMoonDark.skyQuality.score);
  });
});

describe('moonPhaseName', () => {
  it('maps phase angles to names', () => {
    expect(moonPhaseName(0)).toBe('New Moon');
    expect(moonPhaseName(45)).toBe('Waxing Crescent');
    expect(moonPhaseName(90)).toBe('First Quarter');
    expect(moonPhaseName(135)).toBe('Waxing Gibbous');
    expect(moonPhaseName(180)).toBe('Full Moon');
    expect(moonPhaseName(225)).toBe('Waning Gibbous');
    expect(moonPhaseName(270)).toBe('Last Quarter');
    expect(moonPhaseName(315)).toBe('Waning Crescent');
    expect(moonPhaseName(359)).toBe('New Moon');
  });
});
