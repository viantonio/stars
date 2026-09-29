/**
 * Annual meteor showers (IMO working list) and simple activity modelling.
 *
 * Solar longitudes are J2000 (as published by the IMO); radiant coordinates are
 * J2000 degrees at the shower peak and drift linearly with solar longitude.
 */
import * as Astronomy from 'astronomy-engine';
import type { SiteLocation } from '../core/locations';

export interface MeteorShower {
  id: string;
  name: string;
  /** IMO three-letter code. */
  code: string;
  /** Solar longitude of maximum (deg, J2000). */
  peakSolarLon: number;
  activeStartLon: number;
  activeEndLon: number;
  /** Radiant right ascension at peak (deg, J2000). */
  radiantRa: number;
  /** Radiant declination at peak (deg, J2000). */
  radiantDec: number;
  /** Radiant drift per degree of solar longitude (deg). */
  radiantDriftRa?: number;
  radiantDriftDec?: number;
  /** Zenithal hourly rate at peak. */
  zhr: number;
  /** Geocentric entry speed (km/s). */
  speedKms: number;
  /** Population index. */
  r: number;
  /** Profile steepness B: ZHR falls as 10^(-B·|Δλ|) before the peak. */
  b: number;
  /** Steepness after the peak, when the profile is asymmetric (defaults to `b`). */
  bFall?: number;
  parent: string;
  description: string;
}

export interface ShowerActivity {
  shower: MeteorShower;
  /** Model ZHR at the given date (0 outside the activity period). */
  zhr: number;
  /** Solar longitude offset from peak (deg, negative before peak). */
  dLon: number;
  /** Radiant position at the given date (deg, J2000). */
  radiantRa: number;
  radiantDec: number;
}

