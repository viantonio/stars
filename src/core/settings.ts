/** User settings, persisted to localStorage, with change notification. */

export interface Settings {
  locationId: string;
  custom: { lat: number; lon: number; elevation: number; name: string } | null;
  constellationLines: boolean;
  constellationNames: boolean;
  constellationBounds: boolean;
  starNames: boolean;
  planetLabels: boolean;
  deepSky: boolean;
  milkyWay: boolean;
  atmosphere: boolean;
  ground: boolean;
  refraction: boolean;
  gridAltAz: boolean;
  gridEquatorial: boolean;
  ecliptic: boolean;
  meridian: boolean;
  cardinals: boolean;
  satellites: boolean;
  comets: boolean;
  asteroids: boolean;
  meteors: boolean;
  nightVision: boolean;
  /** Ignore light pollution and extinction: the sky as it would be with none. */
  perfectSky: boolean;
  /** null = use the site's Bortle class. */
  bortleOverride: number | null;
  /** Extra magnitudes of stars shown beyond the naked-eye limit. */
  starBoost: number;
  starSize: number;
  bodyScale: number;
  twinkle: boolean;
  /** Show labels for objects even when they are too faint to see. */
  labelFaint: boolean;
  showHud: boolean;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  locationId: 'mariposa',
  custom: null,
  constellationLines: true,
  constellationNames: true,
  constellationBounds: false,
  starNames: true,
  planetLabels: true,
  deepSky: true,
  milkyWay: true,
  atmosphere: true,
  ground: true,
  refraction: true,
  gridAltAz: false,
  gridEquatorial: false,
  ecliptic: false,
  meridian: false,
  cardinals: true,
  satellites: true,
  comets: true,
  asteroids: true,
  meteors: true,
  nightVision: false,
  perfectSky: false,
  bortleOverride: null,
  starBoost: 0,
  starSize: 1,
  bodyScale: 1,
  twinkle: true,
  labelFaint: false,
  showHud: true,
  onboarded: false,
};

const KEY = 'stars-observatory.settings.v1';

type Listener = (s: Settings, changed: (keyof Settings)[]) => void;

export class SettingsStore {
  private state: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    let saved: Partial<Settings> = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      saved = {};
    }
    this.state = { ...DEFAULT_SETTINGS, ...saved };
  }

  get(): Readonly<Settings> {
    return this.state;
  }

  set(patch: Partial<Settings>): void {
    const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => this.state[k] !== patch[k]);
    if (!changed.length) return;
    this.state = { ...this.state, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* storage may be unavailable (private mode) */
    }
    for (const l of this.listeners) l(this.state, changed);
  }

  toggle(key: { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]): void {
    this.set({ [key]: !this.state[key] } as Partial<Settings>);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  reset(): void {
    this.set({ ...DEFAULT_SETTINGS, onboarded: true });
  }
}
