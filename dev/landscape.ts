/* Standalone visual harness for src/render/landscape.ts.
 * npx vite --port 5199 → http://localhost:5199/dev/landscape.html
 * Query: ?kind=alpine&sunAlt=3&sunAz=260&az=60&pano=1&shot=1
 */
import * as THREE from 'three';
import { createLandscape, type Landscape } from '../src/render/landscape';
import type { HorizonKind } from '../src/core/locations';

const q = new URLSearchParams(location.search);
interface State {
  kind: HorizonKind;
  sunAlt: number;
  sunAz: number;
  az: number;
  alt: number;
  fov: number;
  moon: boolean;
  moonAlt: number;
  moonAz: number;
  moonIllum: number;
  lp: number;
  nv: boolean;
  pano: boolean;
}
const defaultLP: Record<HorizonKind, number> = { foothills: 0.15, city: 0.85, alpine: 0.05, flat: 0.3 };
const kind0 = (q.get('kind') as HorizonKind) || 'foothills';
const S: State = {
  kind: kind0,
  sunAlt: Number(q.get('sunAlt') ?? 20),
  sunAz: Number(q.get('sunAz') ?? 240),
  az: Number(q.get('az') ?? 60),
  alt: Number(q.get('alt') ?? 4),
  fov: Number(q.get('fov') ?? 50),
  moon: q.get('moon') === '1',
  moonAlt: Number(q.get('moonAlt') ?? 35),
  moonAz: Number(q.get('moonAz') ?? 140),
  moonIllum: Number(q.get('moonIllum') ?? 0.9),
  lp: q.has('lp') ? Number(q.get('lp')) : defaultLP[kind0],
  nv: q.get('nv') === '1',
  pano: q.get('pano') === '1',
};
if (q.get('shot') === '1') document.body.classList.add('shot');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = q.get('aces') === '1' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 5000);
camera.rotation.order = 'YXZ';

