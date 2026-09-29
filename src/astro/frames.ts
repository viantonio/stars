import * as A from 'astronomy-engine';
import * as THREE from 'three';

/**
 * World frame used by the renderer (fixed to the observer's horizon):
 *   +X = east, +Y = zenith, -Z = north (so +Z = south).
 * Catalog data lives in EQJ (J2000 mean equator); a single matrix per frame
 * maps EQJ unit vectors into this frame, including precession and nutation.
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const HOURS = Math.PI / 12;

/** Unit vector (EQJ) for J2000 right ascension (hours) and declination (degrees). */
export function raDecToVec(raHours: number, decDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const ra = raHours * HOURS;
  const dec = decDeg * DEG;
  const c = Math.cos(dec);
  return out.set(c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec));
}

export function raDegDecToVec(raDeg: number, decDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  return raDecToVec(raDeg / 15, decDeg, out);
}

/** Inverse of {@link raDecToVec}: returns RA in hours [0, 24) and Dec in degrees. */
export function vecToRaDec(v: THREE.Vector3): { ra: number; dec: number } {
  const r = v.length();
  let ra = Math.atan2(v.y, v.x) / HOURS;
  if (ra < 0) ra += 24;
  return { ra, dec: Math.asin(THREE.MathUtils.clamp(v.z / r, -1, 1)) * RAD };
}

/** Direction in the world frame for azimuth (from north through east) and altitude, degrees. */
export function altAzToWorld(altDeg: number, azDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  const c = Math.cos(alt);
  return out.set(Math.sin(az) * c, Math.sin(alt), -Math.cos(az) * c);
}

export function worldToAltAz(v: THREE.Vector3): { alt: number; az: number } {
  const r = v.length();
  const alt = Math.asin(THREE.MathUtils.clamp(v.y / r, -1, 1)) * RAD;
  let az = Math.atan2(v.x, -v.z) * RAD;
  if (az < 0) az += 360;
  return { alt, az };
}

/**
 * Matrix taking EQJ vectors to the world frame for a time and observer.
 * astronomy-engine's HOR frame is (x = north, y = west, z = zenith).
 */
export function eqjToWorld(time: A.AstroTime, observer: A.Observer, out = new THREE.Matrix4()): THREE.Matrix4 {
  const r = A.Rotation_EQJ_HOR(time, observer).rot;
  // hor_j = Σ_i r[i][j]·eqj_i ; world = (-hor_y, hor_z, -hor_x)
  return out.set(
    -r[0][1], -r[1][1], -r[2][1], 0,
    r[0][2], r[1][2], r[2][2], 0,
    -r[0][0], -r[1][0], -r[2][0], 0,
    0, 0, 0, 1,
  );
}

/** Bennett's formula: refraction (degrees) to add to a true altitude (degrees). */
export function refraction(altDeg: number): number {
  if (altDeg < -2) return 0;
  const a = Math.max(altDeg, -1.9);
  return 1.02 / Math.tan((a + 10.3 / (a + 5.11)) * DEG) / 60;
}

/** Relative airmass (Kasten & Young 1989) for an apparent altitude in degrees. */
export function airmass(altDeg: number): number {
  const a = Math.max(altDeg, -1);
  return 1 / (Math.sin(a * DEG) + 0.50572 * Math.pow(a + 6.07995, -1.6364));
}

/** Angular separation in degrees between two vectors. */
export function separation(a: THREE.Vector3, b: THREE.Vector3): number {
  return a.angleTo(b) * RAD;
}

/** GLSL shared by every sky material: refraction and extinction in the world frame. */
export const GLSL_ATMOSPHERE = /* glsl */ `
  uniform float uRefraction;
  // Lift a world-space direction by atmospheric refraction (Bennett).
  vec3 refractDir(vec3 d) {
    float alt = degrees(asin(clamp(d.y, -1.0, 1.0)));
    if (alt < -2.0 || uRefraction < 0.5) return d;
    float a = max(alt, -1.9);
    float R = 1.02 / tan(radians(a + 10.3 / (a + 5.11))) / 60.0;
    float na = radians(alt + R);
    vec2 h = normalize(d.xz + vec2(1e-9));
    return vec3(h.x * cos(na), sin(na), h.y * cos(na));
  }
  float airmassFromY(float y) {
    float a = max(degrees(asin(clamp(y, -1.0, 1.0))), -1.0);
    return 1.0 / (sin(radians(a)) + 0.50572 * pow(a + 6.07995, -1.6364));
  }
`;
