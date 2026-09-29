import * as THREE from 'three';
import * as A from 'astronomy-engine';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { bodyOrientation } from '../astro/solarsystem';
import { brightComets, helioPosition, orbitPolyline, type SmallBodyElements, type Vec3 } from '../astro/smallbodies';
import { makeSaturnRingTexture } from './bodies';
import { OrreryPanel } from '../ui/orreryPanel';
import '../styles/orrery.css';

/**
 * A 3D heliocentric view of the Solar System ("orrery") at the simulated time.
 *
 * Frame: ecliptic J2000 with the ecliptic plane horizontal — display (X, Y, Z)
 * = ecliptic (x, z, −y), so ecliptic north is +Y and the vernal equinox is +X.
 * Distances are compressed radially (display r = 10·√r_AU) so the inner planets
 * stay visible next to Neptune; every position, orbit and tail goes through the
 * same mapping, so the geometry (oppositions, conjunctions) stays true in direction.
 */

const AU_UNITS = 10;
const SUN_RADIUS = 1.5;
const MOON_ORBIT = 0.8;
const MOON_RADIUS = 0.085;
const DAY_MS = 86400e3;
const SACRAMENTO = new A.Observer(38.58, -121.49, 0);

/** Display distance for a heliocentric distance in AU. */
export function compressRadius(rAU: number): number {
  return AU_UNITS * Math.sqrt(Math.max(rAU, 0));
}

/** Exaggerated but ordered planet radius (display units) for a radius in km. */
function displayRadius(km: number): number {
  return 0.3 * Math.pow(km / 6378.1, 0.4);
}

/** EQJ → display (ecliptic, Y-up) rotation. */
const EQJ_TO_DISPLAY = (() => {
  const r = A.Rotation_EQJ_ECL().rot;
  // ecliptic_i = Σ_j r[j][i]·v_j ; display = (ecl.x, ecl.z, −ecl.y)
  return new THREE.Matrix3().set(r[0][0], r[1][0], r[2][0], r[0][2], r[1][2], r[2][2], -r[0][1], -r[1][1], -r[2][1]);
})();
const EQJ_TO_DISPLAY4 = new THREE.Matrix4().setFromMatrix3(EQJ_TO_DISPLAY);
const DISPLAY_TO_EQJ = EQJ_TO_DISPLAY.clone().transpose();

/** Rotates an EQJ vector (AU) into the display frame without compression. */
function eqjToDisplay(v: Vec3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(v.x, v.y, v.z).applyMatrix3(EQJ_TO_DISPLAY);
}

/** Heliocentric EQJ (AU) → compressed display position. */
function toDisplay(v: Vec3, out: THREE.Vector3): THREE.Vector3 {
  eqjToDisplay(v, out);
  const r = out.length();
  return r > 0 ? out.multiplyScalar(compressRadius(r) / r) : out;
}

interface PlanetDef {
  id: string;
  body: A.Body;
  /** Sidereal period, days. */
  period: number;
  color: string;
  texture?: string;
  radiusKm: number;
  flattening: number;
  /** Atmospheric rim colour (linear-ish RGB) and strength. */
  rim?: [number, number, number, number];
  gas?: boolean;
}

const PLANETS: PlanetDef[] = [
  { id: 'Mercury', body: A.Body.Mercury, period: 87.969, color: '#b9ab99', texture: 'mercury', radiusKm: 2439.7, flattening: 0 },
  { id: 'Venus', body: A.Body.Venus, period: 224.701, color: '#ecd29c', texture: 'venus', radiusKm: 6051.8, flattening: 0, rim: [1.0, 0.85, 0.55, 0.35] },
  { id: 'Earth', body: A.Body.Earth, period: 365.256, color: '#62aaff', texture: 'earth', radiusKm: 6378.1, flattening: 0.00335, rim: [0.35, 0.6, 1.0, 0.9] },
  { id: 'Mars', body: A.Body.Mars, period: 686.98, color: '#ff8559', texture: 'mars', radiusKm: 3396.2, flattening: 0.00589, rim: [1.0, 0.6, 0.45, 0.25] },
  { id: 'Jupiter', body: A.Body.Jupiter, period: 4332.59, color: '#e9c298', texture: 'jupiter', radiusKm: 71492, flattening: 0.06487, gas: true },
  { id: 'Saturn', body: A.Body.Saturn, period: 10759.22, color: '#efd48c', texture: 'saturn', radiusKm: 60268, flattening: 0.09796, gas: true },
  { id: 'Uranus', body: A.Body.Uranus, period: 30688.5, color: '#93e2ec', texture: 'uranus', radiusKm: 25559, flattening: 0.02293, gas: true, rim: [0.6, 0.95, 1.0, 0.3] },
  { id: 'Neptune', body: A.Body.Neptune, period: 60182, color: '#7394ff', texture: 'neptune', radiusKm: 24764, flattening: 0.01708, gas: true, rim: [0.45, 0.6, 1.0, 0.35] },
  { id: 'Pluto', body: A.Body.Pluto, period: 90560, color: '#c9ae96', radiusKm: 1188.3, flattening: 0 },
];

// ------------------------------------------------------------------ shaders

const BODY_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const BODY_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform vec3 uColor;
  uniform float uMode;        // 0 rocky, 1 gas giant, 2 sun
  uniform vec4 uRim;
  uniform float uRingShadow;
  uniform mat3 uWorldToLocal;
  uniform vec3 uCenterW;
  uniform float uRadiusW;
  uniform vec3 uSunLocal;
  uniform float uRingInner;
  uniform float uRingOuter;
  uniform sampler2D uRingTex;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    vec3 albedo = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : uColor;
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float mu = clamp(dot(N, V), 0.0, 1.0);
    if (uMode > 1.5) {
      vec3 ld = vec3(0.35, 0.22, 0.1) + vec3(0.65, 0.78, 0.9) * pow(vec3(mu), vec3(0.4, 0.55, 0.8));
      gl_FragColor = vec4((vec3(1.0, 0.86, 0.62) * 0.8 + albedo * 0.6) * ld * 1.12, 1.0);
      #include <colorspace_fragment>
      return;
    }
    vec3 L = normalize(-vPosW); // the Sun sits at the origin
    float ndl = dot(N, L);
    float lit = max(ndl, 0.0);
    lit *= smoothstep(-0.02, 0.08, ndl);
    if (uMode > 0.5) lit *= 0.62 + 0.38 * pow(mu, 0.35); // gas-giant limb darkening
    if (uRingShadow > 0.5 && lit > 0.0) {
      vec3 p = uWorldToLocal * (vPosW - uCenterW) / uRadiusW;
      vec3 s = uSunLocal;
      if (abs(s.y) > 1e-4) {
        float t = -p.y / s.y;
        if (t > 0.0) {
          vec3 q = p + s * t;
          float r = length(q.xz);
          if (r > uRingInner && r < uRingOuter) {
            float op = texture2D(uRingTex, vec2((r - uRingInner) / (uRingOuter - uRingInner), 0.5)).a;
            lit *= 1.0 - op * 0.85;
          }
        }
      }
    }
    vec3 c = albedo * (lit * 1.45 + 0.05);
    // Thin atmosphere: a Fresnel rim on the day side.
    float rim = pow(1.0 - mu, 3.0) * smoothstep(-0.25, 0.45, ndl);
    c += uRim.rgb * rim * uRim.a;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

