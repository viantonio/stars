import * as A from 'astronomy-engine';
import * as THREE from 'three';
import { RAD, raDecToVec } from './frames';

export type MajorBodyId = 'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune' | 'Pluto';

export interface BodyInfo {
  id: MajorBodyId;
  body: A.Body;
  name: string;
  /** Equatorial radius, km. */
  radiusKm: number;
  /** Polar flattening. */
  flattening: number;
  /** Display tint for the point sprite (sRGB). */
  tint: string;
  kind: 'star' | 'moon' | 'planet' | 'dwarf';
  texture?: string;
  facts: string;
}

export const AU_KM = 149597870.7;

export const BODIES: BodyInfo[] = [
  { id: 'Sun', body: A.Body.Sun, name: 'Sun', radiusKm: 695700, flattening: 0, tint: '#fff4e0', kind: 'star', texture: 'sun', facts: 'Our star: a 4.6-billion-year-old G2V dwarf holding 99.86% of the Solar System’s mass.' },
  { id: 'Moon', body: A.Body.Moon, name: 'Moon', radiusKm: 1737.4, flattening: 0, tint: '#f2efe8', kind: 'moon', texture: 'moon', facts: 'Earth’s only natural satellite, tidally locked so the same face always points toward us — libration lets us peek at 59% of its surface.' },
  { id: 'Mercury', body: A.Body.Mercury, name: 'Mercury', radiusKm: 2439.7, flattening: 0, tint: '#d9cbb8', kind: 'planet', texture: 'mercury', facts: 'The innermost planet never strays more than 28° from the Sun, so it is only seen low in twilight.' },
  { id: 'Venus', body: A.Body.Venus, name: 'Venus', radiusKm: 6051.8, flattening: 0, tint: '#fff6dc', kind: 'planet', texture: 'venus', facts: 'Wrapped in brilliant sulfuric-acid clouds, Venus is the brightest object after the Sun and Moon and shows phases like the Moon.' },
  { id: 'Mars', body: A.Body.Mars, name: 'Mars', radiusKm: 3396.2, flattening: 0.00589, tint: '#ffb27a', kind: 'planet', texture: 'mars', facts: 'The Red Planet’s iron-oxide dust gives it a distinctly orange glow; it is brightest around opposition every 26 months.' },
  { id: 'Jupiter', body: A.Body.Jupiter, name: 'Jupiter', radiusKm: 71492, flattening: 0.06487, tint: '#ffe9c9', kind: 'planet', texture: 'jupiter', facts: 'The giant planet. Even binoculars reveal its four Galilean moons shuffling from night to night.' },
  { id: 'Saturn', body: A.Body.Saturn, name: 'Saturn', radiusKm: 60268, flattening: 0.09796, tint: '#f5dfae', kind: 'planet', texture: 'saturn', facts: 'Its rings span 280,000 km yet are mostly only tens of metres thick. Their tilt toward Earth changes over a 29-year cycle.' },
  { id: 'Uranus', body: A.Body.Uranus, name: 'Uranus', radiusKm: 25559, flattening: 0.02293, tint: '#c6f1f5', kind: 'planet', texture: 'uranus', facts: 'An ice giant tipped on its side. At magnitude ~5.7 it is just visible to the naked eye under dark skies like Mariposa’s.' },
  { id: 'Neptune', body: A.Body.Neptune, name: 'Neptune', radiusKm: 24764, flattening: 0.01708, tint: '#9ab8ff', kind: 'planet', texture: 'neptune', facts: 'The outermost planet, found in 1846 by mathematics before it was seen. Needs binoculars at magnitude ~7.8.' },
  { id: 'Pluto', body: A.Body.Pluto, name: 'Pluto', radiusKm: 1188.3, flattening: 0, tint: '#e8d6c4', kind: 'dwarf', facts: 'The dwarf planet in the Kuiper belt; at magnitude ~14.5 it requires a sizeable telescope.' },
];

export const BODY_BY_ID = Object.fromEntries(BODIES.map((b) => [b.id, b])) as Record<MajorBodyId, BodyInfo>;

