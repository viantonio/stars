/**
 * Shared types for the "As Above" layer: the symbolic traditions that have
 * been read into the sky (Western astrology, Hermetic Qabalah). Everything
 * here is computed from the same real ephemeris as the sky view; the
 * interpretation is tradition, and the UI always labels it as such.
 */

export type ZodiacMode = 'tropical' | 'sidereal';
export type Ayanamsa = 'lahiri' | 'fagan-bradley';
export type HouseSystem = 'placidus' | 'whole-sign' | 'equal';
/** Which attribution of the seven double letters to the planets to use. */
export type LetterTradition = 'golden-dawn' | 'sefer-yetzirah';

export type PointId =
  | 'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune' | 'Pluto'
  | 'NorthNode' | 'SouthNode' | 'Ascendant' | 'Midheaven';

export type AspectType = 'conjunction' | 'sextile' | 'square' | 'trine' | 'opposition';

export interface ChartPoint {
  id: PointId;
  /** Ecliptic longitude in the chosen zodiac, degrees [0, 360). */
  longitude: number;
  /** Ecliptic latitude, degrees (0 for angles and nodes). */
  latitude: number;
  /** Daily motion in longitude, degrees/day (negative = retrograde). */
  speed: number;
  retrograde: boolean;
  /** 0 = Aries … 11 = Pisces. */
  sign: number;
  /** Degrees within the sign [0, 30). */
  degree: number;
  /** House 1..12 (angles report the house they open). */
  house: number;
  /** The IAU constellation physically behind the body (e.g. "Vir"), for planets/luminaries. */
  constellation?: string;
}

export interface Aspect {
  a: PointId;
  b: PointId;
  type: AspectType;
  /** Exact angle of the aspect (0, 60, 90, 120, 180). */
  angle: number;
  /** Deviation from exact, degrees. */
  orb: number;
  applying: boolean;
}

export interface PlanetaryHour {
  /** Ruler of the current hour (Chaldean order). */
  ruler: PointId;
  /** Ruler of the day (the ruler of the first hour after sunrise). */
  dayRuler: PointId;
  /** 1..12 within the day or night. */
  index: number;
  isDay: boolean;
  start: Date;
  end: Date;
}

export interface Chart {
  date: Date;
  lat: number;
  lon: number;
  zodiac: ZodiacMode;
  /** Ayanamsa applied (0 for tropical), degrees. */
  ayanamsa: number;
  houseSystem: HouseSystem;
  points: ChartPoint[];
  /** Twelve house cusps (ecliptic longitude, degrees, in the chosen zodiac). */
  cusps: number[];
  aspects: Aspect[];
  /** Sun above the horizon at the moment of the chart. */
  isDayChart: boolean;
  /** Moon's phase angle 0..360 (0 new, 180 full). */
  moonPhase: number;
  planetaryHour: PlanetaryHour | null;
  /** True obliquity of the ecliptic used, degrees. */
  obliquity: number;
  /** Which ayanamsa the chart was computed with (used for sidereal transits). */
  ayanamsaKind?: Ayanamsa;
  /** Set when the requested house system is undefined at this latitude (Placidus above the polar circles). */
  housesFallback?: 'porphyry';
}