const RING_VERT = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAG = /* glsl */ `
  uniform sampler2D uRingTex;
  uniform float uInner;
  uniform float uOuter;
  uniform vec3 uSunLocal;
  uniform vec3 uViewLocal;
  varying vec3 vLocal;
  void main() {
    float r = length(vLocal.xz);
    float t = (r - uInner) / (uOuter - uInner);
    if (t < 0.0 || t > 1.0) discard;
    vec4 tex = texture2D(uRingTex, vec2(t, 0.5));
    vec3 s = uSunLocal;
    float b = dot(vLocal, s);
    float shadow = 1.0;
    if (b < 0.0) {
      vec3 cl = vLocal - s * b;
      if (length(cl * vec3(1.0, 1.0 / 0.902, 1.0)) < 1.0) shadow = 0.05;
    }
    float sameSide = sign(uSunLocal.y) * sign(uViewLocal.y);
    float light = sameSide > 0.0 ? 1.0 : (1.0 - tex.a) * 0.9 + 0.08;
    light *= clamp(abs(uSunLocal.y) * 4.0 + 0.2, 0.0, 1.0);
    vec3 c = tex.rgb * light * shadow * 1.35;
    gl_FragColor = vec4(c, clamp(tex.a * 1.15, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

const GLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CORONA_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uCore;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float x = max(r / uCore - 1.0, 0.0);
    float ang = atan(p.y, p.x);
    float rays = 0.8 + 0.2 * sin(ang * 7.0 + 0.6) * sin(ang * 3.0 - 1.1);
    float g = 0.6 * exp(-x * 3.2 / rays) + 0.1 * exp(-x * 1.4) + 0.012 * (1.0 - r);
    g *= smoothstep(1.0, 0.75, r);
    gl_FragColor = vec4(uColor * g, 1.0);
    #include <colorspace_fragment>
  }
`;

const ORBIT_VERT = /* glsl */ `
  attribute float aFrac;
  varying float vFrac;
  void main() {
    vFrac = aFrac;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ORBIT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uNow;
  uniform float uBase;
  uniform float uTrail;
  varying float vFrac;
  void main() {
    // Brightest just behind the planet, fading around the orbit.
    float d = fract(uNow - vFrac + 1.0);
    float a = uBase + uTrail * pow(1.0 - d, 5.0);
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }
`;

const MARKER_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uDpr;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uDpr;
  }
`;

const MARKER_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float g = exp(-r2 * 10.0) + 0.3 * exp(-r2 * 3.0) * (1.0 - r2);
    gl_FragColor = vec4(vColor * g * vAlpha, 1.0);
    #include <colorspace_fragment>
  }
`;