export const METEOR_SHOWERS: MeteorShower[] = [
  {
    id: 'quadrantids', name: 'Quadrantids', code: 'QUA',
    peakSolarLon: 283.15, activeStartLon: 276.0, activeEndLon: 291.5,
    radiantRa: 230, radiantDec: 49, radiantDriftRa: 0.8, radiantDriftDec: -0.2,
    zhr: 80, speedKms: 41, r: 2.1, b: 1.2, parent: '2003 EH1',
    description: 'A short, intense burst radiating from northern Boötes — the peak lasts only a few hours, so timing is everything. Rich in bright fireballs for those who brave the January cold.',
  },
  {
    id: 'lyrids', name: 'Lyrids', code: 'LYR',
    peakSolarLon: 32.32, activeStartLon: 24.0, activeEndLon: 40.0,
    radiantRa: 271, radiantDec: 34, radiantDriftRa: 1.1, radiantDriftDec: 0,
    zhr: 18, speedKms: 49, r: 2.1, b: 0.35, parent: 'C/1861 G1 (Thatcher)',
    description: 'One of the oldest recorded showers, observed for over 2,600 years. Swift meteors near Vega, with occasional surprise outbursts.',
  },
  {
    id: 'eta-aquariids', name: 'η-Aquariids', code: 'ETA',
    peakSolarLon: 45.5, activeStartLon: 29.0, activeEndLon: 67.0,
    radiantRa: 338, radiantDec: -1, radiantDriftRa: 0.9, radiantDriftDec: 0.4,
    zhr: 50, speedKms: 66, r: 2.4, b: 0.08, parent: '1P/Halley',
    description: "Dust from Halley's Comet striking at 66 km/s. From California the radiant rises only shortly before dawn, favouring long 'earthgrazers'.",
  },
  {
    id: 'southern-delta-aquariids', name: 'Southern δ-Aquariids', code: 'SDA',
    peakSolarLon: 127.0, activeStartLon: 110.0, activeEndLon: 150.0,
    radiantRa: 340, radiantDec: -16, radiantDriftRa: 0.8, radiantDriftDec: 0.18,
    zhr: 25, speedKms: 41, r: 2.5, b: 0.09, parent: '96P/Machholz (probable)',
    description: 'A steady, long-lasting summer shower of mostly faint meteors from low in the south. Pairs nicely with the early Perseids on warm late-July nights.',
  },
  {
    id: 'alpha-capricornids', name: 'α-Capricornids', code: 'CAP',
    peakSolarLon: 127.0, activeStartLon: 101.0, activeEndLon: 142.0,
    radiantRa: 307, radiantDec: -10, radiantDriftRa: 0.54, radiantDriftDec: 0.25,
    zhr: 5, speedKms: 23, r: 2.5, b: 0.07, parent: '169P/NEAT',
    description: 'Few in number but famously slow and often bright — yellowish fireballs that seem to crawl across the sky.',
  },
  {
    id: 'perseids', name: 'Perseids', code: 'PER',
    peakSolarLon: 140.0, activeStartLon: 115.0, activeEndLon: 151.0,
    radiantRa: 48, radiantDec: 58, radiantDriftRa: 1.35, radiantDriftDec: 0.25,
    zhr: 100, speedKms: 59, r: 2.2, b: 0.2, bFall: 0.35, parent: '109P/Swift–Tuttle',
    description: 'The summer favourite: fast, bright meteors, many leaving glowing trains. The radiant in Perseus climbs all night, so rates build toward dawn.',
  },
  {
    id: 'kappa-cygnids', name: 'κ-Cygnids', code: 'KCG',
    peakSolarLon: 145.0, activeStartLon: 131.0, activeEndLon: 152.0,
    radiantRa: 286, radiantDec: 59, radiantDriftRa: 0.6, radiantDriftDec: 0.3,
    zhr: 3, speedKms: 25, r: 3.0, b: 0.1, parent: '2008 ED69 (proposed)',
    description: 'A minor shower of slow, sometimes brilliant meteors from high overhead near Cygnus and Draco, overlapping the Perseids.',
  },
  {
    id: 'draconids', name: 'Draconids', code: 'DRA',
    peakSolarLon: 195.4, activeStartLon: 193.0, activeEndLon: 197.0,
    radiantRa: 262, radiantDec: 54, radiantDriftRa: 0, radiantDriftDec: 0,
    zhr: 10, speedKms: 20, r: 2.6, b: 1.0, parent: '21P/Giacobini–Zinner',
    description: 'An unpredictable early-evening shower of very slow meteors. Usually quiet, but it has produced storms of thousands per hour.',
  },
  {
    id: 'southern-taurids', name: 'Southern Taurids', code: 'STA',
    peakSolarLon: 197.0, activeStartLon: 167.0, activeEndLon: 238.0,
    radiantRa: 32, radiantDec: 9, radiantDriftRa: 0.8, radiantDriftDec: 0.3,
    zhr: 5, speedKms: 27, r: 2.3, b: 0.03, parent: '2P/Encke',
    description: 'A weeks-long trickle of slow, bright meteors from Comet Encke, known for autumn fireballs.',
  },
  {
    id: 'orionids', name: 'Orionids', code: 'ORI',
    peakSolarLon: 208.0, activeStartLon: 189.0, activeEndLon: 225.0,
    radiantRa: 95, radiantDec: 16, radiantDriftRa: 0.7, radiantDriftDec: 0.1,
    zhr: 20, speedKms: 66, r: 2.5, b: 0.12, parent: '1P/Halley',
    description: "Halley's Comet's second shower of the year. Swift meteors from near Orion's raised club, best in the hours before dawn.",
  },
  {
    id: 'leonis-minorids', name: 'Leonis Minorids', code: 'LMI',
    peakSolarLon: 211.0, activeStartLon: 206.0, activeEndLon: 214.0,
    radiantRa: 162, radiantDec: 37, radiantDriftRa: 1.0, radiantDriftDec: -0.4,
    zhr: 2, speedKms: 62, r: 3.0, b: 0.3, parent: 'C/1739 K1 (Zanotti)',
    description: 'A faint minor shower of fast meteors, a bonus for Orionid watchers in the pre-dawn hours.',
  },
  {
    id: 'northern-taurids', name: 'Northern Taurids', code: 'NTA',
    peakSolarLon: 230.0, activeStartLon: 207.0, activeEndLon: 258.0,
    radiantRa: 58, radiantDec: 22, radiantDriftRa: 0.8, radiantDriftDec: 0.2,
    zhr: 5, speedKms: 29, r: 2.3, b: 0.03, parent: '2P/Encke',
    description: 'The northern branch of the Taurid complex: low rates but a good chance of a slow, bright fireball on November nights.',
  },
  {
    id: 'leonids', name: 'Leonids', code: 'LEO',
    peakSolarLon: 235.27, activeStartLon: 223.0, activeEndLon: 248.0,
    radiantRa: 152, radiantDec: 22, radiantDriftRa: 0.7, radiantDriftDec: -0.42,
    zhr: 10, speedKms: 71, r: 2.5, b: 0.4, parent: '55P/Tempel–Tuttle',
    description: "The fastest meteors of the year, streaking from the Lion's Sickle. Famous for the great storms of 1833, 1966 and 2001.",
  },
  {
    id: 'geminids', name: 'Geminids', code: 'GEM',
    peakSolarLon: 262.2, activeStartLon: 252.0, activeEndLon: 268.0,
    radiantRa: 112, radiantDec: 33, radiantDriftRa: 1.0, radiantDriftDec: -0.15,
    zhr: 150, speedKms: 35, r: 2.6, b: 0.39, bFall: 0.81, parent: '3200 Phaethon',
    description: "The year's richest shower: bright, often colourful meteors from the rock-comet Phaethon. The radiant near Castor is up by mid-evening.",
  },
  {
    id: 'ursids', name: 'Ursids', code: 'URS',
    peakSolarLon: 270.7, activeStartLon: 265.0, activeEndLon: 274.0,
    radiantRa: 217, radiantDec: 76, radiantDriftRa: 0, radiantDriftDec: 0,
    zhr: 10, speedKms: 33, r: 3.0, b: 0.6, parent: '8P/Tuttle',
    description: 'A modest solstice shower radiating from near the Little Dipper, circumpolar from California so it can be watched all night.',
  },
];

