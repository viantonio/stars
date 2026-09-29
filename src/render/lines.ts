import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { GLSL_ATMOSPHERE } from '../astro/frames';

export const SKY_RADIUS = 1000;

/**
 * Anti-aliased screen-space lines on the celestial sphere. Vertices are unit
 * vectors in the parent's frame; the shader projects them to the sky radius
 * and (optionally) applies atmospheric refraction in the world frame.
 */
export class SkyLines {
  readonly object: LineSegments2;
  readonly material: LineMaterial;
  private refractionUniform = { value: 1 };

  constructor(
    segments: Float32Array,
    opts: { color: THREE.ColorRepresentation; width?: number; opacity?: number; refract?: boolean; dashed?: boolean; renderOrder?: number; colors?: Float32Array },
  ) {
    const geom = new LineSegmentsGeometry();
    geom.setPositions(segments);
    if (opts.colors) geom.setColors(opts.colors);
    this.material = new LineMaterial({
      color: opts.colors ? 0xffffff : opts.color,
      vertexColors: !!opts.colors,
      linewidth: opts.width ?? 1.2,
      transparent: true,
      opacity: opts.opacity ?? 1,
      depthWrite: false,
      depthTest: true,
      dashed: !!opts.dashed,
      dashSize: 0.6,
      gapSize: 0.45,
      dashScale: 1,
      worldUnits: false,
      blending: THREE.AdditiveBlending,
    });
    const refract = opts.refract !== false;
    const ref = this.refractionUniform;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uRefraction = ref;
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', `${GLSL_ATMOSPHERE}\nvec3 skyPoint(vec3 p) {\n  vec3 d = normalize(mat3(modelMatrix) * p);\n  ${refract ? 'd = refractDir(d);' : ''}\n  return d * ${SKY_RADIUS.toFixed(1)};\n}\nvoid main() {`)
        .replace(
          'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );',
          'vec4 start = viewMatrix * vec4( skyPoint(instanceStart), 1.0 );',
        )
        .replace(
          'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
          'vec4 end = viewMatrix * vec4( skyPoint(instanceEnd), 1.0 );',
        );
    };
    // Distinct programs for refracted and unrefracted sets (they share onBeforeCompile's source).
    this.material.customProgramCacheKey = () => (refract ? 'sky-lines-r' : 'sky-lines-n');
    this.object = new LineSegments2(geom, this.material);
    if (opts.dashed) this.object.computeLineDistances();
    this.object.frustumCulled = false;
    this.object.renderOrder = opts.renderOrder ?? 3;
  }

  setRefraction(on: boolean): void {
    this.refractionUniform.value = on ? 1 : 0;
  }

  setResolution(w: number, h: number): void {
    this.material.resolution.set(w, h);
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

/** Great-circle interpolation so long segments hug the sphere. */
export function pushArc(out: number[], a: THREE.Vector3, b: THREE.Vector3, maxStepDeg = 2): void {
  const ang = a.angleTo(b);
  const steps = Math.max(1, Math.ceil((ang * 180) / Math.PI / maxStepDeg));
  const prev = a.clone();
  const cur = new THREE.Vector3();
  for (let i = 1; i <= steps; i++) {
    slerpUnit(a, b, i / steps, cur);
    out.push(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
    prev.copy(cur);
  }
}

export function slerpUnit(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const ang = a.angleTo(b);
  if (ang < 1e-6) return out.copy(a);
  const s = Math.sin(ang);
  const wa = Math.sin((1 - t) * ang) / s;
  const wb = Math.sin(t * ang) / s;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb);
}

/** Circle of constant "latitude" in a frame whose pole is +Z (equatorial) or +Y (world). */
export function latitudeCircle(out: number[], latDeg: number, poleAxis: 'z' | 'y', stepDeg = 2): void {
  const lat = (latDeg * Math.PI) / 180;
  const c = Math.cos(lat);
  const s = Math.sin(lat);
  const pt = (lon: number) =>
    poleAxis === 'z'
      ? new THREE.Vector3(c * Math.cos(lon), c * Math.sin(lon), s)
      : new THREE.Vector3(c * Math.sin(lon), s, -c * Math.cos(lon));
  for (let d = 0; d < 360; d += stepDeg) {
    const a = pt((d * Math.PI) / 180);
    const b = pt(((d + stepDeg) * Math.PI) / 180);
    out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

/** Meridian of constant "longitude" from pole to pole. */
export function longitudeLine(out: number[], lonDeg: number, poleAxis: 'z' | 'y', fromLat = -90, toLat = 90, stepDeg = 2): void {
  const lon = (lonDeg * Math.PI) / 180;
  const pt = (latDeg: number) => {
    const lat = (latDeg * Math.PI) / 180;
    const c = Math.cos(lat);
    return poleAxis === 'z'
      ? new THREE.Vector3(c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat))
      : new THREE.Vector3(c * Math.sin(lon), Math.sin(lat), -c * Math.cos(lon));
  };
  for (let l = fromLat; l < toLat; l += stepDeg) {
    const a = pt(l);
    const b = pt(Math.min(toLat, l + stepDeg));
    out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}
