/**
 * Astronomical events calendar and the "tonight" observing summary.
 *
 * Pure computation on top of astronomy-engine. All times are UTC instants;
 * human-readable descriptions quote local times in the site's time zone.
 */
import * as A from 'astronomy-engine';
import type { SiteLocation } from '../core/locations';
import {
  METEOR_SHOWERS,
  expectedHourlyRate,
  limitingMagnitudeForBortle,
  showerActivity,
  showerPeakDate,
} from './meteors';

export type EventKind =
  | 'moon-phase'
  | 'lunar-eclipse'
  | 'solar-eclipse'
  | 'opposition'
  | 'solar-conjunction'
  | 'elongation'
  | 'peak-brightness'
  | 'conjunction'
  | 'planet-parade'
  | 'season'
  | 'meteor-shower';

export interface SkyEvent {
  /** Deterministic id (kind + subject + UTC minute). */
  id: string;
  kind: EventKind;
  /** Key moment: peak, exact phase, or the start of a multi-day window. */
  date: Date;
  /** End of a multi-day window (planet parades). */
  endDate?: Date;
  title: string;
  subtitle: string;
  description: string;
  /** 3 = don't miss, 2 = worth a look, 1 = informational. */
  importance: 1 | 2 | 3;
  /** Whether it can be seen from the site; null when not applicable. */
  visibleFromSite: boolean | null;
  /** astronomy-engine Body names, or star names such as 'Regulus' / 'Pleiades'. */
  bodies: string[];
  /** What to point the view at: a body, or J2000 RA (hours) / Dec (deg). */
  focus?: { body?: string; ra?: number; dec?: number };
}

export interface TimeInterval {
  start: Date;
  end: Date;
}

export interface PlanetVisibility {
  body: string;
  /** Rise/set bracketing tonight's appearance (rise may precede sunset). */
  rise: Date | null;
  transit: Date | null;
  set: Date | null;
  mag: number;
  constellation: string;
  /** Angular distance from the Sun (deg). */
  elongation: number;
  /** Highest altitude while the sky is dark enough for this planet's brightness (deg). */
  altitudeAtBest: number;
  bestTime: Date | null;
  /** At least 5° up at some point while the sky is dark enough to show it. */
  visibleTonight: boolean;
  note: string;
}

export interface MoonTonight {
  rise: Date | null;
  set: Date | null;
  /** Ecliptic phase angle: 0 new, 90 first quarter, 180 full, 270 last quarter. */
  phaseAngle: number;
  /** Illuminated fraction 0–1. */
  illumination: number;
  /** Days since the previous new moon. */
  ageDays: number;
  phaseName: string;
  nextNewMoon: Date;
  nextFullMoon: Date;
}

export interface SkyQuality {
  /** 0 (hopeless) – 100 (pristine, moonless). */
  score: number;
  label: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Very poor';
  /** Hours of astronomical darkness tonight. */
  darkHours: number;
  /** Hours the Moon is above the horizon during astronomical darkness. */
  moonUpHours: number;
}

export interface Tonight {
  /** Local noon that starts this observing night. */
  noon: Date;
  sunset: Date | null;
  sunrise: Date | null;
  civilDusk: Date | null;
  nauticalDusk: Date | null;
  astronomicalDusk: Date | null;
  astronomicalDawn: Date | null;
  nauticalDawn: Date | null;
  civilDawn: Date | null;
  moon: MoonTonight;
  /** Astronomical darkness with the Moon below the horizon (the "Milky Way window"). */
  darkWindow: TimeInterval[];
  planets: PlanetVisibility[];
  skyQuality: SkyQuality;
}

const B = A.Body;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Minimum altitude (deg) for something to count as observable. */
const MIN_ALT = 5;
/** Minimum solar elongation (deg) for something to be seen outside the glare. */
const MIN_ELONGATION = 15;
/** Sampling step for tonight's altitude tracks. */
const NIGHT_STEP_MINUTES = 10;

const NAKED_EYE_PLANETS = [B.Mercury, B.Venus, B.Mars, B.Jupiter, B.Saturn];
const ALL_PLANETS = [...NAKED_EYE_PLANETS, B.Uranus, B.Neptune];

// ---------------------------------------------------------------------------
// Time and text helpers

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string, style: 'time' | 'day' | 'parts'): Intl.DateTimeFormat {
  const key = `${timeZone}|${style}`;
  let f = formatters.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions =
      style === 'time'
        ? { hour: 'numeric', minute: '2-digit' }
        : style === 'day'
          ? { weekday: 'short', month: 'short', day: 'numeric' }
          : { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' };
    f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone });
    formatters.set(key, f);
  }
  return f;
}

const fmtTime = (d: Date, tz: string) => formatter(tz, 'time').format(d);
const fmtDay = (d: Date, tz: string) => formatter(tz, 'day').format(d);

function localParts(d: Date, tz: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const out: Record<string, number> = {};
  for (const p of formatter(tz, 'parts').formatToParts(d)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second };
}

/** Local noon of the observing day containing `date` (days switch over at local noon). */
export function observingNoon(date: Date, tz: string): Date {
  const p = localParts(date, tz);
  const noonAsUtc = Date.UTC(p.year, p.month - 1, p.day - (p.hour < 12 ? 1 : 0), 12);
  const q = localParts(new Date(noonAsUtc), tz);
  const offset = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - noonAsUtc;
  return new Date(noonAsUtc - offset);
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const compass = (az: number) => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8];
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const deg = (x: number) => `${x.toFixed(1)}°`;
const idStamp = (d: Date) => d.toISOString().slice(0, 16);

