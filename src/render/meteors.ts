import * as THREE from 'three';
import { altAzToWorld } from '../astro/frames';
import { slerpUnit } from './lines';

/**
 * Shooting stars. Meteors are spawned at a rate derived from the active
 * showers (radiant altitude, ZHR, limiting magnitude) plus the sporadic
 * background, then streak away from their radiant along great circles.
 */

interface Meteor {
  start: THREE.Vector3;
  end: THREE.Vector3;
  age: number;
  life: number;
  mag: number;
  color: THREE.Color;
}

export interface RadiantSource {
  /** World unit direction of the radiant. */
  dir: THREE.Vector3;
  /** Meteors per hour visible to this observer. */
  hourlyRate: number;
  speedKms: number;
}

const MAX = 32;
const TRAIL = 14;

const VERT = /* glsl */ `
  attribute float aFade;
  attribute vec3 aColor;
  varying float vFade;
  varying vec3 vColor;
  void main() {
    vFade = aFade; vColor = aColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  varying float vFade;
  varying vec3 vColor;
  uniform float uNightVision;
  void main() {
    vec3 c = vColor * vFade;
    if (uNightVision > 0.5) c = vec3(dot(c, vec3(0.3, 0.59, 0.11)), 0.0, 0.0);
    gl_FragColor = vec4(c, 1.0);
  }
`;

export class MeteorShowerFX {
  readonly lines: THREE.LineSegments;
  readonly material: THREE.ShaderMaterial;
  private meteors: Meteor[] = [];
  private pos = new Float32Array(MAX * TRAIL * 2 * 3);
  private fade = new Float32Array(MAX * TRAIL * 2);
  private col = new Float32Array(MAX * TRAIL * 2 * 3);
  private geom = new THREE.BufferGeometry();

  constructor() {
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('aFade', new THREE.BufferAttribute(this.fade, 1).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uNightVision: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.lines = new THREE.LineSegments(this.geom, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;
  }

  /**
   * @param simSeconds simulated seconds elapsed this frame (≥ 0)
   * @param realSeconds wall-clock seconds this frame (animation speed)
   */
  update(sources: RadiantSource[], sporadicPerHour: number, simSeconds: number, realSeconds: number, limitingMag: number): void {
    // Poisson spawning. Rates are capped so fast-forwarding stays pleasant.
    const hours = Math.min(simSeconds / 3600, realSeconds * 0.05);
    const trySpawn = (rate: number, radiant: THREE.Vector3 | null, speed: number) => {
      const expected = rate * hours;
      let n = 0;
      let p = Math.random();
      const L = Math.exp(-expected);
      while (p > L && n < 3) {
        n++;
        p *= Math.random();
      }
      for (let i = 0; i < n; i++) this.spawn(radiant, speed, limitingMag);
    };
    if (hours > 0) {
      for (const s of sources) trySpawn(s.hourlyRate, s.dir, s.speedKms);
      trySpawn(sporadicPerHour, null, 30 + Math.random() * 30);
    }

    let v = 0;
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    this.meteors = this.meteors.filter((m) => (m.age += realSeconds) < m.life);
    for (const m of this.meteors) {
      const t = m.age / m.life;
      // Head moves quickly; the trail lingers briefly behind it.
      const head = Math.min(1, t * 1.25);
      const tail = Math.max(0, head - 0.35);
      const flare = Math.sin(Math.min(1, t) * Math.PI) * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
      const bright = THREE.MathUtils.clamp(Math.pow(10, -0.4 * (m.mag - limitingMag)) * 0.25, 0.08, 1.4) * flare;
      for (let i = 0; i < TRAIL; i++) {
        const a = tail + ((head - tail) * i) / TRAIL;
        const b = tail + ((head - tail) * (i + 1)) / TRAIL;
        slerpUnit(m.start, m.end, a, p).multiplyScalar(980);
        slerpUnit(m.start, m.end, b, q).multiplyScalar(980);
        const fa = (i / TRAIL) ** 2 * bright;
        const fb = ((i + 1) / TRAIL) ** 2 * bright;
        this.write(v++, p, fa, m.color);
        this.write(v++, q, fb, m.color);
      }
    }
    for (let i = v; i < MAX * TRAIL * 2; i++) this.fade[i] = 0;
    for (const k of ['position', 'aFade', 'aColor']) (this.geom.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
    this.geom.setDrawRange(0, v);
  }

  private write(i: number, p: THREE.Vector3, f: number, c: THREE.Color): void {
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.fade[i] = f;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
  }

  private spawn(radiant: THREE.Vector3 | null, speed: number, limitingMag: number): void {
    if (this.meteors.length >= MAX) return;
    // Pick a start point in the upper sky, 15–70° from the radiant.
    const start = altAzToWorld(15 + Math.random() * 65, Math.random() * 360);
    let dir: THREE.Vector3;
    if (radiant) {
      const sep = start.angleTo(radiant);
      if (sep < 0.26 || sep > 1.3) {
        const axis = new THREE.Vector3().crossVectors(radiant, start).normalize();
        start.copy(radiant).applyAxisAngle(axis, 0.3 + Math.random() * 0.9);
        if (start.y < 0.15) return;
      }
      // Tangent at the start point, pointing away from the radiant along the great circle.
      dir = start.clone().multiplyScalar(radiant.dot(start)).sub(radiant).normalize();
    } else {
      dir = new THREE.Vector3().randomDirection();
      dir.addScaledVector(start, -dir.dot(start)).normalize();
      if (dir.y > 0.2) dir.y *= -1; // sporadics mostly fall toward the horizon
    }
    const lengthDeg = 6 + Math.random() * 22 * (40 / Math.max(20, speed));
    const axis = new THREE.Vector3().crossVectors(start, dir).normalize();
    const end = start.clone().applyAxisAngle(axis, (lengthDeg * Math.PI) / 180);
    // Magnitude distribution: most meteors faint, a few bright.
    const mag = limitingMag - 3.5 * Math.pow(Math.random(), 0.35) - (Math.random() < 0.04 ? 3 : 0);
    const fast = speed > 50;
    const color = fast ? new THREE.Color(0.8, 0.95, 1.0) : new THREE.Color(1.0, 0.92, 0.75);
    if (Math.random() < 0.2) color.lerp(new THREE.Color(0.6, 1, 0.7), 0.5); // green (Mg/O) flash
    this.meteors.push({ start, end, age: 0, life: 0.35 + (lengthDeg / Math.max(speed, 10)) * 1.2, mag, color });
  }
}