/** Signed difference a − b wrapped to (−180, 180]. */
function wrap180(deg: number): number {
  const x = ((deg + 180) % 360 + 360) % 360 - 180;
  return x === -180 ? 180 : x;
}

/** General precession in longitude since J2000 (deg). */
function precessionSinceJ2000(time: Astronomy.AstroTime): number {
  const t = time.tt / 36525;
  return (5028.796195 * t + 1.1054348 * t * t) / 3600;
}

/** Apparent solar longitude referred to the J2000 equinox (deg, [0, 360)). */
export function solarLongitudeJ2000(date: Date): number {
  const time = Astronomy.MakeTime(date);
  const lon = Astronomy.SunPosition(time).elon - precessionSinceJ2000(time);
  return ((lon % 360) + 360) % 360;
}

/** Activity of a shower at `date`: model ZHR and drifted radiant. */
export function showerActivity(shower: MeteorShower, date: Date): ShowerActivity {
  const lon = solarLongitudeJ2000(date);
  const dLon = wrap180(lon - shower.peakSolarLon);
  const fromStart = wrap180(lon - shower.activeStartLon);
  const toEnd = wrap180(shower.activeEndLon - lon);
  const active = dLon <= 0 ? fromStart >= 0 : toEnd >= 0;
  const b = dLon > 0 ? (shower.bFall ?? shower.b) : shower.b;
  const zhr = active ? shower.zhr * Math.pow(10, -b * Math.abs(dLon)) : 0;
  return {
    shower,
    zhr,
    dLon,
    radiantRa: (((shower.radiantRa + (shower.radiantDriftRa ?? 0) * dLon) % 360) + 360) % 360,
    radiantDec: shower.radiantDec + (shower.radiantDriftDec ?? 0) * dLon,
  };
}

/** Showers active at `date`, strongest first. */
export function activeShowers(date: Date): ShowerActivity[] {
  return METEOR_SHOWERS.map((s) => showerActivity(s, date))
    .filter((a) => a.zhr > 0)
    .sort((a, b) => b.zhr - a.zhr);
}

/** Altitude (deg, refracted) of a J2000 RA/Dec (deg) seen from the site. */
export function radiantAltitude(raDeg: number, decDeg: number, date: Date, site: Pick<SiteLocation, 'lat' | 'lon' | 'elevation'>): number {
  const time = Astronomy.MakeTime(date);
  const observer = new Astronomy.Observer(site.lat, site.lon, site.elevation);
  const eqj = Astronomy.VectorFromSphere(new Astronomy.Spherical(decDeg, raDeg, 1), time);
  const hor = Astronomy.RotateVector(Astronomy.Rotation_EQJ_HOR(time, observer), eqj);
  return Astronomy.HorizonFromVector(hor, 'normal').lat;
}

/**
 * Visual hourly rate an observer can expect: ZHR · sin(h) · r^(lm − 6.5),
 * where h is the radiant altitude. Zero when the radiant is below the horizon.
 */
export function expectedHourlyRate(
  shower: MeteorShower,
  date: Date,
  site: Pick<SiteLocation, 'lat' | 'lon' | 'elevation'>,
  limitingMag = 6.5,
): number {
  const act = showerActivity(shower, date);
  if (act.zhr <= 0) return 0;
  const alt = radiantAltitude(act.radiantRa, act.radiantDec, date, site);
  if (alt <= 0) return 0;
  return act.zhr * Math.sin(alt * Astronomy.DEG2RAD) * Math.pow(shower.r, limitingMag - 6.5);
}

/** Date of the shower's peak (Sun reaching `peakSolarLon`) in the given UTC year. */
export function showerPeakDate(shower: MeteorShower, year: number): Date {
  const start = Astronomy.MakeTime(new Date(Date.UTC(year, 0, 1)));
  const target = (shower.peakSolarLon + precessionSinceJ2000(start.AddDays(182))) % 360;
  const t = Astronomy.SearchSunLongitude(target, start, 366);
  if (!t) throw new Error(`No peak found for ${shower.name} in ${year}`);
  return t.date;
}

/** Typical naked-eye limiting magnitude for a Bortle class. */
export function limitingMagnitudeForBortle(bortle: number): number {
  const table = [7.6, 7.1, 6.6, 6.2, 5.9, 5.5, 5.0, 4.5, 4.0];
  return table[Math.min(8, Math.max(0, Math.round(bortle) - 1))];
}