function listText(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Geometry helpers

/** A body or a fixed J2000 point (RA hours, Dec degrees). */
interface Target {
  name: string;
  label: string;
  body?: A.Body;
  ra?: number;
  dec?: number;
}

const bodyTarget = (body: A.Body): Target => ({ name: body, label: body === B.Moon ? 'the Moon' : body, body });

const STARS: Target[] = [
  { name: 'Regulus', label: 'Regulus', ra: 10.1395, dec: 11.967 },
  { name: 'Spica', label: 'Spica', ra: 13.4199, dec: -11.161 },
  { name: 'Antares', label: 'Antares', ra: 16.4901, dec: -26.432 },
  { name: 'Aldebaran', label: 'Aldebaran', ra: 4.5987, dec: 16.509 },
  { name: 'Pollux', label: 'Pollux', ra: 7.7553, dec: 28.026 },
  { name: 'Pleiades', label: 'the Pleiades', ra: 3.7914, dec: 24.105 },
];

const observerFor = (site: SiteLocation) => new A.Observer(site.lat, site.lon, site.elevation);

/** Geocentric J2000 direction vector of a target. */
function geoVector(t: Target, time: A.AstroTime): A.Vector {
  if (t.body) return A.GeoVector(t.body, time, true);
  return A.VectorFromSphere(new A.Spherical(t.dec!, t.ra! * 15, 1), time);
}

/** Refracted topocentric altitude/azimuth (deg). */
function horizontal(t: Target, time: A.AstroTime, observer: A.Observer): { alt: number; az: number } {
  if (t.body) {
    const eq = A.Equator(t.body, time, observer, true, true);
    const h = A.Horizon(time, observer, eq.ra, eq.dec, 'normal');
    return { alt: h.altitude, az: h.azimuth };
  }
  const s = A.HorizonFromVector(A.RotateVector(A.Rotation_EQJ_HOR(time, observer), geoVector(t, time)), 'normal');
  return { alt: s.lat, az: s.lon };
}

/** J2000 ecliptic longitude (deg) of an EQJ vector. */
const eclipticLon = (v: A.Vector) => A.SphereFromVector(A.RotateVector(A.Rotation_EQJ_ECL(), v)).lon;

const constellationOf = (body: A.Body, time: A.AstroTime, observer: A.Observer) => {
  const eq = A.Equator(body, time, observer, false, true);
  return A.Constellation(eq.ra, eq.dec).name;
};

/** Golden-section minimisation of f on [a, b] (ms timestamps). */
function minimize(f: (ms: number) => number, a: number, b: number, tol = 60_000): { t: number; value: number } {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (b - a > tol) {
    if (fc < fd) {
      b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c);
    } else {
      a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d);
    }
  }
  const t = (a + b) / 2;
  return { t, value: f(t) };
}

// ---------------------------------------------------------------------------
// "Where to look" from the site

interface SkySpot {
  time: Date;
  /** Lowest altitude among the tracked targets (deg). */
  alt: number;
  /** Azimuth of the first target (deg). */
  az: number;
}

/** Samples the targets' altitude every `stepMinutes` from `from` to `to` inclusive. */
function track(targets: Target[], from: Date, to: Date, observer: A.Observer, stepMinutes: number): SkySpot[] {
  const spots: SkySpot[] = [];
  const end = to.getTime();
  for (let ms = from.getTime(); ; ms = Math.min(ms + stepMinutes * 60_000, end)) {
    const time = A.MakeTime(new Date(ms));
    const pos = targets.map((t) => horizontal(t, time, observer));
    spots.push({ time: time.date, alt: Math.min(...pos.map((p) => p.alt)), az: pos[0].az });
    if (ms >= end) break;
  }
  return spots;
}

const highest = (spots: SkySpot[]): SkySpot | null => spots.reduce<SkySpot | null>((a, b) => (!a || b.alt > a.alt ? b : a), null);

/**
 * Track from civil dusk to civil dawn of the night containing `date`, or of the
 * nearer of the two nights around it when `date` falls in daytime.
 */
function nightTrack(targets: Target[], date: Date, observer: A.Observer, stepMinutes = 20): SkySpot[] {
  const duskAfter = (t: Date, days: number) => A.SearchAltitude(B.Sun, observer, -1, t, days, -6);
  const dawnAfter = (t: A.AstroTime) => A.SearchAltitude(B.Sun, observer, +1, t, 1, -6);
  let dusk = duskAfter(date, -1);
  let dawn = dusk && dawnAfter(dusk);
  if (dawn && date > dawn.date) {
    const next = duskAfter(date, 1);
    if (next && next.date.getTime() - date.getTime() < date.getTime() - dawn.date.getTime()) {
      dusk = next;
      dawn = dawnAfter(next);
    }
  }
  return dusk && dawn ? track(targets, dusk.date, dawn.date, observer, stepMinutes) : [];
}

const isVisible = (spots: SkySpot[]) => (highest(spots)?.alt ?? -90) >= MIN_ALT;
const heightWord = (alt: number) => (alt < 15 ? 'low ' : alt > 60 ? 'high ' : '');

/** One friendly sentence on when and where to look during a tracked night. */
function whereToLook(spots: SkySpot[], site: SiteLocation): string {
  const tz = site.timeZone;
  const best = highest(spots);
  if (!best || best.alt < MIN_ALT) return `Unfortunately it stays too low or too deep in twilight to see from ${site.name}.`;
  const first = spots[0];
  const last = spots[spots.length - 1];
  const up = `${Math.round(best.alt)}° up`;
  if (best === first || best === last) {
    return `From ${site.name}, look ${heightWord(best.alt)}in the ${compass(best.az)} ${best === first ? 'after dusk' : 'before dawn'} — about ${up} at ${fmtTime(best.time, tz)}.`;
  }
  if (first.alt > 0 && last.alt > 0) {
    return `From ${site.name} it's up all night, highest in the ${compass(best.az)} around ${fmtTime(best.time, tz)} (${up}).`;
  }
  return `From ${site.name} it's best around ${fmtTime(best.time, tz)}, ${up} in the ${compass(best.az)}.`;
}

// ---------------------------------------------------------------------------
// Moon phases

const MONTH_MOONS = ['Wolf', 'Snow', 'Worm', 'Pink', 'Flower', 'Strawberry', 'Buck', 'Sturgeon', 'Corn', "Hunter's", 'Beaver', 'Cold'];

const harvestCache = new Map<number, Date>();
/** The full moon closest to the September equinox of `year`. */
function harvestMoon(year: number): Date {
  let h = harvestCache.get(year);
  if (!h) {
    const eq = A.Seasons(year).sep_equinox;
    const before = A.SearchMoonPhase(180, eq, -30)!.date;
    const after = A.SearchMoonPhase(180, eq, 30)!.date;
    h = eq.date.getTime() - before.getTime() < after.getTime() - eq.date.getTime() ? before : after;
    harvestCache.set(year, h);
  }
  return h;
}

/** Traditional name for a full moon; months are taken in the site's time zone. */
function fullMoonName(date: Date, tz: string): string {
  const { year, month } = localParts(date, tz);
  const harvest = harvestMoon(year);
  if (Math.abs(date.getTime() - harvest.getTime()) < DAY) return 'Harvest Moon';
  const hunter = A.SearchMoonPhase(180, new Date(harvest.getTime() + DAY), 35)!.date;
  if (Math.abs(date.getTime() - hunter.getTime()) < DAY) return "Hunter's Moon";
  return `${MONTH_MOONS[month - 1]} Moon`;
}

