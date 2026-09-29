/**
 * Ayanamsa: the angle between the tropical zodiac (anchored to the equinox)
 * and a sidereal zodiac (anchored to the stars). It grows by ~50.3″ per year
 * because Earth's axis precesses.
 */
const J2000 = Date.UTC(2000, 0, 1, 12);
const YEAR_MS = 365.25 * 86400e3;
/** General precession in longitude, arcseconds per Julian year (IAU 2006, linear term). */
const PRECESSION = 50.2879;

/** Values at J2000.0 in degrees: Lahiri (Indian Calendar Reform Committee), Fagan–Bradley. */
const AT_J2000 = { lahiri: 23.853, 'fagan-bradley': 24.736 } as const;

export function ayanamsaValue(date: Date, kind: keyof typeof AT_J2000 = 'lahiri'): number {
  const years = (date.getTime() - J2000) / YEAR_MS;
  return AT_J2000[kind] + (PRECESSION * years) / 3600;
}
