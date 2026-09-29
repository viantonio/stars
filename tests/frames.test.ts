import { describe, expect, it } from 'vitest';
import * as A from 'astronomy-engine';
import * as THREE from 'three';
import { altAzToWorld, eqjToWorld, raDecToVec, worldToAltAz, refraction } from '../src/astro/frames';
import { computeAllBodies, bodyOrientation } from '../src/astro/solarsystem';
import { computeSkyBrightness, displayFromFlux, limitingMagnitude } from '../src/astro/skyBrightness';

const mariposa = new A.Observer(37.4849, -119.9663, 595);

describe('frames', () => {
  it('altAz round-trips through the world frame', () => {
    for (const [alt, az] of [[10, 0], [45, 90], [-20, 200], [80, 315]]) {
      const r = worldToAltAz(altAzToWorld(alt, az));
      expect(r.alt).toBeCloseTo(alt, 6);
      expect(r.az).toBeCloseTo(az, 6);
    }
  });

  it('north is -Z, east is +X, zenith is +Y', () => {
    expect(altAzToWorld(0, 0).z).toBeCloseTo(-1);
    expect(altAzToWorld(0, 90).x).toBeCloseTo(1);
    expect(altAzToWorld(90, 0).y).toBeCloseTo(1);
  });

  it('EQJ→world matches astronomy-engine horizontal coordinates', () => {
    const date = new Date('2026-10-01T05:00:00Z');
    const time = A.MakeTime(date);
    const m = eqjToWorld(time, mariposa);
    for (const [ra, dec] of [[18.6156, 38.7837], [6.7525, -16.7161], [2.53, 89.26]]) {
      const w = raDecToVec(ra, dec).applyMatrix4(m);
      const ours = worldToAltAz(w);
      // Horizon() wants equator-of-date coordinates.
      const eqd = A.RotateVector(A.Rotation_EQJ_EQD(time), A.VectorFromSphere(new A.Spherical(dec, ra * 15, 1), time));
      const sph = A.EquatorFromVector(eqd);
      const hz = A.Horizon(time, mariposa, sph.ra, sph.dec);
      expect(ours.alt).toBeCloseTo(hz.altitude, 1);
      expect(Math.abs(((ours.az - hz.azimuth + 540) % 360) - 180)).toBeLessThan(0.1);
    }
  });

  it('places the Moon where astronomy-engine does', () => {
    const date = new Date('2026-10-01T05:00:00Z');
    const time = A.MakeTime(date);
    const m = eqjToWorld(time, mariposa);
    const bodies = computeAllBodies(time, mariposa);
    const moon = bodies.get('Moon')!;
    const ours = worldToAltAz(moon.dirEqj.clone().applyMatrix4(m).normalize());
    const e = A.Equator(A.Body.Moon, time, mariposa, true, true);
    const hz = A.Horizon(time, mariposa, e.ra, e.dec);
    expect(ours.alt).toBeCloseTo(hz.altitude, 1);
    expect(Math.abs(((ours.az - hz.azimuth + 540) % 360) - 180)).toBeLessThan(0.1);
  });

  it('refraction is ~34′ at the horizon and ~1′ at 45°', () => {
    expect(refraction(0) * 60).toBeGreaterThan(28);
    expect(refraction(0) * 60).toBeLessThan(36);
    expect(refraction(45) * 60).toBeCloseTo(1, 0);
  });

  it('body orientation is a proper rotation with the pole on +Y', () => {
    const pole = new THREE.Vector3(0.3, -0.2, 0.9).normalize();
    const m = bodyOrientation(pole, 123);
    const y = new THREE.Vector3(0, 1, 0).applyMatrix4(m);
    expect(y.distanceTo(pole)).toBeLessThan(1e-9);
    expect(m.determinant()).toBeCloseTo(1, 9);
  });
});

describe('sky brightness', () => {
  it('gives sensible limiting magnitudes for the two home sites', () => {
    const dark = computeSkyBrightness({ sunAlt: -40, moonAlt: -30, moonPhaseAngle: 0, bortle: 3, elevation: 595, perfectSky: false });
    const city = computeSkyBrightness({ sunAlt: -40, moonAlt: -30, moonPhaseAngle: 0, bortle: 8, elevation: 9, perfectSky: false });
    expect(dark.limitingMag).toBeGreaterThan(6);
    expect(city.limitingMag).toBeLessThan(4.8);
    expect(city.limitingMag).toBeGreaterThan(3.5);
  });

  it('a full Moon brightens a dark sky', () => {
    const moonless = computeSkyBrightness({ sunAlt: -40, moonAlt: -30, moonPhaseAngle: 0, bortle: 3, elevation: 595, perfectSky: false });
    const full = computeSkyBrightness({ sunAlt: -40, moonAlt: 50, moonPhaseAngle: 5, bortle: 3, elevation: 595, perfectSky: false });
    expect(full.zenithMag).toBeLessThan(moonless.zenithMag - 1.5);
  });

  it('display mapping is monotonic', () => {
    let prev = -1;
    for (let f = 0.5; f < 1e8; f *= 1.7) {
      const d = displayFromFlux(f);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    expect(limitingMagnitude(21.9)).toBeGreaterThan(6.3);
  });
});