function lunarApsides(start: Date, end: Date): A.Apsis[] {
  const out: A.Apsis[] = [];
  for (let ap = A.SearchLunarApsis(new Date(start.getTime() - 20 * DAY)); ap.time.date.getTime() < end.getTime() + 20 * DAY; ap = A.NextLunarApsis(ap)) {
    out.push(ap);
  }
  return out;
}

function nearestApsis(apsides: A.Apsis[], kind: A.ApsisKind, date: Date): A.Apsis {
  return apsides
    .filter((a) => a.kind === kind)
    .reduce((a, b) => (Math.abs(b.time.date.getTime() - date.getTime()) < Math.abs(a.time.date.getTime() - date.getTime()) ? b : a));
}

function moonPhaseEvents(site: SiteLocation, start: Date, end: Date): SkyEvent[] {
  const tz = site.timeZone;
  const observer = observerFor(site);
  const apsides = lunarApsides(start, end);
  const events: SkyEvent[] = [];
  for (let mq = A.SearchMoonQuarter(start); mq.time.date <= end; mq = A.NextMoonQuarter(mq)) {
    const date = mq.time.date;
    const at = `${fmtTime(date, tz)} ${fmtDay(date, tz)}`;
    const base = { date, bodies: [B.Moon as string], focus: { body: B.Moon as string }, visibleFromSite: null };
    if (mq.quarter === 0) {
      events.push({
        ...base, id: `moon-new-${idStamp(date)}`, kind: 'moon-phase', importance: 1,
        title: 'New Moon', subtitle: `Dark skies · ${at}`,
        description: `The Moon passes between Earth and Sun and vanishes from the night sky. The nights around now are the darkest of the month — ideal for the Milky Way and faint galaxies from ${site.name}.`,
      });
    } else if (mq.quarter === 1) {
      const set = A.SearchRiseSet(B.Moon, observer, -1, date, 1.2);
      events.push({
        ...base, id: `moon-first-quarter-${idStamp(date)}`, kind: 'moon-phase', importance: 1,
        title: 'First Quarter Moon', subtitle: `Half-lit, evening sky · ${at}`,
        description: `The Moon is half-lit and high in the south at dusk${set ? `, setting around ${fmtTime(set.date, tz)}` : ''}. Crater shadows along the terminator look dramatic in binoculars or a small telescope.`,
      });
    } else if (mq.quarter === 3) {
      const rise = A.SearchRiseSet(B.Moon, observer, +1, new Date(date.getTime() - 12 * HOUR), 1.2);
      events.push({
        ...base, id: `moon-last-quarter-${idStamp(date)}`, kind: 'moon-phase', importance: 1,
        title: 'Last Quarter Moon', subtitle: `Half-lit, morning sky · ${at}`,
        description: `The half-lit Moon ${rise ? `rises around ${fmtTime(rise.date, tz)}` : 'rises around midnight'} and rides high in the south at dawn, leaving the evening sky dark.`,
      });
    } else {
      events.push(fullMoonEvent(site, observer, date, apsides));
    }
  }
  return events;
}

function fullMoonEvent(site: SiteLocation, observer: A.Observer, date: Date, apsides: A.Apsis[]): SkyEvent {
  const tz = site.timeZone;
  const prev = A.SearchMoonPhase(180, new Date(date.getTime() - 31 * DAY), 4)!.date;
  const here = localParts(date, tz);
  const there = localParts(prev, tz);
  const blue = here.year === there.year && here.month === there.month;
  const name = blue ? 'Blue Moon' : fullMoonName(date, tz);

  // Supermoon/micromoon (Nolle): within 10% of the perigee–apogee range of the nearest extreme.
  const distKm = A.GeoMoon(date).Length() * A.KM_PER_AU;
  const perigee = nearestApsis(apsides, A.ApsisKind.Pericenter, date);
  const apogee = nearestApsis(apsides, A.ApsisKind.Apocenter, date);
  const range = apogee.dist_km - perigee.dist_km;
  const size = distKm <= perigee.dist_km + 0.1 * range ? 'super' : distKm >= apogee.dist_km - 0.1 * range ? 'micro' : null;

  const rise = A.SearchRiseSet(B.Moon, observer, +1, new Date(date.getTime() - 18 * HOUR), 1.5);
  const extras: string[] = [];
  if (name === 'Harvest Moon') extras.push('As the full moon nearest the autumn equinox, it rises only a little later each evening, lighting the fields for the harvest.');
  if (blue) extras.push('It is the second full moon this calendar month.');
  if (size === 'super') {
    const hours = Math.round(Math.abs(perigee.time.date.getTime() - date.getTime()) / HOUR);
    extras.push(`At ${Math.round(distKm).toLocaleString('en-US')} km it's a supermoon, ${hours} hours from perigee — slightly larger and brighter than average.`);
  } else if (size === 'micro') {
    extras.push(`At ${Math.round(distKm).toLocaleString('en-US')} km, near apogee, it's the year's smaller "micromoon".`);
  }
  return {
    id: `moon-full-${idStamp(date)}`,
    kind: 'moon-phase',
    date,
    title: size ? `${name} · ${size === 'super' ? 'Supermoon' : 'Micromoon'}` : name,
    subtitle: `Full Moon · ${fmtTime(date, tz)} ${fmtDay(date, tz)}`,
    description: [
      `The ${name} ${rise ? `rises in the east around ${fmtTime(rise.date, tz)} (${fmtDay(rise.date, tz)})` : 'rises in the east around sunset'} and shines all night.`,
      ...extras,
    ].join(' '),
    importance: size === 'super' || blue || name === 'Harvest Moon' ? 2 : 1,
    visibleFromSite: null,
    bodies: [B.Moon],
    focus: { body: B.Moon },
  };
}

// ---------------------------------------------------------------------------
// Eclipses