const dirFrom = (azDeg: number, altDeg: number) => {
  const az = THREE.MathUtils.degToRad(azDeg);
  const alt = THREE.MathUtils.degToRad(altDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
};

// ── simple sky ──
type K = [number, [number, number, number], [number, number, number]];
const KEYS: K[] = [
  [-90, [0.004, 0.006, 0.012], [0.0012, 0.0018, 0.004]],
  [-18, [0.004, 0.006, 0.012], [0.0012, 0.0018, 0.004]],
  [-12, [0.02, 0.024, 0.045], [0.005, 0.008, 0.02]],
  [-8, [0.09, 0.09, 0.16], [0.02, 0.035, 0.09]],
  [-4, [0.35, 0.22, 0.2], [0.05, 0.09, 0.22]],
  [0, [0.8, 0.45, 0.25], [0.1, 0.18, 0.4]],
  [4, [0.95, 0.66, 0.4], [0.16, 0.28, 0.55]],
  [12, [0.75, 0.78, 0.82], [0.15, 0.32, 0.7]],
  [30, [0.6, 0.72, 0.9], [0.12, 0.29, 0.7]],
  [90, [0.6, 0.72, 0.9], [0.12, 0.29, 0.7]],
];
function skyColors(sunAlt: number, lp: number): { hor: THREE.Color; zen: THREE.Color } {
  let i = 0;
  while (i < KEYS.length - 2 && sunAlt > KEYS[i + 1][0]) i++;
  const [a0, h0, z0] = KEYS[i];
  const [a1, h1, z1] = KEYS[i + 1];
  const t = THREE.MathUtils.clamp((sunAlt - a0) / (a1 - a0), 0, 1);
  const lerp = (x: number[], y: number[]) => new THREE.Color(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  const hor = lerp(h0, h1);
  const zen = lerp(z0, z1);
  const night = 1 - THREE.MathUtils.smoothstep(sunAlt, -14, -4);
  hor.add(new THREE.Color(0.05, 0.036, 0.024).multiplyScalar(lp * lp * night));
  zen.add(new THREE.Color(0.012, 0.01, 0.009).multiplyScalar(lp * lp * night));
  return { hor, zen };
}
const skyU = {
  uHor: { value: new THREE.Color() },
  uZen: { value: new THREE.Color() },
  uSun: { value: new THREE.Vector3() },
  uMoon: { value: new THREE.Vector3() },
  uSunAlt: { value: 0 },
  uMoonOn: { value: 0 },
  uNV: { value: 0 },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1000, 64, 32),
  new THREE.ShaderMaterial({
    uniforms: skyU,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uHor, uZen, uSun, uMoon; uniform float uSunAlt, uMoonOn, uNV; varying vec3 vP;
      float h13(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 d = normalize(vP);
        float t = pow(clamp(d.y,0.0,1.0), 0.45);
        vec3 c = mix(uHor, uZen, t);
        float cs = dot(d, uSun);
        float day = smoothstep(-12.0, 5.0, uSunAlt);
        c += vec3(1.0,0.75,0.45) * pow(max(cs,0.0), 8.0) * 0.5 * day * (1.0 - t*0.6);
        c += vec3(1.0,0.95,0.85) * smoothstep(0.99985, 0.99992, cs) * 20.0;
        vec3 p = d*260.0; vec3 cell = floor(p); float hs = h13(cell);
        float star = step(0.9965, hs) * smoothstep(0.42, 0.05, length(fract(p)-0.5));
        float night = 1.0 - smoothstep(-16.0, -6.0, uSunAlt);
        c += vec3(0.9,0.93,1.0) * star * night * (0.15 + 3.0*pow(h13(cell+7.0), 6.0));
        float cm = dot(d, uMoon);
        c += uMoonOn * (vec3(1.0,0.97,0.9) * smoothstep(0.99990, 0.99994, cm) * 3.0 + vec3(0.3,0.35,0.45)*pow(max(cm,0.0),200.0)*0.05);
        if (uNV > 0.5) { float l = dot(c, vec3(0.2126,0.7152,0.0722)); c = vec3(l*1.1, l*0.06, l*0.03); }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }),
);
sky.renderOrder = 0;
scene.add(sky);

let land: Landscape | null = null;
let landKind: HorizonKind | null = null;
function ensureLand() {
  if (landKind === S.kind && land) return;
  land?.dispose();
  const t0 = performance.now();
  land = createLandscape(S.kind);
  const ms = performance.now() - t0;
  (window as any).__buildMs = ms;
  console.log(`landscape ${S.kind} built in ${ms.toFixed(0)} ms`);
  landKind = S.kind;
  scene.add(land.object);
}

function render() {
  ensureLand();
  const sunDir = dirFrom(S.sunAz, S.sunAlt);
  const moonDir = dirFrom(S.moonAz, S.moonAlt);
  const { hor, zen } = skyColors(S.sunAlt, S.lp);
  skyU.uHor.value.copy(hor);
  skyU.uZen.value.copy(zen);
  skyU.uSun.value.copy(sunDir);
  skyU.uMoon.value.copy(moonDir);
  skyU.uSunAlt.value = S.sunAlt;
  skyU.uMoonOn.value = S.moon ? 1 : 0;
  skyU.uNV.value = S.nv ? 1 : 0;
  if (S.moon) {
    // moonlight brightens the night sky a little
    hor.add(new THREE.Color(0.02, 0.025, 0.035).multiplyScalar(S.moonIllum * (1 - THREE.MathUtils.smoothstep(S.sunAlt, -14, -4))));
    skyU.uHor.value.copy(hor);
  }
  land!.update({
    sunDir,
    sunAltDeg: S.sunAlt,
    moonDir,
    moonIllum: S.moon && S.moonAlt > 0 ? S.moonIllum : 0,
    skyColorHorizon: hor,
    nightVision: S.nv,
    lightPollution: S.lp,
  });
  const W = innerWidth;
  const H = innerHeight;
  if (S.pano) {
    // Four rows, each a 90°-wide view centred on N, E, S, W.
    const rowH = Math.floor(H / 4);
    const vfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(45)) * (rowH / W));
    camera.fov = THREE.MathUtils.radToDeg(vfov);
    camera.aspect = W / rowH;
    camera.updateProjectionMatrix();
    for (let r = 0; r < 4; r++) {
      const y = H - (r + 1) * rowH;
      renderer.setViewport(0, y, W, rowH);
      renderer.setScissor(0, y, W, rowH);
      camera.rotation.set(THREE.MathUtils.degToRad(S.alt), -THREE.MathUtils.degToRad(r * 90), 0);
      renderer.render(scene, camera);
    }
  } else {
    camera.fov = S.fov;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setViewport(0, 0, W, H);
    renderer.setScissor(0, 0, W, H);
    camera.rotation.set(THREE.MathUtils.degToRad(S.alt), -THREE.MathUtils.degToRad(S.az), 0);
    renderer.render(scene, camera);
  }
  const info = document.getElementById('info');
  if (info) info.textContent = `${S.kind} · horizon@view az ${land!.horizonAltAt(S.az).toFixed(2)}° · nv ${S.nv} · moon ${S.moon}`;
}

