import * as THREE from 'three';
import { DEG, refraction, worldToAltAz, altAzToWorld } from '../astro/frames';
import { bodyOrientation, type BodyState, type MajorBodyId } from '../astro/solarsystem';

/**
 * Resolved discs for the Sun, Moon and planets. Each body is positioned in
 * the world frame on the CPU (so atmospheric refraction applies to discs too)
 * and oriented by its IAU pole and prime meridian, so phases, libration,
 * Saturn's ring tilt and the Moon's position angle are all physically correct.
 */

const DIST: Record<MajorBodyId, number> = {
  Pluto: 930, Neptune: 925, Uranus: 920, Saturn: 915, Jupiter: 910, Mars: 905, Sun: 960,
  Venus: 895, Mercury: 890, Moon: 860,
};

const BODY_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  varying vec3 vTangentW;
  varying vec3 vLocal;
  void main() {
    vUv = uv;
    vLocal = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    // East-pointing tangent on the sphere (local +Y is the pole).
    vec3 t = cross(vec3(0.0, 1.0, 0.0), normal);
    if (dot(t, t) < 1e-8) t = vec3(1.0, 0.0, 0.0);
    vTangentW = normalize(mat3(modelMatrix) * normalize(t));
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const BODY_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uNormalMap;
  uniform float uHasNormal;
  uniform vec3 uSunDir;       // world, from body toward the Sun
  uniform float uBrightness;
  uniform float uOcclusion;   // 1 = opaque (blocks stars), 0 = additive only
  uniform float uMode;        // 0 rocky (Lambert), 1 lunar (Lommel–Seeliger), 2 gas giant, 3 emissive sun
  uniform float uEarthshine;
  uniform vec3 uTint;
  uniform float uNightVision;
  // Lunar eclipse: Earth's shadow on the Moon.
  uniform vec3 uShadowDir;    // world, antisolar direction
  uniform float uUmbra;       // angular radius, radians
  uniform float uPenumbra;
  uniform float uBloodScale; // eyes see the umbra as dark while much of the Moon is lit
  // Saturn: ring shadow on the globe.
  uniform float uRingShadow;
  uniform mat3 uWorldToLocal;
  uniform float uRingInner;   // in units of the equatorial radius
  uniform float uRingOuter;
  uniform sampler2D uRingTex;
  uniform vec3 uExtinctionTint;
  uniform vec3 uCenterW;      // body centre, world
  uniform float uRadiusW;     // equatorial radius, world units
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  varying vec3 vTangentW;
  varying vec3 vLocal;

  void main() {
    vec3 albedo = texture2D(uMap, vUv).rgb * uTint;
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(-vPosW);
    if (uMode > 2.5) {
      // The Sun: limb darkening (Eddington approximation with colour).
      float mu = clamp(dot(N, V), 0.0, 1.0);
      vec3 ld = vec3(0.3, 0.2, 0.1) + vec3(0.7, 0.8, 0.9) * pow(vec3(mu), vec3(0.45, 0.6, 0.8));
      vec3 c = (0.85 + 0.15 * albedo) * ld * uBrightness * uExtinctionTint;
      if (uNightVision > 0.5) c = vec3(dot(c, vec3(0.3, 0.59, 0.11)), 0.0, 0.0);
      gl_FragColor = vec4(c, 1.0);
      return;
    }
    if (uHasNormal > 0.5) {
      vec3 T = normalize(vTangentW - N * dot(vTangentW, N));
      vec3 B = cross(N, T);
      vec3 nm = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
      N = normalize(T * nm.x + B * nm.y + N * nm.z);
    }
    vec3 Ng = normalize(vNormalW);
    float mu0 = dot(N, uSunDir);
    float mu = max(dot(Ng, V), 0.0);
    float lit;
    if (uMode > 0.5 && uMode < 1.5) {
      // Lommel–Seeliger with a soft terminator: the full Moon has no limb darkening.
      lit = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mu + 1e-4) : 0.0;
      lit *= smoothstep(-0.02, 0.06, dot(Ng, uSunDir));
    } else if (uMode > 1.5) {
      lit = max(mu0, 0.0) * (0.55 + 0.45 * pow(mu, 0.35));
    } else {
      lit = max(mu0, 0.0);
    }
    // Ring shadow on Saturn's globe.
    if (uRingShadow > 0.5 && lit > 0.0) {
      vec3 p = uWorldToLocal * (vPosW - uCenterW) / uRadiusW; // equatorial-radius units
      vec3 s = normalize(uWorldToLocal * uSunDir);
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
    vec3 c = albedo * lit;
    // Earthshine on the unlit Moon.
    c += albedo * uEarthshine * (1.0 - smoothstep(-0.1, 0.05, dot(Ng, uSunDir)));

    // Lunar eclipse shading.
    if (uUmbra > 0.0) {
      float a = acos(clamp(dot(normalize(vPosW), uShadowDir), -1.0, 1.0));
      float pen = clamp((uPenumbra - a) / max(uPenumbra - uUmbra, 1e-5), 0.0, 1.0);
      float umb = 1.0 - smoothstep(uUmbra - 0.0006, uUmbra + 0.0006, a);
      c *= 1.0 - pen * 0.55;
      // Sunlight refracted through Earth's atmosphere: coppery, brighter near the umbra's edge.
      float edge = clamp(a / uUmbra, 0.0, 1.0);
      vec3 blood = vec3(0.75, 0.22, 0.07) * (0.35 + 0.65 * albedo) * (0.28 + 0.9 * edge * edge) * uBloodScale;
      c = mix(c, blood, umb);
    }
    c *= uBrightness * uExtinctionTint;
    if (uNightVision > 0.5) c = vec3(dot(c, vec3(0.3, 0.59, 0.11)), 0.0, 0.0);
    gl_FragColor = vec4(c, uOcclusion);
  }
`;

const RING_VERT = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vPosW;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const RING_FRAG = /* glsl */ `
  uniform sampler2D uRingTex;
  uniform float uInner;
  uniform float uOuter;
  uniform vec3 uSunLocal;     // unit, planet-local frame (ring plane = XZ)
  uniform vec3 uViewLocal;    // unit, from planet toward the observer
  uniform float uBrightness;
  uniform float uOcclusion;
  uniform float uNightVision;
  uniform vec3 uExtinctionTint;
  varying vec3 vLocal;
  void main() {
    float r = length(vLocal.xz);
    float t = (r - uInner) / (uOuter - uInner);
    if (t < 0.0 || t > 1.0) discard;
    vec4 tex = texture2D(uRingTex, vec2(t, 0.5));
    // Planet's shadow on the rings.
    vec3 s = uSunLocal;
    float b = dot(vLocal, s);
    float shadow = 1.0;
    if (b < 0.0) {
      vec3 closest = vLocal - s * b;
      // Ring radii are in equatorial-radius units; account for the oblate globe.
      if (length(closest * vec3(1.0, 1.0 / 0.902, 1.0)) < 1.0) shadow = 0.04;
    }
    // Lit vs unlit face: the unlit face transmits light through thin regions only.
    float sameSide = sign(uSunLocal.y) * sign(uViewLocal.y);
    float light = sameSide > 0.0 ? 1.0 : (1.0 - tex.a) * 0.9 + 0.05;
    light *= clamp(abs(uSunLocal.y) * 4.0 + 0.15, 0.0, 1.0);
    vec3 c = tex.rgb * light * shadow * uBrightness * uExtinctionTint;
    if (uNightVision > 0.5) c = vec3(dot(c, vec3(0.3, 0.59, 0.11)), 0.0, 0.0);
    gl_FragColor = vec4(c * tex.a, tex.a * uOcclusion);
  }
`;

const GLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uCore;        // disc radius as a fraction of the sprite
  uniform float uCorona;      // 0..1 during totality
  uniform float uNightVision;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float x = r / uCore;
    // Glare: sharp inner bloom + wide atmospheric scattering halo.
    float g = 0.9 * exp(-max(x - 1.0, 0.0) * 1.6) * step(1.0, x) + 0.22 * exp(-r * 5.0) + 0.06 * (1.0 - r);
    vec3 c = uColor * g * uIntensity;
    if (uCorona > 0.0) {
      float ang = atan(p.y, p.x);
      float streamers = 0.6 + 0.4 * sin(ang * 3.0 + 1.3) * sin(ang * 5.0 + 0.4) + 0.2 * hash(vec2(floor(ang * 40.0), 1.0));
      float cor = exp(-max(x - 1.0, 0.0) * mix(1.2, 3.0, 1.0 - streamers)) * step(1.0, x);
      c += vec3(0.85, 0.9, 1.0) * cor * uCorona * 0.9;
    }
    if (uNightVision > 0.5) c = vec3(dot(c, vec3(0.3, 0.59, 0.11)), 0.0, 0.0);
    gl_FragColor = vec4(c, 1.0);
  }
`;

/** Procedural ring profile for Saturn (radii in km, from Voyager/Cassini). */
export function makeSaturnRingTexture(): THREE.DataTexture {
  const W = 1024;
  const R_IN = 66900;
  const R_OUT = 140300;
  const data = new Uint8Array(W * 4);
  const noise = (x: number) => Math.sin(x * 12.9898) * 43758.5453 % 1;
  for (let i = 0; i < W; i++) {
    const r = R_IN + ((R_OUT - R_IN) * i) / (W - 1);
    let a = 0;
    let c: [number, number, number] = [0.8, 0.75, 0.66];
    if (r < 74490) a = 0.02; // D ring
    else if (r < 91980) { a = 0.08 + 0.1 * ((r - 74490) / 17490); c = [0.55, 0.5, 0.45]; } // C ring
    else if (r < 117580) { a = 0.75 + 0.2 * Math.sin((r - 91980) / 25600 * Math.PI); c = [0.92, 0.85, 0.72]; } // B ring
    else if (r < 122170) { a = 0.05; c = [0.4, 0.38, 0.35]; } // Cassini division
    else if (r < 136775) { a = 0.55; c = [0.85, 0.79, 0.68]; if (Math.abs(r - 133589) < 160) a = 0.03; if (Math.abs(r - 136530) < 20) a = 0.1; } // A ring, Encke & Keeler gaps
    else if (Math.abs(r - 140221) < 120) { a = 0.35; } // F ring
    a *= 0.9 + 0.2 * Math.abs(noise(i * 0.37));
    data[i * 4] = c[0] * 255;
    data[i * 4 + 1] = c[1] * 255;
    data[i * 4 + 2] = c[2] * 255;
    data[i * 4 + 3] = Math.min(1, a) * 255;
  }
  const t = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  (t.userData as { inner: number; outer: number }).inner = R_IN / 60268;
  (t.userData as { inner: number; outer: number }).outer = R_OUT / 60268;
  return t;
}

export interface BodyFrameParams {
  states: Map<MajorBodyId, BodyState>;
  eqjToWorld: THREE.Matrix4;
  refraction: boolean;
  /** Daylight factor 0 (night) – 1 (day) for occlusion/brightness blending. */
  daylight: number;
  /** Visual enlargement factor for the Moon and planets. */
  scale: number;
  nightVision: boolean;
  extinction: number;
  eclipseObscuration: number;
  /** Moonlight remaining during a lunar eclipse (1 = none eclipsed). */
  moonDim: number;
  fov: number;
  /** Earth's shadow geometry for lunar eclipses (world antisolar dir, radii in rad). */
  shadow: { dir: THREE.Vector3; umbra: number; penumbra: number } | null;
}

interface BodyMesh {
  id: MajorBodyId;
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  ring?: THREE.Mesh;
  ringMaterial?: THREE.ShaderMaterial;
}

export class BodyRenderer {
  readonly group = new THREE.Group();
  private meshes = new Map<MajorBodyId, BodyMesh>();
  private sunGlow: THREE.Mesh;
  private moonGlow: THREE.Mesh;
  /** World-frame apparent directions (after refraction), updated each frame. */
  readonly worldDirs = new Map<MajorBodyId, THREE.Vector3>();
  private ringTex = makeSaturnRingTexture();

  constructor(textures: Partial<Record<string, THREE.Texture>>) {
    const geo = new THREE.SphereGeometry(1, 96, 64);
    const ids: MajorBodyId[] = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
    for (const id of ids) {
      const tex = textures[id.toLowerCase()] ?? null;
      const mode = id === 'Sun' ? 3 : id === 'Moon' ? 1 : ['Jupiter', 'Saturn', 'Uranus', 'Neptune'].includes(id) ? 2 : 0;
      const material = new THREE.ShaderMaterial({
        vertexShader: BODY_VERT,
        fragmentShader: BODY_FRAG,
        uniforms: {
          uMap: { value: tex },
          uNormalMap: { value: id === 'Moon' ? textures.moon_normal ?? null : null },
          uHasNormal: { value: id === 'Moon' && textures.moon_normal ? 1 : 0 },
          uSunDir: { value: new THREE.Vector3() },
          uBrightness: { value: 1 },
          uOcclusion: { value: 1 },
          uMode: { value: mode },
          uEarthshine: { value: 0 },
          uTint: { value: new THREE.Color(1, 1, 1) },
          uNightVision: { value: 0 },
          uShadowDir: { value: new THREE.Vector3() },
          uUmbra: { value: 0 },
          uPenumbra: { value: 0 },
          uBloodScale: { value: 1 },
          uRingShadow: { value: id === 'Saturn' ? 1 : 0 },
          uWorldToLocal: { value: new THREE.Matrix3() },
          uRingInner: { value: this.ringTex.userData.inner },
          uRingOuter: { value: this.ringTex.userData.outer },
          uRingTex: { value: this.ringTex },
          uExtinctionTint: { value: new THREE.Color(1, 1, 1) },
          uCenterW: { value: new THREE.Vector3() },
          uRadiusW: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        // Premultiplied: lit colour adds, alpha occludes what is behind.
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      });
      const mesh = new THREE.Mesh(geo, material);
      mesh.renderOrder = id === 'Sun' ? 7 : id === 'Moon' ? 9 : 8;
      mesh.frustumCulled = false;
      const group = new THREE.Group();
      group.add(mesh);
      const bm: BodyMesh = { id, group, mesh, material };
      if (id === 'Saturn') {
        const inner = this.ringTex.userData.inner as number;
        const outer = this.ringTex.userData.outer as number;
        const rg = new THREE.RingGeometry(inner, outer, 180, 1);
        rg.rotateX(-Math.PI / 2); // ring plane = local XZ (equator)
        const rm = new THREE.ShaderMaterial({
          vertexShader: RING_VERT,
          fragmentShader: RING_FRAG,
          uniforms: {
            uRingTex: { value: this.ringTex },
            uInner: { value: inner },
            uOuter: { value: outer },
            uSunLocal: { value: new THREE.Vector3() },
            uViewLocal: { value: new THREE.Vector3() },
            uBrightness: { value: 1 },
            uOcclusion: { value: 1 },
            uNightVision: { value: 0 },
            uExtinctionTint: { value: new THREE.Color(1, 1, 1) },
          },
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneMinusSrcAlphaFactor,
        });
        const ring = new THREE.Mesh(rg, rm);
        ring.renderOrder = 8;
        ring.frustumCulled = false;
        group.add(ring);
        bm.ring = ring;
        bm.ringMaterial = rm;
      }
      this.group.add(group);
      this.meshes.set(id, bm);
    }

    const glowMat = () =>
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(1, 0.95, 0.85) },
          uIntensity: { value: 1 },
          uCore: { value: 0.05 },
          uCorona: { value: 0 },
          uNightVision: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      });
    this.sunGlow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glowMat());
    this.sunGlow.renderOrder = 10;
    this.sunGlow.frustumCulled = false;
    this.moonGlow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glowMat());
    this.moonGlow.renderOrder = 6;
    this.moonGlow.frustumCulled = false;
    this.group.add(this.sunGlow, this.moonGlow);
  }

  /** Pixel diameter of a body for the current camera. */
  static pixelDiameter(angularRadiusDeg: number, fovDeg: number, viewportH: number, scale = 1): number {
    return ((2 * angularRadiusDeg * scale) / fovDeg) * viewportH;
  }

  update(p: BodyFrameParams, camera: THREE.PerspectiveCamera): void {
    const m3 = new THREE.Matrix3().setFromMatrix4(p.eqjToWorld);
    const tmpDir = new THREE.Vector3();
    const orient = new THREE.Matrix4();
    // Apparent world directions (with refraction) for every body, drawn or not.
    for (const [id, s] of p.states) {
      const d = s.dirEqj.clone().applyMatrix3(m3).normalize();
      if (p.refraction) {
        const { alt, az } = worldToAltAz(d);
        altAzToWorld(alt + refraction(alt), az, d);
      }
      this.worldDirs.set(id, d);
    }
    for (const [id, bm] of this.meshes) {
      const s = p.states.get(id);
      if (!s) continue;
      tmpDir.copy(this.worldDirs.get(id)!);
      const dist = DIST[id];
      const scale = id === 'Sun' ? 1 : p.scale;
      const r = dist * Math.tan(s.angularRadius * DEG * scale);
      bm.group.position.copy(tmpDir).multiplyScalar(dist);
      orient.multiplyMatrices(p.eqjToWorld, bodyOrientation(s.pole, s.spin));
      bm.group.quaternion.setFromRotationMatrix(orient);
      const f = (THREE.MathUtils.clamp(s.info.flattening, 0, 0.2));
      bm.group.scale.set(r, r * (1 - f), r);
      bm.group.visible = true;

      const u = bm.material.uniforms;
      u.uSunDir.value.copy(s.sunDirEqj).applyMatrix3(m3).normalize();
      u.uCenterW.value.copy(bm.group.position);
      u.uRadiusW.value = r;
      u.uNightVision.value = p.nightVision ? 1 : 0;

      // Atmospheric extinction tint by altitude.
      const alt = Math.asin(THREE.MathUtils.clamp(tmpDir.y, -1, 1)) / DEG;
      const tint = extinctionTint(alt, p.extinction);
      u.uExtinctionTint.value.copy(tint);

      if (id === 'Sun') {
        u.uBrightness.value = 1.6;
      } else if (id === 'Moon') {
        // Bright against the night, washed out by day.
        u.uBrightness.value = THREE.MathUtils.lerp(2.3, 0.7, p.daylight);
        // Opaque against the Sun during a solar eclipse, translucent in daylight otherwise.
        // Opaque: the skylight is added in front afterwards (see Atmosphere).
        u.uOcclusion.value = 1;
        u.uEarthshine.value = 0.035 * Math.pow(1 - s.phase, 2) * (1 - p.daylight);
        if (p.shadow) {
          u.uShadowDir.value.copy(p.shadow.dir);
          u.uUmbra.value = p.shadow.umbra;
          u.uPenumbra.value = p.shadow.penumbra;
          u.uBloodScale.value = 0.2 + 0.8 * (1 - THREE.MathUtils.smoothstep(p.moonDim, 0.01, 0.35));
        } else {
          u.uUmbra.value = 0;
        }
      } else {
        u.uBrightness.value = THREE.MathUtils.lerp(1.6, 0.8, p.daylight);
        u.uOcclusion.value = 1;
      }
      if (bm.ring && bm.ringMaterial) {
        // Ring lighting in the planet-local frame.
        const inv = new THREE.Matrix3().setFromMatrix4(orient).transpose();
        const ru = bm.ringMaterial.uniforms;
        ru.uSunLocal.value.copy(u.uSunDir.value).applyMatrix3(inv).normalize();
        ru.uViewLocal.value.copy(tmpDir).multiplyScalar(-1).applyMatrix3(inv).normalize();
        ru.uBrightness.value = u.uBrightness.value;
        ru.uOcclusion.value = u.uOcclusion.value;
        ru.uNightVision.value = u.uNightVision.value;
        ru.uExtinctionTint.value.copy(tint);
        bm.ring.scale.set(1, 1 / (1 - f), 1);
        u.uWorldToLocal.value.copy(inv);
      }

      if (id === 'Sun' || id === 'Moon') {
        const glow = id === 'Sun' ? this.sunGlow : this.moonGlow;
        const size = id === 'Sun' ? dist * Math.tan(12 * DEG) : dist * Math.tan(4 * DEG);
        glow.position.copy(bm.group.position).multiplyScalar(id === 'Sun' ? 0.999 : 1.001);
        glow.quaternion.copy(camera.quaternion);
        glow.scale.setScalar(size);
        const gu = (glow.material as THREE.ShaderMaterial).uniforms;
        gu.uCore.value = r / size;
        gu.uNightVision.value = p.nightVision ? 1 : 0;
        gu.uColor.value.set(id === 'Sun' ? 0xfff1d6 : 0xdfe6ff).multiply(tint);
        if (id === 'Sun') {
          const vis = 1 - p.eclipseObscuration;
          // The aureole is broad; tone it down when zoomed in so the disc stays readable.
          gu.uIntensity.value = 1.4 * Math.pow(vis, 1.5) * THREE.MathUtils.clamp(p.fov / 25, 0.15, 1);
          gu.uCorona.value = THREE.MathUtils.smoothstep(p.eclipseObscuration, 0.985, 1.0);
        } else {
          gu.uIntensity.value = 0.22 * Math.pow(s.phase, 1.5) * (1 - p.daylight) * Math.sqrt(p.moonDim);
        }
        glow.visible = alt > -3;
      }
    }
  }

  setVisible(id: MajorBodyId, v: boolean): void {
    const bm = this.meshes.get(id);
    if (bm) bm.group.visible = v;
  }
}

/** Colour transmitted through the atmosphere at an altitude (reddening toward the horizon). */
export function extinctionTint(altDeg: number, k: number): THREE.Color {
  const a = Math.max(altDeg, -1);
  const X = 1 / (Math.sin(a * DEG) + 0.50572 * Math.pow(a + 6.07995, -1.6364));
  const kk = Math.max(k, 0.12);
  // Wavelength-dependent extinction (B, V, R-ish ratios).
  const r = Math.pow(10, -0.4 * kk * 0.55 * (X - 1));
  const g = Math.pow(10, -0.4 * kk * 1.0 * (X - 1));
  const b = Math.pow(10, -0.4 * kk * 1.75 * (X - 1));
  const m = Math.max(r, 1e-3);
  return new THREE.Color(r / m, g / m, b / m).multiplyScalar(Math.max(0.25, Math.min(1, m * 1.3)));
}
