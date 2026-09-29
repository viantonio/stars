import { describe, expect, it } from 'vitest';
import { degreesToRadians, ecfToLookAngles, eciToEcf, gstime, propagate, radiansToDegrees } from 'satellite.js';
import {
  azimuthToCompass,
  mergeTLE,
  parseTLE,
  predictPasses,
  satelliteLook,
  satelliteTrack,
} from '../src/astro/satellites';
import text from '../public/data/satellites.tle?raw';

const sats = parseTLE(text);
const iss = sats.find((s) => s.noradId === 25544)!;
const sacramento = { lat: 38.5816, lon: -121.4944, elevation: 9 };

describe('parseTLE / mergeTLE', () => {
  it('parses the bundled catalogue with featured satellites first', () => {
    expect(sats.length).toBeGreaterThan(50);
    expect(iss).toBeDefined();
    expect(iss.name).toBe('ISS');
    expect(iss.fullName).toBe('ISS (ZARYA)');
    expect(iss.intlDes).toBe('1998-067A');
    expect(sats.slice(0, 3).map((s) => s.name)).toEqual(['ISS', 'Tiangong', 'Hubble']);
    expect(sats.filter((s) => s.featured)).toHaveLength(3);
  });

  it('dedupes by NORAD id', () => {
    const ids = sats.map((s) => s.noradId);
    expect(new Set(ids).size).toBe(ids.length);
    const rawCount = text.split('\n').filter((l) => l.startsWith('1 ')).length;
    expect(rawCount).toBeGreaterThan(ids.length);
  });

  it('merge prefers the newer epoch', () => {
    const newer = { ...iss, epoch: new Date(iss.epoch.getTime() + 3600_000), fullName: 'newer' };
    const older = { ...iss, epoch: new Date(iss.epoch.getTime() - 3600_000), fullName: 'older' };
    expect(mergeTLE(sats, [newer]).find((s) => s.noradId === 25544)!.fullName).toBe('newer');
    expect(mergeTLE(sats, [older]).find((s) => s.noradId === 25544)!.fullName).toBe('ISS (ZARYA)');
    expect(mergeTLE(sats, [newer])).toHaveLength(sats.length);
  });
});

describe('satelliteLook', () => {
  it('ISS altitude and speed are sane', () => {
    const look = satelliteLook(iss, iss.epoch, sacramento)!;
    expect(look.altitudeKm).toBeGreaterThan(370);
    expect(look.altitudeKm).toBeLessThan(450);
    expect(look.velocityKmS).toBeGreaterThan(7.5);
    expect(look.velocityKmS).toBeLessThan(7.8);
    expect(Math.abs(look.lat)).toBeLessThanOrEqual(51.7);
    expect(look.mag).toBeGreaterThan(-5);
    expect(look.mag).toBeLessThan(8);
  });

  it("matches satellite.js' ecfToLookAngles", () => {
    const date = new Date(iss.epoch.getTime() + 2.5 * 3600_000);
    const pv = propagate(iss.satrec, date)!;
    const la = ecfToLookAngles(
      { latitude: degreesToRadians(sacramento.lat), longitude: degreesToRadians(sacramento.lon), height: 0.009 },
      eciToEcf(pv.position, gstime(date)),
    );
    const look = satelliteLook(iss, date, sacramento)!;
    expect(look.az).toBeCloseTo(radiansToDegrees(la.azimuth), 4);
    expect(look.alt).toBeCloseTo(radiansToDegrees(la.elevation), 4);
    expect(look.rangeKm).toBeCloseTo(la.rangeSat, 3);
  });

  it('returns null when propagation fails', () => {
    // A very low, high-drag orbit that re-enters within days.
    const [doomed] = parseTLE(
      [
        'DOOMED',
        '1 99999U 26001A   26271.50000000  .01000000  00000+0  50000-0 0  9990',
        '2 99999  51.6000 150.0000 0005000 200.0000 160.0000 16.30000000    10',
      ].join('\n'),
    );
    expect(satelliteLook(doomed, doomed.epoch, sacramento)).not.toBeNull();
    expect(satelliteLook(doomed, new Date(doomed.epoch.getTime() + 60 * 86400_000), sacramento)).toBeNull();
    expect(predictPasses(doomed, sacramento, new Date(doomed.epoch.getTime() + 60 * 86400_000))).toEqual([]);
  });
});

describe('predictPasses', () => {
  it('finds ISS passes over Sacramento within 5 days', () => {
    const t = performance.now();
    const passes = predictPasses(iss, sacramento, iss.epoch, 5, 10);
    const elapsed = performance.now() - t;
    expect(passes.length).toBeGreaterThan(5);
    for (const p of passes) {
      expect(p.rise.time.getTime()).toBeLessThan(p.culmination.time.getTime());
      expect(p.culmination.time.getTime()).toBeLessThan(p.set.time.getTime());
      expect(p.maxAlt).toBeGreaterThanOrEqual(10);
      expect(Math.abs(p.rise.alt)).toBeLessThan(0.1);
      expect(Math.abs(p.set.alt)).toBeLessThan(0.1);
      expect(p.durationSec).toBeGreaterThan(60);
      expect(p.durationSec).toBeLessThan(15 * 60);
      expect(Number.isFinite(p.peakMag)).toBe(true);
      if (p.visible) {
        expect(p.visibleStart!.time.getTime()).toBeLessThanOrEqual(p.visibleEnd!.time.getTime());
      }
    }
    console.log(`ISS: ${passes.length} passes, ${passes.filter((p) => p.visible).length} visible, ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(500);
  });
});

describe('helpers', () => {
  it('satelliteTrack samples the requested window', () => {
    const track = satelliteTrack(iss, sacramento, iss.epoch, 5, 5, 30);
    expect(track).toHaveLength(21);
  });

  it('azimuthToCompass', () => {
    expect(azimuthToCompass(0)).toBe('N');
    expect(azimuthToCompass(337.5)).toBe('NNW');
    expect(azimuthToCompass(359)).toBe('N');
    expect(azimuthToCompass(-90)).toBe('W');
    expect(azimuthToCompass(135)).toBe('SE');
  });
});