(window as any).__set = (p: Partial<State>) =>
  new Promise<void>((res) => {
    if (p.kind && !('lp' in p)) S.lp = defaultLP[p.kind];
    Object.assign(S, p);
    render();
    requestAnimationFrame(() => requestAnimationFrame(() => res()));
  });
(window as any).__profile = () => (land ? Array.from(land.horizonProfile) : []);

// ── UI ──
const bind = (id: keyof State) => {
  const el = document.getElementById(id as string) as HTMLInputElement | null;
  const out = document.getElementById(`${id as string}V`);
  if (!el) return;
  el.value = String(S[id]);
  const sync = () => {
    (S as any)[id] = Number(el.value);
    if (out) out.textContent = el.value;
  };
  sync();
  el.addEventListener('input', sync);
};
(['sunAlt', 'sunAz', 'lp'] as const).forEach(bind);
const viewEl = document.getElementById('viewAz') as HTMLInputElement;
viewEl.value = String(S.az);
viewEl.addEventListener('input', () => (S.az = Number(viewEl.value)));
window.addEventListener('keydown', (e) => {
  const kinds: HorizonKind[] = ['foothills', 'city', 'alpine', 'flat'];
  const n = Number(e.key);
  if (n >= 1 && n <= 4) {
    S.kind = kinds[n - 1];
    S.lp = defaultLP[S.kind];
    (document.getElementById('lp') as HTMLInputElement).value = String(S.lp);
  }
  if (e.key === 'n' || e.key === 'N') S.nv = !S.nv;
  if (e.key === 'm' || e.key === 'M') S.moon = !S.moon;
  if (e.key === 'p' || e.key === 'P') S.pano = !S.pano;
  if (e.key === 'ArrowLeft') S.az = (S.az + 355) % 360;
  if (e.key === 'ArrowRight') S.az = (S.az + 5) % 360;
  viewEl.value = String(S.az);
});
let drag: { x: number; y: number; az: number; alt: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY, az: S.az, alt: S.alt }));
window.addEventListener('pointerup', () => (drag = null));
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const k = S.fov / innerHeight;
  S.az = (drag.az - (e.clientX - drag.x) * k + 360) % 360;
  S.alt = THREE.MathUtils.clamp(drag.alt + (e.clientY - drag.y) * k, -89, 89);
});
window.addEventListener('wheel', (e) => (S.fov = THREE.MathUtils.clamp(S.fov * (e.deltaY > 0 ? 1.1 : 0.9), 5, 100)));
window.addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));
if (q.get('shot') !== '1') {
  const loop = () => {
    render();
    requestAnimationFrame(loop);
  };
  loop();
} else {
  render();
}