function lunarEclipseEvents(site: SiteLocation, start: Date, end: Date): SkyEvent[] {
  const tz = site.timeZone;
  const observer = observerFor(site);
  const moon = bodyTarget(B.Moon);
  const events: SkyEvent[] = [];
  for (let e = A.SearchLunarEclipse(start); e.peak.date <= end; e = A.NextLunarEclipse(e.peak)) {
    const peak = e.peak.date;
    const at = (minutes: number) => new Date(peak.getTime() + minutes * 60_000);
    const altAt = (d: Date) => horizontal(moon, A.MakeTime(d), observer).alt;
    const pos = horizontal(moon, e.peak, observer);
    const visible = pos.alt > 0;
    const kind = e.kind === A.EclipseKind.Total ? 'Total' : e.kind === A.EclipseKind.Partial ? 'Partial' : 'Penumbral';
    const parts: string[] = [];
    if (e.kind === A.EclipseKind.Total) {
      parts.push(`The Moon turns coppery red for ${Math.round(2 * e.sd_total)} minutes of totality, from ${fmtTime(at(-e.sd_total), tz)} to ${fmtTime(at(e.sd_total), tz)}; the partial phases begin at ${fmtTime(at(-e.sd_partial), tz)}.`);
    } else if (e.kind === A.EclipseKind.Partial) {
      parts.push(`At its peak Earth's dark umbra covers ${Math.round(e.obscuration * 100)}% of the Moon; the partial phase lasts ${Math.round(2 * e.sd_partial)} minutes, from ${fmtTime(at(-e.sd_partial), tz)} to ${fmtTime(at(e.sd_partial), tz)}.`);
    } else {
      parts.push(`Only Earth's faint outer shadow touches the Moon, causing a subtle dusky shading over ${Math.round(2 * e.sd_penum)} minutes.`);
    }
    if (visible) {
      parts.push(`From ${site.name} the Moon is ${Math.round(pos.alt)}° up in the ${compass(pos.az)} at mid-eclipse (${fmtTime(peak, tz)}).`);
      const edge = e.sd_partial || e.sd_penum;
      if (altAt(at(-edge)) < 0) parts.push('The Moon rises with the eclipse already under way.');
      else if (altAt(at(edge)) < 0) parts.push('The Moon sets before the eclipse ends.');
    } else {
      parts.push(`The Moon is below the horizon from ${site.name} at mid-eclipse.`);
    }
    const importance = !visible || e.kind === A.EclipseKind.Penumbral ? 1 : e.kind === A.EclipseKind.Total ? 3 : 2;
    events.push({
      id: `lunar-eclipse-${idStamp(peak)}`,
      kind: 'lunar-eclipse',
      date: peak,
      title: `${kind} Lunar Eclipse`,
      subtitle: `${visible ? 'Visible' : 'Not visible'} from ${site.name} · peak ${fmtTime(peak, tz)} ${fmtDay(peak, tz)}`,
      description: parts.join(' '),
      importance,
      visibleFromSite: visible,
      bodies: [B.Moon],
      focus: { body: B.Moon },
    });
  }
  return events;
}

