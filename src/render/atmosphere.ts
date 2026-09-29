import * as THREE from 'three';
import { GLSL_DISPLAY } from '../astro/skyBrightness';

/**
 * Physically based sky: a single-scattering Rayleigh + Mie + ozone raymarch
 * is baked into small azimuth × altitude lookup tables (one lit by the Sun,
 * one by the Moon). The dome shader combines those with airglow, light
 * pollution and the Milky Way in linear flux units, then tone-maps per pixel.
 */

const LUT_W = 256;
const LUT_H = 192;

const LUT_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Altitude parameterisation shared with the dome: v in [0,1] -> alt in [-90°, 90°],
// quadratic so the horizon gets most of the resolution.
const GLSL_LUT_PARAM = /* glsl */ `
  float lutAltFromV(float v) { float t = 2.0 * v - 1.0; return sign(t) * t * t * 1.5707963; }
  float lutVFromAlt(float a) { float t = sign(a) * sqrt(abs(a) / 1.5707963); return 0.5 + 0.5 * t; }
`;

const LUT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uLightDir;     // world frame, unit
  uniform float uObserverKm;  // observer altitude above sea level
  uniform float uTurbidity;   // Mie multiplier (haze)
  uniform float uScale;       // keeps twilight radiance inside half-float range
  ${GLSL_LUT_PARAM}

  const float PI = 3.14159265;
  const float Rg = 6360.0;
  const float Rt = 6420.0;
  const vec3 betaR = vec3(5.802e-3, 13.558e-3, 33.1e-3);
  const float betaM = 3.996e-3;
  const vec3 betaO = vec3(0.650e-3, 1.881e-3, 0.085e-3);
  const float HR = 8.0;
  const float HM = 1.2;

  vec2 raySphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float d = b * b - c;
    if (d < 0.0) return vec2(1e9, -1e9);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }

  vec3 densities(float h) {
    float o = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
    return vec3(exp(-h / HR), exp(-h / HM), o);
  }

  vec3 extinctionOf(vec3 d) {
    return betaR * d.x + vec3(betaM * 1.11 * uTurbidity) * d.y + betaO * d.z;
  }

  void main() {
    float az = vUv.x * 2.0 * PI;
    float alt = lutAltFromV(vUv.y);
    vec3 rd = vec3(sin(az) * cos(alt), sin(alt), -cos(az) * cos(alt));
    vec3 ro = vec3(0.0, Rg + uObserverKm + 0.002, 0.0);

    vec2 tA = raySphere(ro, rd, Rt);
    vec2 tG = raySphere(ro, rd, Rg);
    float tMax = tA.y;
    if (tG.x > 0.0) tMax = min(tMax, tG.x);

    const int N = 24;
    const int NL = 8;
    float dt = tMax / float(N);
    vec3 odView = vec3(0.0);
    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    vec3 sumMS = vec3(0.0);
    for (int i = 0; i < N; i++) {
      float t = (float(i) + 0.5) * dt;
      vec3 p = ro + rd * t;
      float h = length(p) - Rg;
      vec3 d = densities(h) * dt;
      odView += d;
      // Light ray toward the source. When the planet blocks it (the Earth's
      // shadow at dusk), approximate the light scattered in from the sunlit
      // air just above the shadow line so twilight fades smoothly.
      vec2 lg = raySphere(p, uLightDir, Rg);
      float blocked = (lg.x > 0.0 && lg.x < 1e8) ? 1.0 : 0.0;
      // Altitude at which the light ray grazes the planet (negative = blocked).
      float tc = -dot(p, uLightDir);
      float graze = (tc > 0.0 ? length(p + uLightDir * tc) : length(p)) - Rg;
      vec3 odLight = vec3(0.0);
      float tl = raySphere(p, uLightDir, Rt).y;
      if (blocked < 0.5) {
        float dl = tl / float(NL);
        for (int j = 0; j < NL; j++) {
          vec3 q = p + uLightDir * (float(j) + 0.5) * dl;
          odLight += densities(length(q) - Rg) * dl;
        }
      } else {
        // Secondary light arrives from the sunlit upper air: a shorter,
        // ozone-filtered path, which is why the twilight zenith stays blue.
        odLight = vec3(densities(max(graze + 20.0, 0.0)).xy * 120.0, 120.0);
      }
      vec3 att = exp(-(extinctionOf(odView) + extinctionOf(odLight)));
      float shadowFade = blocked > 0.5 ? exp(graze / 9.0) * 0.55 : 1.0;
      sumR += d.x * att * shadowFade;
      sumM += d.y * att * shadowFade;
      // Crude isotropic multiple scattering.
      sumMS += (d.x * betaR + d.y * betaM) * att * shadowFade;
    }
    float mu = dot(rd, uLightDir);
    float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float g = 0.76;
    float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) /
      ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    vec3 L = sumR * betaR * phaseR + sumM * betaM * uTurbidity * phaseM + sumMS * 0.012;
    gl_FragColor = vec4(L * uScale, 1.0);
  }
