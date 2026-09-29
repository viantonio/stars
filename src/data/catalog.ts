/** Loaders for the bundled catalogs in public/data (built by scripts/build-data.mjs). */

export interface StarMeta {
  index: number;
  name: string;
  bayer: string;
  flamsteed: string;
  con: string;
  hip: number;
  hd: number;
  distLy: number | null;
  spect: string;
  absmag: number | null;
  lum: number | null;
  variable: string;
}

export interface StarCatalog {
  count: number;
  /** Interleaved x, y, z (EQJ unit vector), magnitude, B–V colour index. */
  data: Float32Array;
  meta: Map<number, StarMeta>;
}

export interface Constellation {
  id: string;
  name: string;
  gen: string;
  en: string;
  rank: number;
  /** [raDeg, decDeg] */
  label: [number, number];
  lines: [number, number][][];
  bounds: [number, number][][];
}

export interface DeepSkyObject {
  id: string;
  desig: string;
  name: string;
  type: string;
  typeName: string;
  mag: number | null;
  /** Major/minor axis in arcminutes. */
  dim: [number, number];
  ra: number;
  dec: number;
  messier: boolean;
}

export interface Catalogs {
  stars: StarCatalog;
  constellations: Constellation[];
  dso: DeepSkyObject[];
  milkyWayOutline: [number, number][][];
}

const url = (p: string) => `${import.meta.env.BASE_URL}data/${p}`;

async function fetchOk(p: string): Promise<Response> {
  const r = await fetch(url(p));
  if (!r.ok) throw new Error(`Failed to load ${p}: ${r.status}`);
  return r;
}

export async function loadStars(): Promise<StarCatalog> {
  const [bin, metaJson] = await Promise.all([
    fetchOk('stars.bin').then((r) => r.arrayBuffer()),
    fetchOk('stars-meta.json').then((r) => r.json() as Promise<{ rows: unknown[][] }>),
  ]);
  const data = new Float32Array(bin);
  const meta = new Map<number, StarMeta>();
  for (const r of metaJson.rows) {
    const [index, name, bayer, flamsteed, con, hip, hd, distLy, spect, absmag, lum, variable] = r as [
      number, string, string, string, string, number, number, number | null, string, number | null, number | null, string,
    ];
    meta.set(index, { index, name, bayer, flamsteed, con, hip, hd, distLy, spect, absmag, lum, variable });
  }
  return { count: data.length / 5, data, meta };
}

export async function loadCatalogs(onProgress?: (label: string) => void): Promise<Catalogs> {
  const step = <T>(label: string, p: Promise<T>) => p.then((v) => (onProgress?.(label), v));
  const [stars, constellations, dso, milkyWayOutline] = await Promise.all([
    step('stars', loadStars()),
    step('constellations', fetchOk('constellations.json').then((r) => r.json())),
    step('deep sky', fetchOk('dso.json').then((r) => r.json())),
    step('milky way', fetchOk('milkyway-outline.json').then((r) => r.json())),
  ]);
  return { stars, constellations, dso, milkyWayOutline };
}

export async function loadText(p: string): Promise<string> {
  return (await fetchOk(p)).text();
}

export async function loadJSON<T>(p: string): Promise<T> {
  return (await fetchOk(p)).json() as Promise<T>;
}

/** Display name for a star: proper name, else Bayer/Flamsteed + constellation. */
export function starDisplayName(m: StarMeta | undefined, genitive?: (con: string) => string): string {
  if (!m) return 'Star';
  if (m.name) return m.name;
  const con = genitive ? genitive(m.con) : m.con;
  if (m.bayer) return `${m.bayer} ${con}`;
  if (m.flamsteed) return `${m.flamsteed} ${con}`;
  if (m.hip) return `HIP ${m.hip}`;
  if (m.hd) return `HD ${m.hd}`;
  return 'Star';
}