export interface BodyState {
  info: BodyInfo;
  /** Apparent topocentric direction, EQJ unit vector. */
  dirEqj: THREE.Vector3;
  ra: number;
  dec: number;
  /** Distance from the observer, AU. */
  distAU: number;
  mag: number;
  /** Fraction of the disc illuminated (0..1). */
  phase: number;
  phaseAngle: number;
  /** Apparent angular radius, degrees. */
  angularRadius: number;
  /** Direction from the body toward the Sun (EQJ unit). */
  sunDirEqj: THREE.Vector3;
  /** North pole (EQJ unit) and prime-meridian angle (deg) per IAU. */
  pole: THREE.Vector3;
  spin: number;
  /** Heliocentric position (EQJ, AU). */
  helio: THREE.Vector3;
  elongation: number;
}

function vec(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

export function computeBody(info: BodyInfo, time: A.AstroTime, observer: A.Observer, sunDir?: THREE.Vector3): BodyState {
  const eq = A.Equator(info.body, time, observer, false, true);
  const dirEqj = raDecToVec(eq.ra, eq.dec);
  const distAU = eq.dist;
  const angularRadius = Math.atan(info.radiusKm / (distAU * AU_KM)) * RAD;

  let mag = -26.74;
  let phase = 1;
  let phaseAngle = 0;
  let helio = new THREE.Vector3();
  let sunDirEqj: THREE.Vector3;
  if (info.id === 'Sun') {
    sunDirEqj = dirEqj.clone();
  } else {
    const ill = A.Illumination(info.body, time);
    mag = ill.mag;
    phase = ill.phase_fraction;
    phaseAngle = ill.phase_angle;
    if (info.id === 'Moon') {
      const sun = vec(A.GeoVector(A.Body.Sun, time, true));
      const moon = vec(A.GeoMoon(time));
      sunDirEqj = sun.sub(moon).normalize();
      helio = vec(A.HelioVector(A.Body.Earth, time)).add(moon);
    } else {
      helio = vec(A.HelioVector(info.body, time));
      sunDirEqj = helio.clone().multiplyScalar(-1).normalize();
    }
  }
  const axis = A.RotationAxis(info.body === A.Body.Pluto ? A.Body.Pluto : info.body, time);
  const pole = vec(axis.north);
  if (!sunDir && info.id !== 'Sun') {
    const s = A.Equator(A.Body.Sun, time, observer, false, true);
    sunDir = raDecToVec(s.ra, s.dec);
  }
  const elongation = sunDir && info.id !== 'Sun' ? dirEqj.angleTo(sunDir) * RAD : 0;
  return {
    info,
    dirEqj,
    ra: eq.ra,
    dec: eq.dec,
    distAU,
    mag,
    phase,
    phaseAngle,
    angularRadius,
    sunDirEqj,
    pole,
    spin: axis.spin,
    helio,
    elongation,
  };
}

export function computeAllBodies(time: A.AstroTime, observer: A.Observer): Map<MajorBodyId, BodyState> {
  const out = new Map<MajorBodyId, BodyState>();
  const sun = computeBody(BODIES[0], time, observer);
  out.set('Sun', sun);
  for (const b of BODIES.slice(1)) out.set(b.id, computeBody(b, time, observer, sun.dirEqj));
  return out;
}

/**
 * Orientation matrix mapping a three.js SphereGeometry (poles on ±Y, the
 * texture's centre meridian on +X, east longitudes toward −Z) onto a body's
 * IAU pole and prime meridian in EQJ.
 */
export function bodyOrientation(pole: THREE.Vector3, spinDeg: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  const z = new THREE.Vector3(0, 0, 1);
  const node = new THREE.Vector3().crossVectors(z, pole);
  if (node.lengthSq() < 1e-12) node.set(1, 0, 0);
  node.normalize();
  const w = spinDeg / RAD;
  const q90 = new THREE.Vector3().crossVectors(pole, node);
  const P = node.clone().multiplyScalar(Math.cos(w)).addScaledVector(q90, Math.sin(w)).normalize();
  const Zl = new THREE.Vector3().crossVectors(P, pole).normalize();
  return out.makeBasis(P, pole, Zl);
}

/** Galilean moons: EQJ offsets from Jupiter in AU (already light-time corrected by the engine). */
export function galileanMoons(time: A.AstroTime): { name: string; offset: THREE.Vector3 }[] {
  const m = A.JupiterMoons(time);
  return [
    { name: 'Io', offset: vec(m.io) },
    { name: 'Europa', offset: vec(m.europa) },
    { name: 'Ganymede', offset: vec(m.ganymede) },
    { name: 'Callisto', offset: vec(m.callisto) },
  ];
}
