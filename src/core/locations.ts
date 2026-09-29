/** Observing sites. Coordinates are WGS84 degrees, elevation in metres. */
export type HorizonKind = 'foothills' | 'city' | 'alpine' | 'flat';

export interface SiteLocation {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  elevation: number;
  timeZone: string;
  /** Bortle dark-sky class 1 (pristine) – 9 (inner city). */
  bortle: number;
  horizon: HorizonKind;
  /** Short description shown in the location picker. */
  blurb: string;
}

export const PRESET_LOCATIONS: SiteLocation[] = [
  {
    id: 'mariposa',
    name: 'Mariposa',
    region: 'Sierra Nevada foothills, CA',
    lat: 37.4849,
    lon: -119.9663,
    elevation: 595,
    timeZone: 'America/Los_Angeles',
    bortle: 3,
    horizon: 'foothills',
    blurb: 'Rural dark skies at the gateway to Yosemite. The Milky Way is plainly visible on moonless nights.',
  },
  {
    id: 'sacramento',
    name: 'Sacramento',
    region: 'Central Valley, CA',
    lat: 38.5816,
    lon: -121.4944,
    elevation: 9,
    timeZone: 'America/Los_Angeles',
    bortle: 8,
    horizon: 'city',
    blurb: 'Bright city skies. Planets, the Moon and the brightest stars punch through the urban glow.',
  },
  {
    id: 'glacier-point',
    name: 'Glacier Point',
    region: 'Yosemite National Park, CA',
    lat: 37.7306,
    lon: -119.5738,
    elevation: 2199,
    timeZone: 'America/Los_Angeles',
    bortle: 2,
    horizon: 'alpine',
    blurb: 'An hour from Mariposa: high-altitude, near-pristine darkness above Half Dome.',
  },
];

export function customLocation(lat: number, lon: number, elevation = 0, name = 'My location'): SiteLocation {
  return {
    id: 'custom',
    name,
    region: `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`,
    lat,
    lon,
    elevation,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    bortle: 5,
    horizon: 'flat',
    blurb: 'Custom observing site.',
  };
}