const TAIL_VERT = /* glsl */ `
  attribute float aT;
  attribute float aSide;
  uniform vec3 uHead;
  uniform vec3 uDir;
  uniform float uLen;
  uniform float uWidth;
  varying float vT;
  varying float vSide;
  void main() {
    vT = aT;
    vSide = aSide;
    vec3 p = uHead + uDir * (aT * uLen);
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = cross(uDir, toCam);
    float sl = length(side);
    side = sl > 1e-5 ? side / sl : vec3(0.0, 1.0, 0.0);
    p += side * aSide * uWidth * (0.04 + 0.96 * pow(aT, 0.75));
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const TAIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vT;
  varying float vSide;
  void main() {
    float along = pow(1.0 - vT, 1.7) * (0.35 + 0.65 * smoothstep(0.0, 0.12, vT));
    float across = pow(1.0 - vSide * vSide, 1.5);
    gl_FragColor = vec4(uColor * along * across * uIntensity, 1.0);
    #include <colorspace_fragment>
  }
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform mat3 uToEqj;
  uniform float uGain;
  varying vec3 vDir;
  void main() {
    vec3 e = normalize(uToEqj * vDir);
    float ra = atan(e.y, e.x);
    float dec = asin(clamp(e.z, -1.0, 1.0));
    vec2 uv = vec2(0.5 - ra / 6.2831853, 0.5 + dec / 3.14159265);
    // Seam-free derivatives across RA = 12h.
    float u2 = fract(uv.x + 0.5);
    vec2 dx = vec2(dFdx(uv.x), dFdx(uv.y));
    vec2 dy = vec2(dFdy(uv.x), dFdy(uv.y));
    vec2 dx2 = vec2(dFdx(u2), dx.y);
    vec2 dy2 = vec2(dFdy(u2), dy.y);
    if (abs(dx2.x) + abs(dy2.x) < abs(dx.x) + abs(dy.x)) { dx = dx2; dy = dy2; }
    vec3 c = textureGrad(uMap, uv, dx, dy).rgb;
    c = c * c * uGain;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

// ------------------------------------------------------------------ types

interface Label {
  el: HTMLDivElement;
  w: number;
  h: number;
  shown: boolean;
  x: number;
  y: number;
}

interface PlanetObj {
  def: PlanetDef;
  radius: number;
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  ring?: THREE.Mesh;
  ringMaterial?: THREE.ShaderMaterial;
  /** Compressed display position. */
  pos: THREE.Vector3;
  /** Heliocentric EQJ, AU. */
  helio: THREE.Vector3;
  orbitMaterial: THREE.ShaderMaterial;
  orbitCenterTT: number;
  label: Label;
}

interface SmallObj {
  el: SmallBodyElements;
  name: string;
  orbit: THREE.Line;
  pos: THREE.Vector3;
  helio: THREE.Vector3;
  label: Label;
  tailLengthAU: number;
  mag: number;
  ion?: THREE.Mesh;
  dust?: THREE.Mesh;
}

interface FocusAnim {
  t0: number;
  dur: number;
  fromTarget: THREE.Vector3;
  fromOffset: THREE.Vector3;
  toOffset: THREE.Vector3;
}

type Preset = 'inner' | 'outer';

interface Pickable {
  id: string;
  pos: THREE.Vector3;
  radius: number;
}

const MAX_MARKERS = 96;
const ORBIT_SAMPLES = 480;
const GRID_AU = [1, 5, 10, 20, 30, 50];

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function smoothstep01(k: number): number {
  return k * k * (3 - 2 * k);
}

function easeInOut(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

/** Shorter display name for comets: "C/2025 R2 (SWAN)" → "C/2025 R2 SWAN". */
function shortName(el: SmallBodyElements): string {
  return el.name.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
}

export class Orrery {
  private readonly root: HTMLDivElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly labelsEl: HTMLDivElement;
  private readonly panel: OrreryPanel;

  private readonly sphere = new THREE.SphereGeometry(1, 64, 40);
  private readonly tailGeometry: THREE.BufferGeometry;
  private readonly ringTex = Orrery.ringTexture();
  private earthTex: THREE.Texture | null = null;

  private readonly planets: PlanetObj[] = [];
  private readonly sunMesh: THREE.Mesh;
  private readonly corona: THREE.Mesh;
  private readonly moonMesh: THREE.Mesh;
  private readonly moonMaterial: THREE.ShaderMaterial;
  private readonly moonRing: THREE.LineLoop;
  private moonRingTT = NaN;
  private readonly moonPos = new THREE.Vector3();
  private readonly moonGeo = new THREE.Vector3();
  private readonly sky: THREE.Mesh;
  private readonly markers: THREE.Points;
  private readonly smallGroup = new THREE.Group();
  private readonly small = new Map<string, SmallObj>();
  private readonly gridLabels: { au: number; label: Label }[] = [];
  private readonly sunLabel: Label;
  private readonly moonLabel: Label;
  private readonly allLabels: Label[] = [];

  private orbitQueue: { planet: PlanetObj; k: number; positions: Float32Array; center: A.AstroTime }[] = [];

  private _visible = false;
  private initialized = false;
  private focusId = 'Sun';
  private preset: Preset | null = 'inner';
  private anim: FocusAnim | null = null;
  private readonly followPos = new THREE.Vector3();
  private showComets = true;
  private showAsteroids = true;
  private smallSource: readonly SmallBodyElements[] | null = null;
  private lastSmallScan = -Infinity;
  private lastSmallScanSim = 0;
  private lastPanelUpdate = 0;
  private time = new Date();
  private width = 1;
  private height = 1;
  private pointerDown: { x: number; y: number; t: number } | null = null;

  /** Saturn's ring profile, mipmapped: the orrery sees the rings strongly minified. */
  private static ringTexture(): THREE.DataTexture {
    const t = makeSaturnRingTexture();
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
    return t;
  }

  constructor(container: HTMLElement, private readonly textures: Record<string, THREE.Texture>) {
    this.root = document.createElement('div');
    this.root.className = 'orrery';
    this.root.style.display = 'none';

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x010208, 1);
    this.renderer.domElement.className = 'orrery-canvas';
    this.root.append(this.renderer.domElement);

    this.labelsEl = document.createElement('div');
    this.labelsEl.className = 'orrery-labels';
    this.root.append(this.labelsEl);
    container.append(this.root);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 9000);
    this.camera.position.set(0, 25, 35);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.8;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 2.4;
    this.controls.maxDistance = 520;
    this.controls.addEventListener('start', () => {
      this.anim = null;
    });

    // ---- Milky Way backdrop (EQJ equirectangular, RA = 0 at the centre, increasing left).
    const mw = this.textures.milkyway ?? null;
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 32),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uMap: { value: mw },
          uToEqj: { value: DISPLAY_TO_EQJ },
          uGain: { value: mw ? 0.14 : 0 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.sky.scale.setScalar(4000);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // ---- AU reference rings on the ecliptic.
    const gridMat = new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.07, depthWrite: false });
    for (const au of GRID_AU) {
      const pts: THREE.Vector3[] = [];
      const R = compressRadius(au);
      for (let k = 0; k < 256; k++) {
        const a = (k / 256) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R));
      }
      const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), gridMat);
      loop.renderOrder = 1;
      this.scene.add(loop);
      this.gridLabels.push({ au, label: this.makeLabel(`${au} AU`, 'grid') });
    }
    // Direction of the vernal equinox (♈︎), a faint spoke from the Sun.
    const spoke = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(SUN_RADIUS * 1.6, 0, 0), new THREE.Vector3(compressRadius(50), 0, 0)]),
      new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.05, depthWrite: false }),
    );
    this.scene.add(spoke);

    // ---- The Sun.
    this.sunMesh = new THREE.Mesh(this.sphere, this.bodyMaterial(this.textures.sun ?? null, '#ffd27a', 2));
    this.sunMesh.scale.setScalar(SUN_RADIUS);
    this.scene.add(this.sunMesh);
    this.corona = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT,
        fragmentShader: CORONA_FRAG,
        uniforms: { uColor: { value: new THREE.Color(1.0, 0.78, 0.45) }, uCore: { value: 1 / 7 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.corona.scale.setScalar(SUN_RADIUS * 7);
    this.corona.renderOrder = 5;
    this.scene.add(this.corona);
    this.sunLabel = this.makeLabel('Sun', 'planet sun', () => this.focus('Sun'));

    // ---- Planets.
    const earthUrl = `${import.meta.env.BASE_URL}tex/earth.jpg`;
    for (const def of PLANETS) {
      const tex = def.texture ? this.textures[def.texture] ?? null : null;
      const material = this.bodyMaterial(tex, def.color, def.gas ? 1 : 0, def.rim);
      const radius = displayRadius(def.radiusKm);
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(this.sphere, material);
      group.add(mesh);
      const p: PlanetObj = {
        def,
        radius,
        group,
        material,
        pos: new THREE.Vector3(),
        helio: new THREE.Vector3(),
        orbitMaterial: new THREE.ShaderMaterial({
          vertexShader: ORBIT_VERT,
          fragmentShader: ORBIT_FRAG,
          uniforms: {
            uColor: { value: new THREE.Color(def.color) },
            uNow: { value: 0 },
            uBase: { value: 0.2 },
            uTrail: { value: 0.75 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
        orbitCenterTT: NaN,
        label: this.makeLabel(def.id, 'planet', () => this.focus(def.id)),
      };
      p.label.el.style.setProperty('--c', def.color);
      if (def.id === 'Saturn') {
        const inner = this.ringTex.userData.inner as number;
        const outer = this.ringTex.userData.outer as number;
        const rg = new THREE.RingGeometry(inner, outer, 160, 1);
        rg.rotateX(-Math.PI / 2);
        const rm = new THREE.ShaderMaterial({
          vertexShader: RING_VERT,
          fragmentShader: RING_FRAG,
          uniforms: {
            uRingTex: { value: this.ringTex },
            uInner: { value: inner },
            uOuter: { value: outer },
            uSunLocal: { value: new THREE.Vector3(0, 1, 0) },
            uViewLocal: { value: new THREE.Vector3(0, 1, 0) },
          },
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(rg, rm);
        ring.renderOrder = 3;
        group.add(ring);
        p.ring = ring;
        p.ringMaterial = rm;
        const u = material.uniforms;
        u.uRingShadow.value = 1;
        u.uRingInner.value = inner;
        u.uRingOuter.value = outer;
        u.uRingTex.value = this.ringTex;
      }
      group.scale.set(radius, radius * (1 - def.flattening), radius);
      if (p.ring) p.ring.scale.set(1, 1 / (1 - def.flattening), 1);
      this.scene.add(group);
      this.planets.push(p);
    }
    new THREE.TextureLoader().load(
      earthUrl,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        t.wrapS = THREE.RepeatWrapping;
        this.earthTex = t;
        const earth = this.planet('Earth');
        if (earth) {
          earth.material.uniforms.uMap.value = t;
          earth.material.uniforms.uHasMap.value = 1;
        }
      },
      undefined,
      () => undefined,
    );

    // ---- The Moon, on an exaggerated orbit around Earth.
    this.moonMaterial = this.bodyMaterial(this.textures.moon ?? null, '#cfcac0', 0);
    this.moonMesh = new THREE.Mesh(this.sphere, this.moonMaterial);
    this.moonMesh.scale.setScalar(MOON_RADIUS);
    this.scene.add(this.moonMesh);
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(96 * 3), 3));
    this.moonRing = new THREE.LineLoop(ringGeo, new THREE.LineBasicMaterial({ color: 0xc9d4e6, transparent: true, opacity: 0.18, depthWrite: false }));
    this.moonRing.frustumCulled = false;
    this.scene.add(this.moonRing);
    this.moonLabel = this.makeLabel('Moon', 'moon', () => this.focus('Moon'));

    // ---- Point markers keep tiny bodies visible from afar.
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_MARKERS * 3), 3));
    mg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(MAX_MARKERS * 3), 3));
    mg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_MARKERS), 1));
    mg.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(MAX_MARKERS), 1));
    this.markers = new THREE.Points(
      mg,
      new THREE.ShaderMaterial({
        vertexShader: MARKER_VERT,
        fragmentShader: MARKER_FRAG,
        uniforms: { uDpr: { value: this.renderer.getPixelRatio() } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 6;
    this.scene.add(this.markers);

    // ---- Comet tails: one shared ribbon geometry, positioned in the vertex shader.
    const S = 24;
    const tPos = new Float32Array((S + 1) * 2 * 3);
    const aT = new Float32Array((S + 1) * 2);
    const aSide = new Float32Array((S + 1) * 2);
    const index: number[] = [];
    for (let i = 0; i <= S; i++) {
      aT[i * 2] = aT[i * 2 + 1] = i / S;
      aSide[i * 2] = -1;
      aSide[i * 2 + 1] = 1;
      if (i < S) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    this.tailGeometry = new THREE.BufferGeometry();
    this.tailGeometry.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    this.tailGeometry.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    this.tailGeometry.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    this.tailGeometry.setIndex(index);
    this.scene.add(this.smallGroup);

    this.panel = new OrreryPanel(this.root, {
      bodies: [{ id: 'Sun', name: 'Sun', color: '#ffcf7a' }, ...PLANETS.map((p) => ({ id: p.id, name: p.id, color: p.color }))],
      onFocus: (id) => this.focus(id),
      onPreset: (p) => this.applyPreset(p),
      onToggle: (kind, on) => {
        if (kind === 'comets') this.showComets = on;
        else this.showAsteroids = on;
        this.lastSmallScan = -Infinity;
      },
      onClose: () => this.onClose(),
    });

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.pointerDown;
      this.pointerDown = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      const id = this.pick(e.clientX, e.clientY);
      if (id) this.focus(id);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      canvas.style.cursor = this.pick(e.clientX, e.clientY) ? 'pointer' : '';
    });
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  /** Called when the panel's close button is pressed; the app may override it to keep its state in sync. */
  onClose: () => void = () => this.hide();

  get visible(): boolean {
    return this._visible;
  }

  show(): void {
    if (this._visible) return;
    this._visible = true;
    this.root.style.display = '';
    document.body.classList.add('orrery-mode');
    this.resize();
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this.root.style.display = 'none';
    document.body.classList.remove('orrery-mode');
  }

  /** Smoothly re-targets the camera on a body (planet id, 'Sun', 'Moon' or a small-body id) and follows it. */
  focus(bodyId: string, opts: { distance?: number; elevation?: number; duration?: number } = {}): void {
    const pos = this.positionOf(bodyId);
    if (!pos) return;
    this.focusId = bodyId;
    this.preset = null;
    const radius = this.radiusOf(bodyId);
    const offset = this.camera.position.clone().sub(this.controls.target);
    let dist = opts.distance;
    let dir: THREE.Vector3;
    if (bodyId === 'Sun') {
      dist ??= this.fitDistance(5);
      const az = Math.atan2(offset.z, offset.x);
      const el = opts.elevation ?? 0.5;
      dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    } else {
      const ringed = bodyId === 'Saturn';
      const s = this.small.get(bodyId);
      dist ??= this.fitDistance(s ? (s.el.kind === 'comet' ? 2.2 : 0.9) : Math.max(ringed ? radius * 2.33 * 1.45 : radius * 2.4, 0.4));
      // Look from a little off the sunward side so the body shows a gibbous, lit face.
      const sunward = tmpV.copy(pos).negate().setY(0);
      if (sunward.lengthSq() < 1e-9) sunward.set(1, 0, 0);
      dir = sunward.normalize().clone().applyAxisAngle(Y_AXIS, 0.75);
      dir.y = opts.elevation ?? 0.3;
      dir.normalize();
    }
    this.controls.minDistance = bodyId === 'Sun' ? SUN_RADIUS * 1.7 : Math.max(radius * 1.8, 0.2);
    this.anim = {
      t0: performance.now(),
      dur: opts.duration ?? 1400,
      fromTarget: this.controls.target.clone(),
      fromOffset: offset,
      toOffset: dir.multiplyScalar(dist),
    };
    this.followPos.copy(pos);
    this.panel.setActive(this.focusId, this.preset);
  }

  private applyPreset(p: Preset, duration = 1600): void {
    if (p === 'inner') this.focus('Sun', { distance: this.fitDistance(16), elevation: 0.6, duration });
    else this.focus('Sun', { distance: this.fitDistance(58), elevation: 0.72, duration });
    this.preset = p;
    this.panel.setActive(this.focusId, this.preset);
  }

  /** Camera distance at which a sphere of `radius` around the target fills the view comfortably. */
  private fitDistance(radius: number): number {
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    return radius / Math.min(tanV, tanV * (this.width / this.height));
  }

  update(time: Date, smallBodies: SmallBodyElements[]): void {
    if (!this._visible) return;
    this.time = time;
    const t = A.MakeTime(time);
    const now = performance.now();

    // ---- Planets.
    for (const p of this.planets) {
      const h = A.HelioVector(p.def.body, t);
      p.helio.set(h.x, h.y, h.z);
      toDisplay(h, p.pos);
      p.group.position.copy(p.pos);
      const axis = A.RotationAxis(p.def.body, t);
      const m = bodyOrientation(tmpV2.set(axis.north.x, axis.north.y, axis.north.z), axis.spin);
      m.premultiply(EQJ_TO_DISPLAY4);
      p.group.quaternion.setFromRotationMatrix(m);
      if (!Number.isNaN(p.orbitCenterTT)) p.orbitMaterial.uniforms.uNow.value = (((t.tt - p.orbitCenterTT) / p.def.period + 0.5) % 1 + 1) % 1;
      const u = p.material.uniforms;
      if (p.ring && p.ringMaterial) {
        tmpQ.copy(p.group.quaternion).invert();
        const sunLocal = tmpV.copy(p.pos).negate().normalize().applyQuaternion(tmpQ);
        p.ringMaterial.uniforms.uSunLocal.value.copy(sunLocal);
        u.uSunLocal.value.copy(sunLocal);
        p.ringMaterial.uniforms.uViewLocal.value.copy(this.camera.position).sub(p.pos).normalize().applyQuaternion(tmpQ);
        u.uWorldToLocal.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(tmpQ));
        u.uCenterW.value.copy(p.pos);
        u.uRadiusW.value = p.radius;
      }
    }
    const earth = this.planet('Earth')!;

    // ---- Moon.
    const gm = A.GeoMoon(t);
    eqjToDisplay(gm, this.moonGeo).normalize();
    this.moonPos.copy(earth.pos).addScaledVector(this.moonGeo, MOON_ORBIT);
    this.moonMesh.position.copy(this.moonPos);
    const mAxis = A.RotationAxis(A.Body.Moon, t);
    this.moonMesh.quaternion.setFromRotationMatrix(
      bodyOrientation(tmpV2.set(mAxis.north.x, mAxis.north.y, mAxis.north.z), mAxis.spin).premultiply(EQJ_TO_DISPLAY4),
    );
    if (Number.isNaN(this.moonRingTT) || Math.abs(t.tt - this.moonRingTT) > 5) this.buildMoonRing(t);
    this.moonRing.position.copy(earth.pos);

    // ---- Orbits, built incrementally so opening the view never hitches.
    if (!this.orbitQueue.length && this.planets.some((p) => Number.isNaN(p.orbitCenterTT) || Math.abs(t.tt - p.orbitCenterTT) > p.def.period * 3 + 3650))
      this.queueOrbits(t);
    this.buildOrbits(now);

    // ---- Comets and asteroids.
    if (smallBodies !== this.smallSource) {
      this.smallSource = smallBodies;
      this.lastSmallScan = -Infinity;
    }
    const simMs = time.getTime();
    const drift = Math.abs(simMs - this.lastSmallScanSim);
    if (now - this.lastSmallScan > 10000 || (drift > 2 * DAY_MS && now - this.lastSmallScan > 1200)) {
      this.lastSmallScan = now;
      this.lastSmallScanSim = simMs;
      this.rescanSmall(smallBodies, t);
    }
    this.updateSmall(t);

    // ---- Camera.
    if (!this.initialized) {
      this.initialized = true;
      const az = Math.atan2(earth.pos.z, earth.pos.x) - 0.9;
      const d = this.fitDistance(16);
      const el = 0.6;
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(Math.cos(el) * Math.cos(az) * d, Math.sin(el) * d, Math.cos(el) * Math.sin(az) * d);
      this.focusId = 'Sun';
      this.preset = 'inner';
      this.panel.setActive('Sun', 'inner');
    }
    this.updateCamera(now);

    this.corona.quaternion.copy(this.camera.quaternion);
    this.sky.position.copy(this.camera.position);
    this.updateMarkers();
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    if (now - this.lastPanelUpdate > 200) {
      this.lastPanelUpdate = now;
      this.updatePanel();
    }
  }

  dispose(): void {
    this.hide();
    window.removeEventListener('resize', this.resize);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.tailGeometry.dispose();
    this.ringTex.dispose();
    this.earthTex?.dispose();
    this.renderer.dispose();
    this.panel.dispose();
    this.root.remove();
  }

  // ------------------------------------------------------------------ building

  private bodyMaterial(tex: THREE.Texture | null, color: string, mode: number, rim?: [number, number, number, number]): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      uniforms: {
        uMap: { value: tex },
        uHasMap: { value: tex ? 1 : 0 },
        uColor: { value: new THREE.Color(color) },
        uMode: { value: mode },
        uRim: { value: new THREE.Vector4(...(rim ?? [0, 0, 0, 0])) },
        uRingShadow: { value: 0 },
        uWorldToLocal: { value: new THREE.Matrix3() },
        uCenterW: { value: new THREE.Vector3() },
        uRadiusW: { value: 1 },
        uSunLocal: { value: new THREE.Vector3(0, 1, 0) },
        uRingInner: { value: 1 },
        uRingOuter: { value: 2 },
        uRingTex: { value: null },
      },
    });
  }

  private queueOrbits(center: A.AstroTime): void {
    this.orbitQueue = this.planets.map((planet) => ({ planet, k: 0, positions: new Float32Array((ORBIT_SAMPLES + 1) * 3), center }));
  }

  /** Samples planetary orbits with the full theory (VSOP87 / Pluto integrator) within a per-frame time budget. */
  private buildOrbits(now: number): void {
    const v = new THREE.Vector3();
    while (this.orbitQueue.length && performance.now() - now < 5) {
      const job = this.orbitQueue[0];
      const P = job.planet.def.period;
      const body = job.planet.def.body;
      const end = Math.min(ORBIT_SAMPLES, job.k + 24);
      for (; job.k <= end; job.k++) {
        toDisplay(A.HelioVector(body, job.center.AddDays(-P / 2 + (P * job.k) / ORBIT_SAMPLES)), v);
        job.positions.set([v.x, v.y, v.z], job.k * 3);
      }
      if (job.k > ORBIT_SAMPLES) {
        this.orbitQueue.shift();
        this.installOrbit(job.planet, job.positions, job.center.tt);
      }
    }
  }

  private installOrbit(p: PlanetObj, positions: Float32Array, centerTT: number): void {
    const old = this.scene.getObjectByName(`orbit-${p.def.id}`) as THREE.Line | undefined;
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const frac = new Float32Array(ORBIT_SAMPLES + 1);
    for (let k = 0; k <= ORBIT_SAMPLES; k++) frac[k] = k / ORBIT_SAMPLES;
    g.setAttribute('aFrac', new THREE.BufferAttribute(frac, 1));
    const line = new THREE.Line(g, p.orbitMaterial);
    line.name = `orbit-${p.def.id}`;
    line.renderOrder = 2;
    this.scene.add(line);
    p.orbitCenterTT = centerTT;
  }

  private buildMoonRing(t: A.AstroTime): void {
    this.moonRingTT = t.tt;
    const attr = this.moonRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = attr.count;
    const v = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      eqjToDisplay(A.GeoMoon(t.AddDays((27.3217 * k) / n)), v).normalize().multiplyScalar(MOON_ORBIT);
      attr.setXYZ(k, v.x, v.y, v.z);
    }
    attr.needsUpdate = true;
  }

  // ------------------------------------------------------------------ small bodies

  private rescanSmall(list: readonly SmallBodyElements[], t: A.AstroTime): void {
    const want = new Map<string, { el: SmallBodyElements; tail: number; mag: number }>();
    if (this.showComets) {
      const comets = list.filter((e) => e.kind === 'comet');
      // Everything brighter than ~12 (as seen from Sacramento); when the sky is poor in
      // comets, top up with the few brightest so there is always something to explore.
      const bright = brightComets(comets, t, SACRAMENTO, 15.5)
        // Drop SOHO sungrazers and fragments, whose magnitudes are unreliable.
        .filter((x) => !/SOHO|\/\d{4} [A-Z]\d+-[A-Z]/.test(x.el.name))
        .filter((x, i) => x.state.mag <= 12 || i < 4)
        .slice(0, 14);
      for (const b of bright) want.set(b.el.id, { el: b.el, tail: b.state.tailLengthAU, mag: b.state.mag });
    }
    if (this.showAsteroids) for (const e of list) if (e.kind === 'asteroid') want.set(e.id, { el: e, tail: 0, mag: e.H });

    for (const [id, s] of this.small) {
      if (!want.has(id)) {
        this.smallGroup.remove(s.orbit);
        s.orbit.geometry.dispose();
        (s.orbit.material as THREE.Material).dispose();
        for (const m of [s.ion, s.dust]) {
          if (!m) continue;
          this.smallGroup.remove(m);
          (m.material as THREE.Material).dispose();
        }
        s.label.el.remove();
        this.allLabels.splice(this.allLabels.indexOf(s.label), 1);
        this.small.delete(id);
        if (this.focusId === id) this.applyPreset('inner');
      }
    }
    for (const [id, w] of want) {
      const existing = this.small.get(id);
      if (existing) {
        existing.tailLengthAU = w.tail;
        existing.mag = w.mag;
        continue;
      }
      const isComet = w.el.kind === 'comet';
      const pts = orbitPolyline(w.el, t, isComet ? 360 : 256);
      const positions = new Float32Array(pts.length * 3);
      const v = new THREE.Vector3();
      pts.forEach((p, k) => {
        toDisplay(p, v);
        positions.set([v.x, v.y, v.z], k * 3);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const orbit = new THREE.Line(
        g,
        new THREE.LineBasicMaterial({
          color: isComet ? 0x7fe8d0 : 0xb8b0a4,
          transparent: true,
          opacity: isComet ? 0.17 : 0.07,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      orbit.renderOrder = 2;
      this.smallGroup.add(orbit);
      const obj: SmallObj = {
        el: w.el,
        name: isComet ? shortName(w.el) : w.el.name,
        orbit,
        pos: new THREE.Vector3(),
        helio: new THREE.Vector3(),
        label: this.makeLabel(isComet ? shortName(w.el) : w.el.name, isComet ? 'comet' : 'asteroid', () => this.focus(id)),
        tailLengthAU: w.tail,
        mag: w.mag,
      };
      if (isComet) {
        obj.ion = this.makeTail(new THREE.Color(0.55, 0.8, 1.0));
        obj.dust = this.makeTail(new THREE.Color(1.0, 0.9, 0.7));
      }
      this.small.set(id, obj);
    }
  }

  private makeTail(color: THREE.Color): THREE.Mesh {
    const m = new THREE.Mesh(
      this.tailGeometry,
      new THREE.ShaderMaterial({
        vertexShader: TAIL_VERT,
        fragmentShader: TAIL_FRAG,
        uniforms: {
          uHead: { value: new THREE.Vector3() },
          uDir: { value: new THREE.Vector3(1, 0, 0) },
          uLen: { value: 1 },
          uWidth: { value: 0.1 },
          uColor: { value: color },
          uIntensity: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    m.frustumCulled = false;
    m.renderOrder = 4;
    this.smallGroup.add(m);
    return m;
  }

  private updateSmall(t: A.AstroTime): void {
    const vel = new THREE.Vector3();
    const later = t.AddDays(1);
    for (const s of this.small.values()) {
      const h = helioPosition(s.el, t);
      s.helio.set(h.x, h.y, h.z);
      toDisplay(h, s.pos);
      if (!s.ion || !s.dust) continue;
      const r = s.helio.length();
      const L = s.tailLengthAU;
      const show = L > 0 && r > 0;
      s.ion.visible = s.dust.visible = show;
      if (!show) continue;
      // Radial compression keeps directions, so anti-sunward is simply outward.
      const anti = tmpV.copy(s.pos).normalize();
      const len = THREE.MathUtils.clamp(compressRadius(r + L * 3) - compressRadius(r), 0.45, 7);
      const intensity = THREE.MathUtils.clamp(0.35 + (10 - s.mag) * 0.12, 0.3, 1.3);
      const iu = (s.ion.material as THREE.ShaderMaterial).uniforms;
      iu.uHead.value.copy(s.pos);
      iu.uDir.value.copy(anti);
      iu.uLen.value = len;
      iu.uWidth.value = 0.03 + len * 0.035;
      iu.uIntensity.value = intensity * 0.9;
      // Dust tail curves back along the orbit: between anti-sunward and trailing the motion.
      eqjToDisplay(helioPosition(s.el, later), vel).sub(eqjToDisplay(h, tmpV2)).normalize();
      const du = (s.dust.material as THREE.ShaderMaterial).uniforms;
      du.uHead.value.copy(s.pos);
      du.uDir.value.copy(anti).addScaledVector(vel, -0.45).normalize();
      du.uLen.value = len * 0.7;
      du.uWidth.value = 0.05 + len * 0.1;
      du.uIntensity.value = intensity * 0.55;
    }
  }

  // ------------------------------------------------------------------ camera

  private positionOf(id: string): THREE.Vector3 | null {
    if (id === 'Sun') return new THREE.Vector3(0, 0, 0);
    if (id === 'Moon') return this.moonPos;
    const p = this.planet(id);
    if (p) return p.pos;
    return this.small.get(id)?.pos ?? null;
  }

  private radiusOf(id: string): number {
    if (id === 'Sun') return SUN_RADIUS;
    if (id === 'Moon') return MOON_RADIUS;
    return this.planet(id)?.radius ?? 0.12;
  }

  private planet(id: string): PlanetObj | undefined {
    return this.planets.find((p) => p.def.id === id);
  }

  private updateCamera(now: number): void {
    const pos = this.positionOf(this.focusId);
    const target = this.controls.target;
    if (pos) {
      const a = this.anim;
      if (a) {
        const k = Math.min(1, (now - a.t0) / a.dur);
        const e = easeInOut(k);
        target.lerpVectors(a.fromTarget, pos, e);
        const d0 = a.fromOffset.length();
        const d1 = a.toOffset.length();
        const dist = Math.exp(THREE.MathUtils.lerp(Math.log(d0), Math.log(d1), e));
        const dir = tmpV.copy(a.fromOffset).normalize().lerp(tmpV2.copy(a.toOffset).normalize(), smoothstep01(e));
        if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
        dir.normalize().multiplyScalar(dist);
        this.camera.position.copy(target).add(dir);
        if (k >= 1) this.anim = null;
      } else {
        const delta = tmpV.copy(pos).sub(this.followPos);
        target.add(delta);
        this.camera.position.add(delta);
      }
      this.followPos.copy(pos);
    }
    this.controls.update();
    const d = this.camera.position.distanceTo(target);
    const near = THREE.MathUtils.clamp(d * 0.01, 0.004, 2);
    if (Math.abs(near - this.camera.near) > this.camera.near * 0.1) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  private resize = (): void => {
    const w = this.root.parentElement?.clientWidth || window.innerWidth;
    const h = this.root.parentElement?.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.9 ? 55 : 40;
    // Centre the scene in the space the UI leaves free: left of the panel on
    // desktop, above the bottom controls on phones.
    if (w <= 760) this.camera.setViewOffset(w, h, 0, Math.round(h * 0.07), w, h);
    else this.camera.setViewOffset(w, h, 110, 0, w, h);
    this.camera.updateProjectionMatrix();
    (this.markers.material as THREE.ShaderMaterial).uniforms.uDpr.value = this.renderer.getPixelRatio();
  };

  // ------------------------------------------------------------------ markers, labels, picking

  /** Screen position (CSS px) and projected radius; null when behind the camera. */
  private project(p: THREE.Vector3, radius: number): { x: number; y: number; r: number } | null {
    const v = tmpV.copy(p).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const dist = this.camera.position.distanceTo(p);
    const f = this.height / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height, r: (radius / Math.max(dist, 1e-6)) * f };
  }

  private projectedRadius(p: THREE.Vector3, radius: number): number {
    const f = this.height / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    return (radius / Math.max(this.camera.position.distanceTo(p), 1e-6)) * f;
  }

  private updateMarkers(): void {
    const g = this.markers.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = g.getAttribute('aColor') as THREE.BufferAttribute;
    const size = g.getAttribute('aSize') as THREE.BufferAttribute;
    const alpha = g.getAttribute('aAlpha') as THREE.BufferAttribute;
    const c = new THREE.Color();
    let n = 0;
    const push = (p: THREE.Vector3, color: THREE.Color, s: number, a: number) => {
      if (n >= MAX_MARKERS || a <= 0.01) return;
      pos.setXYZ(n, p.x, p.y, p.z);
      col.setXYZ(n, color.r, color.g, color.b);
      size.setX(n, s);
      alpha.setX(n, a);
      n++;
    };
    // The Sun keeps a bright point-like core when it is small on screen.
    const sunPx = this.projectedRadius(new THREE.Vector3(), SUN_RADIUS);
    push(new THREE.Vector3(), c.set(1, 0.85, 0.6), 34, THREE.MathUtils.clamp(1.2 - sunPx / 10, 0, 1));
    for (const p of this.planets) {
      const px = this.projectedRadius(p.pos, p.radius);
      push(p.pos, c.set(p.def.color), 9, THREE.MathUtils.clamp(1.3 - px / 5, 0, 1) * 0.95);
    }
    const earth = this.planet('Earth')!;
    const moonPx = this.projectedRadius(this.moonPos, MOON_RADIUS);
    const nearEarth = this.camera.position.distanceTo(earth.pos) < 16;
    if (nearEarth) push(this.moonPos, c.set(0.85, 0.85, 0.82), 5, THREE.MathUtils.clamp(1.3 - moonPx / 4, 0, 1) * 0.8);
    this.moonRing.visible = this.camera.position.distanceTo(earth.pos) < 60;
    for (const s of this.small.values()) {
      if (s.el.kind === 'comet') push(s.pos, c.set(0.75, 1.0, 0.92), 8, 1);
      else push(s.pos, c.set(0.85, 0.8, 0.72), 4.5, 0.75);
    }
    g.setDrawRange(0, n);
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = alpha.needsUpdate = true;
  }

  private makeLabel(text: string, cls: string, onClick?: () => void): Label {
    const el = document.createElement('div');
    el.className = `orrery-label ${cls}`;
    el.textContent = text;
    if (onClick) {
      el.classList.add('clickable');
      el.addEventListener('click', onClick);
    }
    this.labelsEl.append(el);
    const l: Label = { el, w: 0, h: 0, shown: false, x: NaN, y: NaN };
    this.allLabels.push(l);
    return l;
  }

  private updateLabels(): void {
    type Cand = { label: Label; x: number; y: number; pri: number; active?: boolean };
    const cands: Cand[] = [];
    const add = (label: Label, p: THREE.Vector3, radius: number, pri: number, id?: string) => {
      const s = this.project(p, radius);
      if (!s) return;
      const active = id !== undefined && id === this.focusId && !this.preset;
      cands.push({ label, x: s.x + Math.max(s.r, 3) + 6, y: s.y, pri: active ? 1000 : pri, active });
      return s;
    };
    add(this.sunLabel, new THREE.Vector3(), SUN_RADIUS * 1.15, 200, 'Sun');
    this.planets.forEach((p, i) => add(p.label, p.pos, p.ring ? p.radius * 2.2 : p.radius, p.def.id === 'Earth' ? 160 : 150 - i, p.def.id));
    const earth = this.planet('Earth')!;
    if (this.camera.position.distanceTo(earth.pos) < 10) add(this.moonLabel, this.moonPos, MOON_RADIUS, 120, 'Moon');
    for (const s of this.small.values()) {
      // Only the big four asteroids are labelled from afar; the rest when the camera is near.
      if (s.el.kind === 'asteroid' && s.el.H > 5.5 && this.camera.position.distanceTo(s.pos) > 12 && s.el.id !== this.focusId) continue;
      add(s.label, s.pos, 0.05, s.el.kind === 'comet' ? 80 - s.mag : 40 - s.el.H, s.el.id);
    }
    // AU rings: label each where it passes closest to the camera.
    const cam = this.camera.position;
    const az = Math.atan2(cam.z, cam.x);
    for (const g of this.gridLabels) {
      const R = compressRadius(g.au);
      add(g.label, tmpV2.set(Math.cos(az + 0.18) * R, 0, Math.sin(az + 0.18) * R).clone(), 0, 10 - g.au * 0.01);
    }

    cands.sort((a, b) => b.pri - a.pri);
    const placed: [number, number, number, number][] = [];
    const used = new Set<Label>();
    for (const c of cands) {
      const l = c.label;
      if (!l.w) {
        l.el.style.visibility = 'hidden';
        l.el.classList.add('on');
        l.w = l.el.offsetWidth;
        l.h = l.el.offsetHeight;
        l.el.style.visibility = '';
        l.el.classList.remove('on');
        if (!l.w) continue;
      }
      const x0 = c.x;
      const y0 = c.y - l.h / 2;
      const r: [number, number, number, number] = [x0 - 2, y0 - 1, x0 + l.w + 2, y0 + l.h + 1];
      if (r[0] < 0 || r[2] > this.width || r[1] < 0 || r[3] > this.height) continue;
      if (placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue;
      placed.push(r);
      used.add(l);
      const xr = Math.round(x0);
      const yr = Math.round(y0);
      if (xr !== l.x || yr !== l.y) {
        l.x = xr;
        l.y = yr;
        l.el.style.transform = `translate(${xr}px, ${yr}px)`;
      }
      l.el.classList.toggle('active', !!c.active);
      if (!l.shown) {
        l.shown = true;
        l.el.classList.add('on');
      }
    }
    for (const l of this.allLabels) {
      if (l.shown && !used.has(l)) {
        l.shown = false;
        l.el.classList.remove('on');
      }
    }
  }

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const items: Pickable[] = [{ id: 'Sun', pos: new THREE.Vector3(), radius: SUN_RADIUS }];
    for (const p of this.planets) items.push({ id: p.def.id, pos: p.pos, radius: p.ring ? p.radius * 1.6 : p.radius });
    items.push({ id: 'Moon', pos: this.moonPos, radius: MOON_RADIUS });
    for (const s of this.small.values()) items.push({ id: s.el.id, pos: s.pos, radius: 0.05 });
    let best: string | null = null;
    let bestD = Infinity;
    for (const it of items) {
      const s = this.project(it.pos, it.radius);
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      const reach = Math.max(s.r + 4, 16);
      // Prefer the body whose edge is closest, relative to its reach.
      const score = d / reach;
      if (d <= reach && score < bestD) {
        bestD = score;
        best = it.id;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ panel

  private updatePanel(): void {
    this.panel.setDate(
      new Intl.DateTimeFormat(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).format(this.time),
    );
    const earth = this.planet('Earth')!;
    const id = this.focusId;
    let text = '';
    const lt = (au: number) => {
      const min = (au * 499.004784) / 60;
      return min < 60 ? `${min.toFixed(1)} light-min` : `${(min / 60).toFixed(2)} light-h`;
    };
    if (this.preset) text = this.preset === 'inner' ? 'Mercury to Mars and the main asteroid belt' : 'The giant planets and Pluto';
    else if (id === 'Sun') text = `${earth.helio.length().toFixed(3)} AU from Earth · ${lt(earth.helio.length())}`;
    else if (id === 'Earth') text = `${earth.helio.length().toFixed(3)} AU from the Sun`;
    else if (id === 'Moon') {
      const km = A.GeoMoon(A.MakeTime(this.time));
      text = `${Math.round(Math.hypot(km.x, km.y, km.z) * 149597870.7).toLocaleString()} km from Earth`;
    } else {
      const helio = this.planet(id)?.helio ?? this.small.get(id)?.helio;
      if (helio) {
        const delta = tmpV.copy(helio).sub(earth.helio).length();
        const name = this.small.get(id)?.name;
        text = `${name ? `${name} · ` : ''}${helio.length().toFixed(2)} AU from the Sun · ${delta.toFixed(2)} AU from Earth (${lt(delta)})`;
      }
    }
    this.panel.setReadout(text);
  }
}

