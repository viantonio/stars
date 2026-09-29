import * as THREE from 'three';
import { slerpUnit } from './lines';

/**
 * Comet tails drawn as tapered, softly glowing ribbons on the sky. Each tail
 * is a strip of quads following the great circle from the head toward the
 * projected anti-solar direction; an ion tail (narrow, blue) and a dust tail
 * (wider, curved, yellow-white) are drawn per comet.
 */

const VERT = /* glsl */ `
  attribute float aT;
  attribute float aSide;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vT;
  varying float vSide;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vT = aT; vSide = aSide; vAlpha = aAlpha; vColor = aColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  varying float vT;
  varying float vSide;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uNightVision;
  void main() {
    float across = exp(-vSide * vSide * 3.5);
    float along = pow(1.0 - vT, 1.6) * smoothstep(0.0, 0.04, vT + 0.01);
    vec3 c = vColor * across * along * vAlpha;
    if (uNightVision > 0.5) c = vec3(dot(c, vec3(0.3, 0.59, 0.11)), 0.0, 0.0);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const SEG = 24;
const MAX_TAILS = 24;

export interface TailSpec {
  head: THREE.Vector3; // world unit dir
  tip: THREE.Vector3; // world unit dir of the tail end
  widthDeg: number;
  brightness: number;
  color: THREE.Color;
  curve?: THREE.Vector3; // sideways bend (world unit), for dust tails
}

export class CometTails {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private pos: Float32Array;
  private t: Float32Array;
  private side: Float32Array;
  private alpha: Float32Array;
  private color: Float32Array;
  private geom: THREE.BufferGeometry;

  constructor() {
    const verts = MAX_TAILS * (SEG + 1) * 2;
    this.pos = new Float32Array(verts * 3);
    this.t = new Float32Array(verts);
    this.side = new Float32Array(verts);
    this.alpha = new Float32Array(verts);
    this.color = new Float32Array(verts * 3);
    const idx: number[] = [];
    for (let k = 0; k < MAX_TAILS; k++) {
      const base = k * (SEG + 1) * 2;
      for (let i = 0; i < SEG; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = (this.geom = new THREE.BufferGeometry());
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aT', new THREE.BufferAttribute(this.t, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uNightVision: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  set(tails: TailSpec[], radius = 990): void {
    const n = Math.min(tails.length, MAX_TAILS);
    const p = new THREE.Vector3();
    const next = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const tl = tails[k];
      for (let i = 0; i <= SEG; i++) {
        const f = i / SEG;
        slerpUnit(tl.head, tl.tip, f, p);
        if (tl.curve) p.addScaledVector(tl.curve, Math.sin(f * Math.PI * 0.5) * f * tl.head.angleTo(tl.tip) * 0.35).normalize();
        slerpUnit(tl.head, tl.tip, Math.min(1, f + 1 / SEG), next);
        tangent.subVectors(next, p);
        if (tangent.lengthSq() < 1e-12) tangent.subVectors(tl.tip, tl.head);
        normal.crossVectors(p, tangent).normalize();
        const w = Math.tan(((tl.widthDeg * (0.25 + f)) * Math.PI) / 180);
        for (let s = 0; s < 2; s++) {
          const v = (k * (SEG + 1) + i) * 2 + s;
          const sign = s === 0 ? -1 : 1;
          const q = p.clone().addScaledVector(normal, sign * w).normalize().multiplyScalar(radius);
          this.pos[v * 3] = q.x;
          this.pos[v * 3 + 1] = q.y;
          this.pos[v * 3 + 2] = q.z;
          this.t[v] = f;
          this.side[v] = sign;
          this.alpha[v] = tl.brightness;
          this.color[v * 3] = tl.color.r;
          this.color[v * 3 + 1] = tl.color.g;
          this.color[v * 3 + 2] = tl.color.b;
        }
      }
    }
    for (const k of ['position', 'aT', 'aSide', 'aAlpha', 'aColor']) (this.geom.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
    this.geom.setDrawRange(0, n * SEG * 6);
  }
}