function solarEclipseEvents(site: SiteLocation, start: Date, end: Date): SkyEvent[] {
  const tz = site.timeZone;
  const observer = observerFor(site);
  const locals: A.LocalSolarEclipseInfo[] = [];
  for (
    let le = A.SearchLocalSolarEclipse(new Date(start.getTime() - 2 * DAY), observer);
    le.peak.time.date.getTime() <= end.getTime() + 2 * DAY;
    le = A.NextLocalSolarEclipse(le.peak.time, observer)
  ) {
    locals.push(le);
  }
  const events: SkyEvent[] = [];
  for (let g = A.SearchGlobalSolarEclipse(start); g.peak.date <= end; g = A.NextGlobalSolarEclipse(g.peak)) {
    const peak = g.peak.date;
    const local = locals.find((l) => Math.abs(l.peak.time.date.getTime() - peak.getTime()) < DAY);
    const visible = !!local && [local.partial_begin, local.peak, local.partial_end].some((ev) => ev.altitude > 0);
    const kind = capitalize(g.kind);
    let description: string;
    let importance: 1 | 2 | 3;
    if (local && visible) {
      const central = local.kind === A.EclipseKind.Total || local.kind === A.EclipseKind.Annular;
      description = [
        central
          ? `${site.name} lies in the path of the ${local.kind} eclipse!`
          : `From ${site.name} the Moon covers ${Math.round(local.obscuration * 100)}% of the Sun's disc at ${fmtTime(local.peak.time.date, tz)}, with the Sun ${Math.round(local.peak.altitude)}° up.`,
        `The eclipse runs from ${fmtTime(local.partial_begin.time.date, tz)} to ${fmtTime(local.partial_end.time.date, tz)}. Never look at the Sun without certified eclipse glasses or a proper solar filter.`,
      ].join(' ');
      importance = central || local.obscuration > 0.2 ? 3 : 2;
    } else {
      const where = g.latitude !== undefined && g.longitude !== undefined
        ? ` Greatest eclipse occurs near ${Math.abs(g.latitude).toFixed(0)}°${g.latitude >= 0 ? 'N' : 'S'}, ${Math.abs(g.longitude).toFixed(0)}°${g.longitude >= 0 ? 'E' : 'W'}.`
        : '';
      description = `A${g.kind === A.EclipseKind.Annular ? 'n' : ''} ${g.kind} solar eclipse, seen from elsewhere on Earth.${where} It is not visible from ${site.name}.`;
      importance = g.kind === A.EclipseKind.Total ? 2 : 1;
    }
    events.push({
      id: `solar-eclipse-${idStamp(peak)}`,
      kind: 'solar-eclipse',
      date: local && visible ? local.peak.time.date : peak,
      title: `${kind} Solar Eclipse`,
      subtitle: visible && local
        ? `${Math.round(local.obscuration * 100)}% of the Sun covered from ${site.name}`
        : `Not visible from ${site.name}`,
      description,
      importance,
      visibleFromSite: visible,
      bodies: [B.Sun, B.Moon],
      focus: { body: B.Sun },
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Planet–Sun geometry: oppositions, conjunctions, elongations, brightness

function planetSunEvents(site: SiteLocation, start: Date, end: Date): SkyEvent[] {
  const observer = observerFor(site);
  const events: SkyEvent[] = [];
  const each = (body: A.Body, relLon: number, emit: (time: A.AstroTime) => void) => {
    for (let t = A.SearchRelativeLongitude(body, relLon, start); t.date <= end; t = A.SearchRelativeLongitude(body, relLon, t.AddDays(1))) emit(t);
  };

  for (const body of [B.Mars, B.Jupiter, B.Saturn, B.Uranus, B.Neptune]) {
    each(body, 0, (time) => {
      const illum = A.Illumination(body, time);
      const constellation = constellationOf(body, time, observer);
      const view = nightTrack([bodyTarget(body)], time.date, observer);
      const optics = body === B.Uranus ? ' Binoculars show it as a faint blue-green star.' : body === B.Neptune ? ' You will need a telescope to spot it.' : '';
      events.push({
        id: `opposition-${body}-${idStamp(time.date)}`,
        kind: 'opposition',
        date: time.date,
        title: `${body} at Opposition`,
        subtitle: `Mag ${illum.mag.toFixed(1)} in ${constellation}`,
        description: `${body} is opposite the Sun, rising at sunset and shining all night at magnitude ${illum.mag.toFixed(1)} in ${constellation}, ${(illum.geo_dist * A.KM_PER_AU / 1e6).toFixed(0)} million km away — its best of the year. ${whereToLook(view, site)}${optics}`,
        importance: body === B.Uranus || body === B.Neptune ? 1 : 2,
        visibleFromSite: isVisible(view),
        bodies: [body],
        focus: { body },
      });
    });
    each(body, 180, (time) => {
      events.push({
        id: `solar-conjunction-${body}-${idStamp(time.date)}`,
        kind: 'solar-conjunction',
        date: time.date,
        title: `${body} in Conjunction with the Sun`,
        subtitle: 'Hidden in the Sun’s glare',
        description: `${body} passes behind the Sun and is lost in its glare for several weeks before re-emerging in the morning sky.`,
        importance: 1,
        visibleFromSite: false,
        bodies: [body, B.Sun],
        focus: { body },
      });
    });
  }

  for (const body of [B.Mercury, B.Venus]) {
    for (const [relLon, which] of [[0, 'Inferior'], [180, 'Superior']] as const) {
      each(body, relLon, (time) => {
        events.push({
          id: `solar-conjunction-${body}-${idStamp(time.date)}`,
          kind: 'solar-conjunction',
          date: time.date,
          title: `${body} at ${which} Conjunction`,
          subtitle: 'Hidden in the Sun’s glare',
          description: which === 'Inferior'
            ? `${body} passes between Earth and the Sun, moving from the evening sky into the morning sky.`
            : `${body} passes behind the Sun, moving from the morning sky into the evening sky.`,
          importance: 1,
          visibleFromSite: false,
          bodies: [body, B.Sun],
          focus: { body },
        });
      });
    }
    for (let e = A.SearchMaxElongation(body, start); e.time.date <= end; e = A.SearchMaxElongation(body, e.time.AddDays(1))) {
      const view = nightTrack([bodyTarget(body)], e.time.date, observer);
      const mag = A.Illumination(body, e.time).mag;
      events.push({
        id: `elongation-${body}-${idStamp(e.time.date)}`,
        kind: 'elongation',
        date: e.time.date,
        title: `${body} at Greatest ${capitalize(e.visibility)} Elongation`,
        subtitle: `${deg(e.elongation)} from the Sun, mag ${mag.toFixed(1)}`,
        description: `${body} stands ${deg(e.elongation)} from the Sun in the ${e.visibility} sky — the best time to catch it this apparition. ${whereToLook(view, site)}`,
        importance: 2,
        visibleFromSite: isVisible(view),
        bodies: [body],
        focus: { body },
      });
    }
  }

  for (let v = A.SearchPeakMagnitude(B.Venus, start); v.time.date <= end; v = A.SearchPeakMagnitude(B.Venus, v.time.AddDays(10))) {
    const vis = A.Elongation(B.Venus, v.time).visibility;
    const view = nightTrack([bodyTarget(B.Venus)], v.time.date, observer);
    events.push({
      id: `peak-brightness-Venus-${idStamp(v.time.date)}`,
      kind: 'peak-brightness',
      date: v.time.date,
      title: 'Venus at Greatest Brilliancy',
      subtitle: `Mag ${v.mag.toFixed(1)} in the ${vis} sky`,
      description: `Venus reaches peak brightness, magnitude ${v.mag.toFixed(1)}, as a thin crescent in the ${vis} sky — bright enough to cast faint shadows from a dark site. ${whereToLook(view, site)}`,
      importance: 1,
      visibleFromSite: isVisible(view),
      bodies: [B.Venus],
      focus: { body: B.Venus },
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Close approaches between the Moon, planets and bright stars

function closeApproachEvents(site: SiteLocation, start: Date, end: Date): SkyEvent[] {
  const observer = observerFor(site);
  const movers = [B.Moon, ...NAKED_EYE_PLANETS].map(bodyTarget);
  const pairs: { a: Target; b: Target; limit: number; margin: number }[] = [];
  movers.forEach((a, i) => {
    const moon = a.body === B.Moon;
    for (const b of movers.slice(i + 1)) pairs.push({ a, b, limit: moon ? 2 : 3, margin: moon ? 2 : 0.5 });
    for (const b of STARS) pairs.push({ a, b, limit: 2, margin: moon ? 2 : 0.5 });
  });

  const step = 6 * HOUR;
  const t0 = start.getTime() - step;
  const n = Math.ceil((end.getTime() - start.getTime()) / step) + 3;
  const times = Array.from({ length: n }, (_, k) => A.MakeTime(new Date(t0 + k * step)));
  const cache = new Map<string, A.Vector[]>();
  const vectors = (t: Target) => {
    let v = cache.get(t.name);
    if (!v) cache.set(t.name, (v = times.map((time) => geoVector(t, time))));
    return v;
  };

  const events: SkyEvent[] = [];
  for (const { a, b, limit, margin } of pairs) {
    const va = vectors(a);
    const vb = vectors(b);
    const sep = va.map((v, k) => A.AngleBetween(v, vb[k]));
    for (let k = 1; k < n - 1; k++) {
      if (!(sep[k] <= sep[k - 1] && sep[k] < sep[k + 1] && sep[k] < limit + margin)) continue;
      const sepAt = (ms: number) => {
        const time = A.MakeTime(new Date(ms));
        return A.AngleBetween(geoVector(a, time), geoVector(b, time));
      };
      const min = minimize(sepAt, t0 + (k - 1) * step, t0 + (k + 1) * step);
      const date = new Date(min.t);
      if (min.value >= limit || date < start || date > end) continue;
      const time = A.MakeTime(date);
      const sun = A.GeoVector(B.Sun, time, true);
      const elongation = Math.max(A.AngleBetween(geoVector(a, time), sun), A.AngleBetween(geoVector(b, time), sun));
      if (elongation <= MIN_ELONGATION) continue;
      events.push(conjunctionEvent(site, observer, a, b, date, min.value));
    }
  }
  return events;
}

function conjunctionEvent(site: SiteLocation, observer: A.Observer, a: Target, b: Target, date: Date, sep: number): SkyEvent {
  const view = nightTrack([a, b], date, observer);
  const visible = isVisible(view);
  const star = !b.body;
  const moon = a.body === B.Moon;
  const bright = (t: Target) => t.body === B.Venus || t.body === B.Jupiter || t.body === B.Moon;
  let importance: 1 | 2 | 3;
  if (moon) importance = sep < 1 || bright(b) ? 2 : 1;
  else if (star) importance = sep < 1 ? 2 : 1;
  else importance = sep < 1 && (bright(a) || bright(b)) ? 3 : 2;
  if (!visible) importance = 1;
  const title = moon ? `Moon near ${b.label}` : star ? `${a.label} near ${b.label}` : `${a.label}–${b.label} Conjunction`;
  const closeness = sep < 0.5 ? 'a mere' : sep < 1 ? 'just' : 'about';
  const pairing = star ? '' : moon ? ' A lovely sight for the naked eye or binoculars.' : ' Both fit in a single binocular field.';
  return {
    id: `conjunction-${a.name}-${b.name}-${idStamp(date)}`,
    kind: 'conjunction',
    date,
    title,
    subtitle: `${deg(sep)} apart`,
    description: `${capitalize(a.label)} and ${b.label} pass ${closeness} ${deg(sep)} apart.${pairing} ${whereToLook(view, site)}`,
    importance,
    visibleFromSite: visible,
    bodies: [a.name, b.name],
    focus: a.body ? { body: a.name } : { ra: a.ra, dec: a.dec },
  };
}

// ---------------------------------------------------------------------------
// Planet parades

interface ParadeDay {
  date: Date;
  bodies: A.Body[];
  span: number;
  evening: boolean;
}

/**
 * Largest (≥ 4), then tightest, run of planets within a 60° span.
 * `rel` is ecliptic longitude relative to the Sun, all on one side of it.
 */
function tightestGroup(items: { body: A.Body; rel: number }[]): { bodies: A.Body[]; span: number } | null {
  const sorted = [...items].sort((x, y) => x.rel - y.rel);
  for (let k = sorted.length; k >= 4; k--) {
    let best: { bodies: A.Body[]; span: number } | null = null;
    for (let i = 0; i + k <= sorted.length; i++) {
      const span = sorted[i + k - 1].rel - sorted[i].rel;
      if (span <= 60 && (!best || span < best.span)) best = { bodies: sorted.slice(i, i + k).map((p) => p.body), span };
    }
    if (best) return best;
  }
  return null;
}

function paradeEvents(site: SiteLocation, start: Date, end: Date): SkyEvent[] {
  const observer = observerFor(site);
  const events: SkyEvent[] = [];
  let run: ParadeDay[] = [];
  const flush = () => {
    if (run.length) events.push(paradeEvent(site, observer, run));
    run = [];
  };
  // Sample once per night, at local midnight.
  for (let ms = observingNoon(start, site.timeZone).getTime() + 12 * HOUR; ms <= end.getTime(); ms += DAY) {
    if (ms < start.getTime()) continue;
    const time = A.MakeTime(new Date(ms));
    const sun = A.GeoVector(B.Sun, time, true);
    const sunLon = eclipticLon(sun);
    const items = NAKED_EYE_PLANETS.map((body) => ({ body, vec: A.GeoVector(body, time, true) }))
      .filter((p) => A.AngleBetween(p.vec, sun) > MIN_ELONGATION)
      .map((p) => ({ body: p.body, rel: ((((eclipticLon(p.vec) - sunLon) % 360) + 540) % 360) - 180 }));
    const evening = tightestGroup(items.filter((p) => p.rel > 0));
    const morning = tightestGroup(items.filter((p) => p.rel < 0));
    const pick = evening && (!morning || evening.bodies.length > morning.bodies.length || (evening.bodies.length === morning.bodies.length && evening.span <= morning.span))
      ? { ...evening, evening: true }
      : morning && { ...morning, evening: false };
    if (pick) run.push({ date: time.date, ...pick });
    else flush();
  }
  flush();
  return events;
}

function paradeEvent(site: SiteLocation, observer: A.Observer, run: ParadeDay[]): SkyEvent {
  const tz = site.timeZone;
  const best = run.reduce((a, b) => (b.bodies.length > a.bodies.length || (b.bodies.length === a.bodies.length && b.span < a.span) ? b : a));
  const lowOnes = best.bodies.filter((body) => {
    const spots = nightTrack([bodyTarget(body)], best.date, observer);
    const spot = best.evening ? spots[0] : spots[spots.length - 1];
    return !spot || spot.alt < MIN_ALT;
  });
  const first = run[0].date;
  const last = run[run.length - 1].date;
  const when = best.evening ? 'evening sky, low in the west after sunset' : 'morning sky, low in the east before dawn';
  const lowNote = lowOnes.length
    ? ` ${listText(lowOnes)} ${lowOnes.length > 1 ? 'hug' : 'hugs'} the horizon in bright twilight, so a clear, flat horizon helps.`
    : '';
  return {
    id: `planet-parade-${idStamp(first)}`,
    kind: 'planet-parade',
    date: first,
    endDate: last,
    title: `Planet Parade: ${best.bodies.length} Planets`,
    subtitle: `${fmtDay(first, tz)} – ${fmtDay(last, tz)}`,
    description: `${listText(best.bodies)} line up within ${Math.round(best.span)}° along the ecliptic in the ${when} (tightest around ${fmtDay(best.date, tz)}).${lowNote}`,
    importance: best.bodies.length >= 5 ? 3 : 2,
    visibleFromSite: best.bodies.length - lowOnes.length >= 4,
    bodies: NAKED_EYE_PLANETS.filter((p) => run.some((d) => d.bodies.includes(p))),
    focus: { body: best.bodies[Math.floor(best.bodies.length / 2)] },
  };
}

// ---------------------------------------------------------------------------
// Seasons and meteor showers

function seasonEvents(site: SiteLocation, start: Date, end: Date): SkyEvent[] {
  const tz = site.timeZone;
  const observer = observerFor(site);
  const events: SkyEvent[] = [];
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year++) {
    const s = A.Seasons(year);
    const list: [A.AstroTime, string, string][] = [
      [s.mar_equinox, 'March Equinox', 'Spring begins in the Northern Hemisphere.'],
      [s.jun_solstice, 'June Solstice', 'The longest day of the year and the start of summer.'],
      [s.sep_equinox, 'September Equinox', 'Autumn begins in the Northern Hemisphere and nights grow longer than days.'],
      [s.dec_solstice, 'December Solstice', 'The shortest day and longest night of the year — winter begins.'],
    ];
    for (const [time, title, text] of list) {
      const date = time.date;
      if (date < start || date > end) continue;
      const noon = observingNoon(new Date(date.getTime() + DAY), tz);
      const rise = A.SearchRiseSet(B.Sun, observer, +1, noon, -1);
      const set = A.SearchRiseSet(B.Sun, observer, -1, noon, 1);
      const minutes = rise && set ? Math.round((set.date.getTime() - rise.date.getTime()) / 60_000) : null;
      events.push({
        id: `season-${title.split(' ')[0].toLowerCase()}-${idStamp(date)}`,
        kind: 'season',
        date,
        title,
        subtitle: `${fmtTime(date, tz)} ${fmtDay(date, tz)}`,
        description: `${text}${minutes !== null ? ` ${site.name} gets ${Math.floor(minutes / 60)} h ${minutes % 60} min of daylight.` : ''}`,
        importance: 1,
        visibleFromSite: null,
        bodies: [B.Sun],
      });
    }
  }
  return events;
}

function meteorEvents(site: SiteLocation, start: Date, end: Date): SkyEvent[] {
  const tz = site.timeZone;
  const observer = observerFor(site);
  const lm = limitingMagnitudeForBortle(site.bortle);
  const events: SkyEvent[] = [];
  for (const shower of METEOR_SHOWERS) {
    for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year++) {
      const peak = showerPeakDate(shower, year);
      if (peak < start || peak > end) continue;
      const radiant: Target = { name: shower.code, label: shower.name, ra: shower.radiantRa / 15, dec: shower.radiantDec };
      const view = nightTrack([radiant], peak, observer, 30);
      const rates = view.map((spot) => ({ spot, rate: expectedHourlyRate(shower, spot.time, site, lm) }));
      const best = rates.reduce<(typeof rates)[number] | null>((a, b) => (!a || b.rate > a.rate ? b : a), null);
      const bestTime = best?.spot.time ?? peak;
      const illum = A.Illumination(B.Moon, A.MakeTime(bestTime)).phase_fraction;
      const moonUp = horizontal(bodyTarget(B.Moon), A.MakeTime(bestTime), observer).alt > 0;
      const moonNote = illum < 0.25
        ? 'Moonlight won’t interfere — conditions are excellent.'
        : !moonUp
          ? 'The Moon is down during the best hours, so moonlight won’t interfere.'
          : illum < 0.6
            ? `A ${Math.round(illum * 100)}%-lit Moon will brighten the sky somewhat.`
            : `A bright ${Math.round(illum * 100)}%-lit Moon will wash out fainter meteors.`;
      const rate = Math.round(best?.rate ?? 0);
      const radiantText = best && best.spot.alt >= MIN_ALT
        ? `Rates are best around ${fmtTime(bestTime, tz)}, with the radiant ${Math.round(best.spot.alt)}° up; from ${site.name} expect ${rate >= 1 ? `roughly ${rate} meteor${rate === 1 ? '' : 's'} per hour` : 'only an occasional meteor'} under clear skies.`
        : `The radiant stays low from ${site.name}, so few meteors will be seen.`;
      const peakZhr = showerActivity(shower, peak).zhr;
      let importance: 1 | 2 | 3 = peakZhr >= 50 ? 3 : peakZhr >= 15 ? 2 : 1;
      if (importance > 1 && illum >= 0.6 && moonUp) importance = (importance - 1) as 1 | 2;
      events.push({
        id: `meteor-${shower.id}-${year}`,
        kind: 'meteor-shower',
        date: peak,
        title: `${shower.name} Peak`,
        subtitle: `ZHR ${shower.zhr} · Moon ${Math.round(illum * 100)}% lit`,
        description: `${shower.description} ${radiantText} ${moonNote}`,
        importance,
        visibleFromSite: isVisible(view),
        bodies: [],
        focus: { ra: shower.radiantRa / 15, dec: shower.radiantDec },
      });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Public API

/** All notable sky events between `start` and `end` for the site, sorted by date. */
export function computeEvents(site: SiteLocation, start: Date, end: Date): SkyEvent[] {
  return [
    ...moonPhaseEvents(site, start, end),
    ...lunarEclipseEvents(site, start, end),
    ...solarEclipseEvents(site, start, end),
    ...planetSunEvents(site, start, end),
    ...closeApproachEvents(site, start, end),
    ...paradeEvents(site, start, end),
    ...seasonEvents(site, start, end),
    ...meteorEvents(site, start, end),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
}

/** Name of the Moon's phase for an ecliptic phase angle (deg, 0 = new, 180 = full). */
export function moonPhaseName(phaseAngleDeg: number): string {
  const a = ((phaseAngleDeg % 360) + 360) % 360;
  const tol = 8;
  if (a < tol || a > 360 - tol) return 'New Moon';
  if (Math.abs(a - 90) < tol) return 'First Quarter';
  if (Math.abs(a - 180) < tol) return 'Full Moon';
  if (Math.abs(a - 270) < tol) return 'Last Quarter';
  if (a < 90) return 'Waxing Crescent';
  if (a < 180) return 'Waxing Gibbous';
  if (a < 270) return 'Waning Gibbous';
  return 'Waning Crescent';
}

/** Intervals within [from, to] when the Moon is below the horizon. */
function moonDownIntervals(observer: A.Observer, from: Date, to: Date): TimeInterval[] {
  const days = (to.getTime() - from.getTime()) / DAY;
  const crossings: { time: Date; rising: boolean }[] = [];
  for (const dir of [+1, -1]) {
    for (let t = A.SearchRiseSet(B.Moon, observer, dir, from, days); t && t.date <= to; t = A.SearchRiseSet(B.Moon, observer, dir, t.AddDays(0.01), days)) {
      crossings.push({ time: t.date, rising: dir > 0 });
    }
  }
  crossings.sort((a, b) => a.time.getTime() - b.time.getTime());
  let up = crossings.length ? !crossings[0].rising : horizontal(bodyTarget(B.Moon), A.MakeTime(from), observer).alt > 0;
  const out: TimeInterval[] = [];
  let cursor = from;
  for (const c of crossings) {
    if (!up) out.push({ start: cursor, end: c.time });
    up = c.rising;
    cursor = c.time;
  }
  if (!up) out.push({ start: cursor, end: to });
  return out.filter((i) => i.end > i.start);
}

const hoursIn = (list: TimeInterval[]) => list.reduce((s, i) => s + (i.end.getTime() - i.start.getTime()), 0) / HOUR;

/** Sun altitude (deg) below which a planet of magnitude `mag` shows through twilight. */
const twilightLimit = (mag: number) => (mag <= -3 ? -1 : mag <= 1 ? -5 : mag <= 3 ? -8 : -12);

/** Visibility of a planet between sunset and sunrise, given the Sun's altitude track over the same samples. */
function planetTonight(body: A.Body, observer: A.Observer, site: SiteLocation, sunTrack: SkySpot[]): PlanetVisibility {
  const tz = site.timeZone;
  const nightStart = sunTrack[0].time;
  const nightEnd = sunTrack[sunTrack.length - 1].time;
  const mid = A.MakeTime(new Date((nightStart.getTime() + nightEnd.getTime()) / 2));
  const mag = A.Illumination(body, mid).mag;
  const limit = twilightLimit(mag);
  const all = track([bodyTarget(body)], nightStart, nightEnd, observer, NIGHT_STEP_MINUTES);
  const dark = all.filter((_, i) => sunTrack[i].alt <= limit);
  const best = highest(dark);
  const visible = !!best && best.alt >= MIN_ALT;
  const ref = best ? A.MakeTime(best.time) : mid;
  const elongation = A.AngleFromSun(body, ref);

  const rise = all[0].alt > 0 ? A.SearchRiseSet(body, observer, +1, nightStart, -1) : A.SearchRiseSet(body, observer, +1, nightStart, 1);
  const set = A.SearchRiseSet(body, observer, -1, rise ?? nightStart, 1);
  const transit = A.SearchHourAngle(body, observer, 0, rise ?? nightStart, +1).time.date;

  let note: string;
  if (elongation < MIN_ELONGATION) note = 'Too close to the Sun to observe';
  else if (!best || !visible) note = best && best.alt > 0 ? 'Too low in the twilight glow' : 'Below the horizon during darkness';
  else {
    const dir = compass(best.az);
    const first = dark[0];
    const last = dark[dark.length - 1];
    const riseText = rise && rise.date > nightStart ? `Rises ${fmtTime(rise.date, tz)}; ` : '';
    if (best === first) note = `${heightWord(best.alt)}in the ${dir} after sunset${set ? `, sets ${fmtTime(set.date, tz)}` : ''}`;
    else if (best === last) note = `${riseText}${heightWord(best.alt)}in the ${dir} before dawn`;
    else if (first.alt > 0 && last.alt > 0) note = `Up all night, highest in the ${dir} around ${fmtTime(best.time, tz)}`;
    else note = `${riseText}highest in the ${dir} around ${fmtTime(best.time, tz)}`;
    note = capitalize(note) + (body === B.Uranus ? ' (binoculars)' : body === B.Neptune ? ' (telescope)' : '');
  }
  return {
    body,
    rise: rise?.date ?? null,
    transit,
    set: set?.date ?? null,
    mag,
    constellation: constellationOf(body, ref, observer),
    elongation,
    altitudeAtBest: best?.alt ?? highest(all)!.alt,
    bestTime: visible ? best.time : null,
    visibleTonight: visible,
    note,
  };
}

/**
 * Sky quality: a Bortle-based baseline, dimmed by moonlight (illuminated fraction
 * × share of the dark hours the Moon is up) and by the lack of full darkness.
 */
function skyQuality(bortle: number, illumination: number, moonShare: number, darkHours: number, moonUpHours: number): SkyQuality {
  const base = Math.max(10, 100 - (bortle - 1) * 10);
  const score = Math.round(base * (1 - 0.7 * illumination * moonShare) * (darkHours > 0 ? 1 : 0.6));
  const label = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : score >= 20 ? 'Poor' : 'Very poor';
  return { score, label, darkHours, moonUpHours };
}

/**
 * Observing summary for the night that follows local noon of the observing day
 * containing `date` (before local noon, that is the previous evening's night).
 */
export function tonightSummary(site: SiteLocation, date: Date): Tonight {
  const observer = observerFor(site);
  const noon = observingNoon(date, site.timeZone);
  const sunAlt = (dir: 1 | -1, alt: number) => A.SearchAltitude(B.Sun, observer, dir, noon, 1, alt)?.date ?? null;
  const sunset = A.SearchRiseSet(B.Sun, observer, -1, noon, 1)?.date ?? null;
  const sunrise = A.SearchRiseSet(B.Sun, observer, +1, sunset ?? noon, 1)?.date ?? null;
  const [civilDusk, nauticalDusk, astronomicalDusk] = [-6, -12, -18].map((a) => sunAlt(-1, a));
  const [civilDawn, nauticalDawn, astronomicalDawn] = [-6, -12, -18].map((a) => sunAlt(+1, a));

  const nightStart = sunset ?? noon;
  const nightEnd = sunrise ?? new Date(noon.getTime() + DAY);
  const mid = new Date((nightStart.getTime() + nightEnd.getTime()) / 2);
  const phaseAngle = A.MoonPhase(mid);
  const illumination = A.Illumination(B.Moon, mid).phase_fraction;
  const prevNew = A.SearchMoonPhase(0, mid, -31)!.date;
  const moon: MoonTonight = {
    rise: A.SearchRiseSet(B.Moon, observer, +1, noon, 1)?.date ?? null,
    set: A.SearchRiseSet(B.Moon, observer, -1, noon, 1)?.date ?? null,
    phaseAngle,
    illumination,
    ageDays: (mid.getTime() - prevNew.getTime()) / DAY,
    phaseName: moonPhaseName(phaseAngle),
    nextNewMoon: A.SearchMoonPhase(0, date, 31)!.date,
    nextFullMoon: A.SearchMoonPhase(180, date, 31)!.date,
  };

  const dark = astronomicalDusk && astronomicalDawn && astronomicalDawn > astronomicalDusk;
  const darkWindow = dark ? moonDownIntervals(observer, astronomicalDusk, astronomicalDawn) : [];
  const darkHours = dark ? (astronomicalDawn.getTime() - astronomicalDusk.getTime()) / HOUR : 0;
  const moonUpHours = darkHours - hoursIn(darkWindow);
  // Without astronomical darkness, judge the Moon over the whole night instead.
  const moonShare = darkHours > 0
    ? moonUpHours / darkHours
    : 1 - hoursIn(moonDownIntervals(observer, nightStart, nightEnd)) / ((nightEnd.getTime() - nightStart.getTime()) / HOUR);

  const sunTrack = track([bodyTarget(B.Sun)], nightStart, nightEnd, observer, NIGHT_STEP_MINUTES);
  return {
    noon,
    sunset,
    sunrise,
    civilDusk,
    nauticalDusk,
    astronomicalDusk,
    astronomicalDawn,
    nauticalDawn,
    civilDawn,
    moon,
    darkWindow,
    planets: ALL_PLANETS.map((body) => planetTonight(body, observer, site, sunTrack)),
    skyQuality: skyQuality(site.bortle, illumination, moonShare, darkHours, moonUpHours),
  };
}
