/**
 * Ayanamsa: the angle between the tropical zodiac (anchored to the equinox)
 * and a sidereal zodiac (anchored to the stars). It grows by ~50.3″ per year
 * because Earth's axis precesses.
 *
 * Each ayanamsa is defined by its value at a reference epoch (the same
 * definitions the Swiss Ephemeris uses) and carried to other dates with the
 * IAU 2006 general precession in longitude p_A (Capitaine et al. 2003).
 * The result is the MEAN ayanamsa (no nutation), matching Swiss Ephemeris
 * `swe_get_ayanamsa_ut` to better than 1″ over 1900–2100. To place bodies
 * given in the true equinox of date, add the nutation in longitude Δψ
 * (astrology.ts does this).
 */
const JD_UNIX_EPOCH = 2440587.5;
const JD_J2000 = 2451545.0;

/** Reference epochs (JD, TT) and values (degrees). */
const DEFS = {
  // Indian Calendar Reform Committee (N. C. Lahiri): 23°15′00.658″ at 1956-03-21 0h TT, less the
  // 16.77″ nutation included in that figure → mean value (Swiss Ephemeris SE_SIDM_LAHIRI).
  lahiri: { jd: 2435553.5, value: 23.250182778 - 0.004660222 },
  // Cyril Fagan & Donald Bradley: 24°02′31.36″ at B1950.0 (SE_SIDM_FAGAN_BRADLEY).
  'fagan-bradley': { jd: 2433282.42346, value: 24.042044444 },
} as const;

/** IAU 2006 general precession in longitude, arcseconds, T in Julian centuries TT from J2000. */
function precessionArcsec(T: number): number {
  return ((((-0.0000000383 * T - 0.000023857) * T + 0.00007964) * T + 1.1054348) * T + 5028.796195) * T;
}

/** Mean ayanamsa in degrees for a date (UTC; the ~1 min TT−UT offset is negligible here). */
export function ayanamsaValue(date: Date, kind: keyof typeof DEFS = 'lahiri'): number {
  const def = DEFS[kind];
  const T = (date.getTime() / 86400e3 + JD_UNIX_EPOCH - JD_J2000) / 36525;
  const T0 = (def.jd - JD_J2000) / 36525;
  return def.value + (precessionArcsec(T) - precessionArcsec(T0)) / 3600;
}