`;

const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // at the far plane
  }
`;

const DOME_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform sampler2D uSunLut;
  uniform sampler2D uMoonLut;
  uniform sampler2D uMilkyWay;
  uniform mat3 uWorldToEqj;
  uniform float uSunFlux;      // zenith flux contributions (1 = 22 mag/arcsec²)
  uniform float uMoonFlux;
  uniform float uLpFlux;
  uniform float uNaturalFlux;
  uniform float uMilkyWayFlux; // flux of the brightest Milky Way texel
  uniform float uExtinction;
  uniform vec3 uLpColor;
  uniform float uLpAz;         // azimuth (rad) of the brightest light dome
  uniform float uLpLobe;       // 0..1 directional strength
  uniform float uSaturation;
  uniform float uNightVision;
  uniform float uShowGround;
  uniform float uExposure;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform float uSunDiskFlux;
  ${GLSL_LUT_PARAM}
  ${GLSL_DISPLAY}

  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  vec3 lut(sampler2D t, vec3 d) {
    float az = atan(d.x, -d.z);
    if (az < 0.0) az += 6.2831853;
    float alt = asin(clamp(d.y, -1.0, 1.0));
    return texture2D(t, vec2(az / 6.2831853, lutVFromAlt(alt))).rgb;
  }

  void main() {
    vec3 d = normalize(vDir);
    float alt = asin(clamp(d.y, -1.0, 1.0));
    float altDeg = degrees(alt);
    float aboveH = smoothstep(-2.5, 0.5, altDeg);

    vec3 F = vec3(0.0);

    // Sun and Moon scattering, normalised by their zenith radiance so the
    // absolute level follows the calibrated zenith brightness model.
    if (uSunFlux > 1e-6) {
      vec3 s = lut(uSunLut, d);
      float z = max(lum(texture2D(uSunLut, vec2(0.5, 1.0)).rgb), 1e-12);
      vec3 r = s / z;
      float rl = lum(r);
      // Soft-limit the horizon-to-zenith ratio (single scattering overshoots it in deep twilight).
      r *= (1.0 + 1.0 / 60.0) / (1.0 + rl / 60.0);
      F += r * uSunFlux;
    }
    if (uMoonFlux > 1e-6) {
      vec3 m = lut(uMoonLut, d);
      float z = max(lum(texture2D(uMoonLut, vec2(0.5, 1.0)).rgb), 1e-12);
      vec3 r = m / z;
      r *= (1.0 + 1.0 / 60.0) / (1.0 + lum(r) / 60.0);
      F += r * uMoonFlux;
    }

    // Airglow & zodiacal background: brighter toward the horizon (van Rhijn).
    float a = max(altDeg, 0.0);
    float vr = 1.0 / sqrt(1.0 - 0.96 * pow(cos(radians(a)), 2.0));
    F += vec3(0.5, 0.68, 1.25) * uNaturalFlux * mix(1.0, vr, 0.55) * aboveH;

    // Light pollution: a dome that climbs steeply toward the horizon, with an
    // optional lobe toward the nearest city.
    float az = atan(d.x, -d.z);
    float lobe = 1.0 + uLpLobe * 2.5 * pow(max(0.0, cos(az - uLpAz)), 3.0);
    float lp = (1.0 + 7.0 * exp(-a / 7.0) + 2.0 * exp(-a / 25.0)) / 3.2 * lobe;
    F += uLpColor * uLpFlux * lp * aboveH;

    // Milky Way, sampled in J2000 coordinates and dimmed by extinction.
    if (uMilkyWayFlux > 1e-4 && altDeg > -3.0) {
      vec3 e = uWorldToEqj * d;
      float ra = atan(e.y, e.x);
      float dec = asin(clamp(e.z, -1.0, 1.0));
      vec2 uv = vec2(fract(0.5 - ra / 6.2831853), 0.5 + dec / 3.14159265);
      vec3 mw = texture2D(uMilkyWay, uv).rgb;
      mw = pow(mw, vec3(2.25)); // stored with a square-root curve; slight extra contrast
      float X = 1.0 / (sin(radians(max(altDeg, 0.0))) + 0.50572 * pow(max(altDeg, 0.0) + 6.07995, -1.6364));
      float ext = pow(10.0, -0.4 * uExtinction * (X - 1.0));
      F += mw * uMilkyWayFlux * ext * aboveH;
    }

    F *= uExposure;
    float Y = max(lum(F), 1e-9);
    float T = displayFromFlux(Y);
    vec3 col = F / Y * T;
    // Gentle saturation control (dark-adapted eyes see little colour).
    col = mix(vec3(lum(col)), col, uSaturation);

    // Below the horizon (when the ground is hidden) darken toward the nadir.
    if (uShowGround < 0.5) col *= mix(0.35, 1.0, smoothstep(-40.0, 0.0, altDeg));

    if (uNightVision > 0.5) col = vec3(lum(col) * 1.1, 0.0, 0.0);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface AtmosphereParams {
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  sunFlux: number;
  moonFlux: number;
  lpFlux: number;
  naturalFlux: number;
  milkyWayFlux: number;
  extinction: number;
  worldToEqj: THREE.Matrix3;
  lpColor: THREE.Color;
  lpAzDeg: number;
  lpLobe: number;
  observerKm: number;
  turbidity: number;
  nightVision: boolean;
  showGround: boolean;
  saturation: number;
}

export class Atmosphere {
  readonly mesh: THREE.Mesh;
  private sunTarget: THREE.WebGLRenderTarget;
  private moonTarget: THREE.WebGLRenderTarget;
  private lutMaterial: THREE.ShaderMaterial;
  private lutScene = new THREE.Scene();
  private lutCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private lastSun = new THREE.Vector3(0, -2, 0);
  private lastMoon = new THREE.Vector3(0, -2, 0);
  private lastKey = '';
  readonly material: THREE.ShaderMaterial;

  constructor(milkyWay: THREE.Texture) {
    const opts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      depthBuffer: false,
    };
    this.sunTarget = new THREE.WebGLRenderTarget(LUT_W, LUT_H, opts);
    this.moonTarget = new THREE.WebGLRenderTarget(LUT_W, LUT_H, opts);
    this.sunTarget.texture.wrapS = THREE.RepeatWrapping;
    this.moonTarget.texture.wrapS = THREE.RepeatWrapping;

    this.lutMaterial = new THREE.ShaderMaterial({
      vertexShader: LUT_VERT,
      fragmentShader: LUT_FRAG,
      uniforms: {
        uLightDir: { value: new THREE.Vector3(0, 1, 0) },
        uObserverKm: { value: 0 },
        uTurbidity: { value: 1 },
        uScale: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.lutScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMaterial));

    this.material = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      uniforms: {
        uSunLut: { value: this.sunTarget.texture },
        uMoonLut: { value: this.moonTarget.texture },
        uMilkyWay: { value: milkyWay },
        uWorldToEqj: { value: new THREE.Matrix3() },
        uSunFlux: { value: 0 },
        uMoonFlux: { value: 0 },
        uLpFlux: { value: 0 },
        uNaturalFlux: { value: 1 },
        uMilkyWayFlux: { value: 0 },
        uExtinction: { value: 0.2 },
        uLpColor: { value: new THREE.Color(1, 0.75, 0.5) },
        uLpAz: { value: 0 },
        uLpLobe: { value: 0 },
        uSaturation: { value: 1 },
        uNightVision: { value: 0 },
        uShowGround: { value: 1 },
        uExposure: { value: 1 },
        uSunDir: { value: new THREE.Vector3() },
        uMoonDir: { value: new THREE.Vector3() },
        uSunDiskFlux: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 96, 64), this.material);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
  }

  /** Re-bake the scattering tables if the Sun or Moon moved noticeably. */
  update(renderer: THREE.WebGLRenderer, p: AtmosphereParams): void {
    const key = `${p.observerKm.toFixed(2)}|${p.turbidity.toFixed(2)}`;
    const force = key !== this.lastKey;
    this.lastKey = key;
    const u = this.lutMaterial.uniforms;
    u.uObserverKm.value = p.observerKm;
    u.uTurbidity.value = p.turbidity;
    const prevTarget = renderer.getRenderTarget();
    // The dome normalises by the zenith value, so any per-bake scale cancels out.
    const scaleFor = (dir: THREE.Vector3) => Math.pow(10, Math.max(0, -Math.asin(dir.y) * 57.2958) * 0.35 + 1);
    if (p.sunFlux > 1e-6 && (force || p.sunDir.angleTo(this.lastSun) > 0.0004)) {
      u.uLightDir.value.copy(p.sunDir);
      u.uScale.value = scaleFor(p.sunDir);
      renderer.setRenderTarget(this.sunTarget);
      renderer.render(this.lutScene, this.lutCamera);
      this.lastSun.copy(p.sunDir);
    }
    if (p.moonFlux > 1e-6 && (force || p.moonDir.angleTo(this.lastMoon) > 0.002)) {
      u.uLightDir.value.copy(p.moonDir);
      u.uScale.value = scaleFor(p.moonDir);
      renderer.setRenderTarget(this.moonTarget);
      renderer.render(this.lutScene, this.lutCamera);
      this.lastMoon.copy(p.moonDir);
    }
    renderer.setRenderTarget(prevTarget);

    const d = this.material.uniforms;
    d.uSunFlux.value = p.sunFlux;
    d.uMoonFlux.value = p.moonFlux;
    d.uLpFlux.value = p.lpFlux;
    d.uNaturalFlux.value = p.naturalFlux;
    d.uMilkyWayFlux.value = p.milkyWayFlux;
    d.uExtinction.value = p.extinction;
    d.uWorldToEqj.value.copy(p.worldToEqj);
    d.uLpColor.value.copy(p.lpColor);
    d.uLpAz.value = (p.lpAzDeg * Math.PI) / 180;
    d.uLpLobe.value = p.lpLobe;
    d.uNightVision.value = p.nightVision ? 1 : 0;
    d.uShowGround.value = p.showGround ? 1 : 0;
    d.uSaturation.value = p.saturation;
    d.uSunDir.value.copy(p.sunDir);
    d.uMoonDir.value.copy(p.moonDir);
  }

  dispose(): void {
    this.sunTarget.dispose();
    this.moonTarget.dispose();
    this.lutMaterial.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
