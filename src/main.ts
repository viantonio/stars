import * as THREE from 'three';
import './styles/main.css';
import { loadCatalogs } from './data/catalog';
import { App } from './app';

const bar = document.getElementById('loading-bar')!;
const text = document.getElementById('loading-text')!;
let done = 0;
const TOTAL = 17;
const tick = (label: string) => {
  done++;
  bar.style.width = `${Math.min(100, (done / TOTAL) * 100)}%`;
  text.textContent = `Loading ${label}…`;
};

const TEXTURES: [string, boolean][] = [
  ['milkyway', true],
  ['moon', true],
  ['moon_normal', false],
  ['sun', true],
  ['mercury', true],
  ['venus', true],
  ['mars', true],
  ['jupiter', true],
  ['saturn', true],
  ['uranus', true],
  ['neptune', true],
];

async function loadTextures(maxAniso: number): Promise<Record<string, THREE.Texture>> {
  const loader = new THREE.TextureLoader();
  const out: Record<string, THREE.Texture> = {};
  await Promise.all(
    TEXTURES.map(async ([name, srgb]) => {
      try {
        const t = await loader.loadAsync(`${import.meta.env.BASE_URL}tex/${name}.jpg`);
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = maxAniso;
        t.wrapS = THREE.RepeatWrapping;
        out[name] = t;
      } catch (e) {
        console.warn(`Texture ${name} failed`, e);
      }
      tick(name.replace('_', ' '));
    }),
  );
  return out;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    text.textContent = 'Your browser does not support WebGL, which is needed to render the sky.';
    return;
  }
  const [catalogs, textures] = await Promise.all([loadCatalogs(tick), loadTextures(8)]);
  text.textContent = 'Computing the sky…';
  const root = document.getElementById('app')!;
  const app = new App(root, catalogs, textures);
  (window as unknown as { stars: App }).stars = app;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = document.getElementById('loading')!;
      el.classList.add('done');
      setTimeout(() => el.remove(), 900);
    }),
  );
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  }
}

boot().catch((e) => {
  console.error(e);
  text.textContent = `Something went wrong while loading: ${e instanceof Error ? e.message : e}`;
});
