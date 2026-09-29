import * as A from 'astronomy-engine';
import { moonPhaseName } from '../astro/events';

/** The physical sky at a moment and place — facts only, no interpretation. */
export interface SkySummary {
  sunConstellation: string;
  sunAltitude: number;
  moonConstellation: string;
  moonPhase: string;
  moonIllumination: number;
  moonUp: boolean;
  /** Planets above the horizon (and whether the sky was dark enough to see them). */
  planetsUp: { name: string; constellation: string; altitude: number; mag: number; visible: boolean }[];
  zenithConstellation: string;
  risingConstellation: string;
  settingConstellation: string;
  skyState: string;
}

const CON_NAMES: Record<string, string> = {};

export function setConstellationNames(list: { id: string; name: string }[]): void {
  for (const c of list) CON_NAMES[c.id] = c.name;
}

const conName = (ra: number, dec: number) => {
  const s = A.Constellation(ra, dec).symbol;
  return CON_NAMES[s] ?? s;
};

/** Constellation at a horizon direction (altitude, azimuth in degrees). */
function constellationAt(time: A.AstroTime, obs: A.Observer, alt: number, az: number): string {
  const hor = A.VectorFromHorizon(new A.Spherical(alt, az, 1), time, 'normal');
  const eqj = A.RotateVector(A.Rotation_HOR_EQJ(time, obs), hor);
  const eq = A.EquatorFromVector(eqj);
  return conName(eq.ra, eq.dec);
}

export function skySummary(date: Date, lat: number, lon: number, elevation = 0): SkySummary {
  const time = A.MakeTime(date);
  const obs = new A.Observer(lat, lon, elevation);
  const altOf = (b: A.Body) => {
    const eq = A.Equator(b, time, obs, true, true);
    return A.Horizon(time, obs, eq.ra, eq.dec, 'normal').altitude;
  };
  const j2000 = (b: A.Body) => A.Equator(b, time, obs, false, true);
  const sunAlt = altOf(A.Body.Sun);
  const sun = j2000(A.Body.Sun);
  const moon = j2000(A.Body.Moon);
  const phase = A.MoonPhase(time);
  const planets = [A.Body.Mercury, A.Body.Venus, A.Body.Mars, A.Body.Jupiter, A.Body.Saturn, A.Body.Uranus, A.Body.Neptune]
    .map((b) => {
      const eq = j2000(b);
      const alt = altOf(b);
      const mag = A.Illumination(b, time).mag;
      // Naked-eye threshold loosens as the sky darkens.
      const limit = sunAlt > -3 ? -3.5 : sunAlt > -8 ? 0.5 : sunAlt > -14 ? 3 : 5.5;
      return { name: b as string, constellation: conName(eq.ra, eq.dec), altitude: alt, mag, visible: alt > 3 && mag < limit };
    })
    .filter((p) => p.altitude > 0)
    .sort((a, b) => a.mag - b.mag);
  const skyState =
    sunAlt > 0 ? 'Daylight' : sunAlt > -6 ? 'Civil twilight' : sunAlt > -12 ? 'Nautical twilight' : sunAlt > -18 ? 'Astronomical twilight' : 'Full night';
  return {
    sunConstellation: conName(sun.ra, sun.dec),
    sunAltitude: sunAlt,
    moonConstellation: conName(moon.ra, moon.dec),
    moonPhase: moonPhaseName(phase),
    moonIllumination: A.Illumination(A.Body.Moon, time).phase_fraction,
    moonUp: altOf(A.Body.Moon) > 0,
    planetsUp: planets,
    zenithConstellation: constellationAt(time, obs, 89.9, 0),
    risingConstellation: constellationAt(time, obs, 0, 90),
    settingConstellation: constellationAt(time, obs, 0, 270),
    skyState,
  };
}
