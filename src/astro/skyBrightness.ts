/**
 * Sky brightness model. Everything is expressed as V-band surface brightness
 * (mag/arcsec²) or as linear "flux units" where 1.0 == 22 mag/arcsec²
 * (a pristine natural night sky). The renderer tone-maps flux per pixel, so
 * twilight, moonlight, light pollution and the Milky Way all compose
 * physically before being mapped to the screen.
 */

export const magToFlux = (m: number) => Math.pow(10, -0.4 * (m - 22));
export const fluxToMag = (f: number) => 22 - 2.5 * Math.log10(Math.max(f, 1e-12));

/** Zenith brightness at each Bortle class (1..9), mag/arcsec². */
const BORTLE_ZENITH = [21.95, 21.7, 21.35, 20.8, 20.1, 19.3, 18.8, 18.3, 17.8];

/** Natural sky (airglow + zodiacal + integrated starlight) at zenith. */
export const NATURAL_SKY_MAG = 21.95;

export function bortleToZenithMag(bortle: number): number {
  const b = Math.min(9, Math.max(1, bortle));
  const i = Math.floor(b) - 1;
  const f = b - Math.floor(b);
  const a = BORTLE_ZENITH[i];
  const c = BORTLE_ZENITH[Math.min(8, i + 1)];
  return a + (c - a) * f;
}

/** Artificial skyglow flux at zenith for a Bortle class. */
export function lightPollutionFlux(bortle: number): number {
  return Math.max(0, magToFlux(bortleToZenithMag(bortle)) - magToFlux(NATURAL_SKY_MAG));
}

/** Zenith brightness from sunlight/twilight as a function of solar altitude (deg). */
const TWILIGHT: [number, number][] = [
  [-20, 23.5], [-18, 21.9], [-16, 20.6], [-14, 19.1], [-12, 17.4], [-10, 15.4], [-8, 13.3], [-6, 11.2],
  [-4, 9.4], [-2, 7.9], [0, 6.5], [5, 5.0], [10, 4.3], [20, 3.8], [40, 3.4], [90, 3.1],
];

export function twilightFlux(sunAltDeg: number): number {
  if (sunAltDeg <= TWILIGHT[0][0]) return 0;
  for (let i = 1; i < TWILIGHT.length; i++) {
    const [a1, m1] = TWILIGHT[i];
    if (sunAltDeg <= a1) {
      const [a0, m0] = TWILIGHT[i - 1];
      const m = m0 + ((m1 - m0) * (sunAltDeg - a0)) / (a1 - a0);
      return magToFlux(m) * (i === 1 ? (sunAltDeg - a0) / (a1 - a0) : 1);
    }
  }
  return magToFlux(TWILIGHT[TWILIGHT.length - 1][1]);
}

/**
 * Moonlight scattered to the zenith, Krisciunas & Schaefer (1991).
 * @param moonAltDeg altitude of the Moon
 * @param phaseAngleDeg Sun–Moon–Earth angle (0 = full)
 * @param k extinction coefficient (mag/airmass)
 */
export function moonlightFlux(moonAltDeg: number, phaseAngleDeg: number, k = 0.2): number {
  if (moonAltDeg < -2) return 0;
  const alpha = Math.abs(phaseAngleDeg);
  const Istar = Math.pow(10, -0.4 * (3.84 + 0.026 * alpha + 4e-9 * Math.pow(alpha, 4)));
  const rho = 90 - Math.max(moonAltDeg, 0); // separation Moon–zenith
  const cosr = Math.cos((rho * Math.PI) / 180);
  const f = Math.pow(10, 5.36) * (1.06 + cosr * cosr) + Math.pow(10, 6.15 - rho / 40);
  const Zm = Math.min(89.5, 90 - Math.max(moonAltDeg, 0));
  const Xm = 1 / Math.sqrt(1 - 0.96 * Math.pow(Math.sin((Zm * Math.PI) / 180), 2));
  const Xz = 1;
  let Bmoon = f * Istar * Math.pow(10, -0.4 * k * Xm) * (1 - Math.pow(10, -0.4 * k * Xz)); // nanoLamberts
  // Fade smoothly as the Moon crosses the horizon.
  Bmoon *= Math.min(1, (moonAltDeg + 2) / 4);
  if (Bmoon <= 0) return 0;
  const mag = (20.7233 - Math.log(Bmoon / 34.08)) / 0.92104;
  return magToFlux(mag);
}

/** Naked-eye limiting magnitude at the zenith for a sky brightness (Schaefer-style fit). */
export function limitingMagnitude(skyMag: number): number {
  return 7.93 - 5 * Math.log10(Math.pow(10, 4.316 - skyMag / 5) + 1);
}

/**
 * Display luminance (linear, 0..~0.7) for a flux. Brightness perception is
 * roughly logarithmic, so the curve is linear in log-flux across the night
 * range (keeping the Milky Way's ~2× contrast over the airglow visible) and
 * rolls off toward daylight. Mirrors the GLSL `displayFromFlux`.
 */
export function displayFromFlux(flux: number): number {
  const L = Math.log10(Math.max(flux, 1e-3));
  let s = 0.012 + 0.11 * L;
  if (L > 4) s = 0.452 + 0.4 * (1 - Math.exp(-(L - 4) * 0.45));
  s = Math.min(Math.max(s, 0), 0.9) * Math.min(1, Math.max(0, (L + 0.6) / 0.6));
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export const GLSL_DISPLAY = /* glsl */ `
  float displayFromFlux(float f) {
    float L = log(max(f, 1e-3)) / log(10.0);
    float s = 0.012 + 0.11 * L;
    if (L > 4.0) s = 0.452 + 0.4 * (1.0 - exp(-(L - 4.0) * 0.45));
    s = clamp(s, 0.0, 0.9) * clamp((L + 0.6) / 0.6, 0.0, 1.0);
    return s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4);
  }
`;

export interface SkyBrightness {
  sunFlux: number;
  moonFlux: number;
  lightPollution: number;
  natural: number;
  total: number;
  zenithMag: number;
  limitingMag: number;
  /** Extinction coefficient in mag/airmass. */
  extinction: number;
}

export function computeSkyBrightness(p: {
  sunAlt: number;
  moonAlt: number;
  moonPhaseAngle: number;
  bortle: number;
  elevation: number;
  perfectSky: boolean;
}): SkyBrightness {
  // Extinction: cleaner air at altitude, hazier over cities.
  const extinction = p.perfectSky ? 0 : Math.max(0.12, 0.3 - p.elevation / 12000 + (p.bortle - 4) * 0.012);
  const sunFlux = twilightFlux(p.sunAlt);
  const moonFlux = moonlightFlux(p.moonAlt, p.moonPhaseAngle, Math.max(extinction, 0.15));
  const lightPollution = p.perfectSky ? 0 : lightPollutionFlux(p.bortle);
  const natural = magToFlux(NATURAL_SKY_MAG);
  const total = sunFlux + moonFlux + lightPollution + natural;
  const zenithMag = fluxToMag(total);
  return {
    sunFlux,
    moonFlux,
    lightPollution,
    natural,
    total,
    zenithMag,
    limitingMag: limitingMagnitude(zenithMag),
    extinction,
  };
}
