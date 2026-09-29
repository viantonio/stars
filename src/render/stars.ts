import * as THREE from 'three';
import { GLSL_ATMOSPHERE } from '../astro/frames';
import type { StarCatalog } from '../data/catalog';

/** Approximate blackbody colour (linear sRGB, max component = 1) for a temperature in K. */
export function temperatureToRGB(T: number): THREE.Color {
  // Fit to the CIE 1931 blackbody locus (after Tanner Helland, refined).
  const t = T / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = new THREE.Color(
    THREE.MathUtils.clamp(r, 0, 255) / 255,
    THREE.MathUtils.clamp(g, 0, 255) / 255,
    THREE.MathUtils.clamp(b, 0, 255) / 255,
  );
  return c.convertSRGBToLinear();
}

/** Ballesteros (2012): effective temperature from B–V. */
export function bvToTemperature(bv: number): number {
  const x = THREE.MathUtils.clamp(bv, -0.4, 2.0);
  return 4600 * (1 / (0.92 * x + 1.7) + 1 / (0.92 * x + 0.62));
}

export function bvToColor(bv: number, saturation = 1): THREE.Color {
  const c = temperatureToRGB(bvToTemperature(bv));
  const max = Math.max(c.r, c.g, c.b);
  c.multiplyScalar(1 / max);
  const grey = (c.r + c.g + c.b) / 3;
  return new THREE.Color(
    grey + (c.r - grey) * saturation,
    grey + (c.g - grey) * saturation,
    grey + (c.b - grey) * saturation,
  );
}

export const POINT_VERT = /* glsl */ `
  attribute float aMag;
  attribute vec3 aColor;
  attribute float aSeed;
  uniform float uLimitMag;
  uniform float uExtinction;
  uniform float uTime;
  uniform float uTwinkle;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uHideBelow;
  uniform float uSkyDisplay;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHalo;
  ${GLSL_ATMOSPHERE}

  void main() {
    vec3 d = normalize(mat3(modelMatrix) * position);
    d = refractDir(d);
    float X = airmassFromY(d.y);
    float m = aMag + uExtinction * (X - 1.0);

    // Scintillation: stronger and slower near the horizon.
    float tw = uTwinkle * clamp(0.18 + (X - 1.0) * 0.12, 0.0, 1.0);
    float ph = aSeed * 6.2831;
    float n = sin(uTime * (9.0 + aSeed * 11.0) + ph * 7.0) * 0.55
            + sin(uTime * (17.0 + aSeed * 7.0) + ph * 3.0) * 0.3
            + sin(uTime * (29.0 + aSeed * 13.0) + ph) * 0.15;
    m += n * tw * 0.45;

    float b = uLimitMag - m;
    if (b <= 0.0 || (uHideBelow > 0.5 && d.y < -0.02)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    gl_Position = projectionMatrix * viewMatrix * vec4(d * 1000.0, 1.0);

    // Size and brightness grow logarithmically with brightness above the limit.
    float core = 2.4 + 0.72 * b + 0.05 * b * b;
    vHalo = clamp((b - 4.0) / 6.0, 0.0, 1.0);
    float size = core * (1.0 + vHalo * 3.2);
    gl_PointSize = size * uSize * uPixelRatio;
    vAlpha = smoothstep(-0.15, 0.9, b) * clamp(0.62 + b * 0.12, 0.0, 1.3);
    // Stars fade when the sky itself is bright (daylight contrast).
    vAlpha *= 1.0 - smoothstep(0.25, 0.7, uSkyDisplay) * 0.6;

    // Atmospheric reddening near the horizon.
    float redden = clamp((X - 1.5) / 12.0, 0.0, 1.0);
    vColor = aColor * mix(vec3(1.0), vec3(1.0, 0.72, 0.48), redden);
  }
`;

export const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHalo;
  uniform float uNightVision;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    // Core scaled to the inner part of the sprite when a halo is present.
    float k = 1.0 + vHalo * 3.2;
    float core = exp(-r2 * k * k * 3.2);
    float halo = vHalo * (exp(-r2 * 9.0) * 0.28 + (1.0 - sqrt(r2)) * 0.05);
    // Faint diffraction-like spikes for the very brightest stars.
    float spikes = vHalo * vHalo * 0.22 * (exp(-abs(p.x) * 40.0) + exp(-abs(p.y) * 40.0)) * (1.0 - sqrt(r2));
    float I = (core + halo + spikes) * vAlpha;
    vec3 col = mix(vColor, vec3(1.0), core * 0.55) * I;
    if (uNightVision > 0.5) col = vec3(dot(col, vec3(0.3, 0.59, 0.11)) * 1.2, 0.0, 0.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function pointUniforms(): Record<string, THREE.IUniform> {
  return {
    uLimitMag: { value: 6 },
    uExtinction: { value: 0.2 },
    uTime: { value: 0 },
    uTwinkle: { value: 1 },
    uSize: { value: 1 },
    uPixelRatio: { value: 1 },
    uHideBelow: { value: 1 },
    uRefraction: { value: 1 },
    uNightVision: { value: 0 },
    uSkyDisplay: { value: 0 },
  };
}

/**
 * A small, dynamic set of star-like points (planets, comets, satellites,
 * Jupiter's moons) sharing the star shader so their brightness is on the
 * same photometric scale. Directions are unit vectors in the parent frame.
 */
export class PointLayer {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private pos: Float32Array;
  private mag: Float32Array;
  private col: Float32Array;
  private geom: THREE.BufferGeometry;
  count = 0;

  constructor(readonly capacity: number, uniforms: Record<string, THREE.IUniform>) {
    this.pos = new Float32Array(capacity * 3);
    this.mag = new Float32Array(capacity).fill(99);
    this.col = new Float32Array(capacity * 3);
    const seed = new Float32Array(capacity).map((_, i) => ((i * 7919) % 101) / 101);
    const g = (this.geom = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aMag', new THREE.BufferAttribute(this.mag, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  begin(): void {
    this.count = 0;
  }

  push(dir: THREE.Vector3, mag: number, color: THREE.Color): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.pos[i * 3] = dir.x;
    this.pos[i * 3 + 1] = dir.y;
    this.pos[i * 3 + 2] = dir.z;
    this.mag[i] = mag;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    return i;
  }

  end(): void {
    for (let i = this.count; i < this.capacity; i++) this.mag[i] = 99;
    for (const k of ['position', 'aMag', 'aColor']) (this.geom.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
    this.geom.setDrawRange(0, Math.max(this.count, 0));
  }
}

export class StarField {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;

  constructor(catalog: StarCatalog, colorSaturation = 0.9) {
    const n = catalog.count;
    const pos = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    const col = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const d = catalog.data;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = d[i * 5];
      pos[i * 3 + 1] = d[i * 5 + 1];
      pos[i * 3 + 2] = d[i * 5 + 2];
      mag[i] = d[i * 5 + 3];
      const c = bvToColor(d[i * 5 + 4], colorSaturation);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      seed[i] = ((i * 2654435761) % 1000) / 1000;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: pointUniforms(),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
}
