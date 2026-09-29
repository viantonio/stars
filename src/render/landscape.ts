/**
 * Procedural 360° landscape / horizon silhouette surrounding the observer.
 *
 * The panorama is painted once (seeded, deterministic) onto an offscreen canvas in
 * several depth layers (far ridges → near foreground), composited in JS into two
 * textures and drawn on the inside of a sphere cap around the camera:
 *
 *   colour texture (4096×1024 RGBA, premultiplied sRGB albedo + coverage)
 *   aux texture    (4096×1024 RGBA: emissive intensity, emissive hue·I, depth·a, normal·a)
 *
 * To double the horizontal resolution the 360° panorama is packed as two 180° strips
 * (each with a small overlap margin) stacked vertically — the shader picks the strip
 * and samples with explicit gradients, so there is no seam and mipmapping stays correct.
 * Strip A (az 0–180) is stored upside-down so that both strips meet at their opaque
 * ground rows, which keeps mip bleeding invisible.
 *
 * World frame: y = up, north = −Z, east = +X. Azimuth measured from north through east.
 */
import * as THREE from 'three';
import type { HorizonKind } from '../core/locations';

export interface LandscapeUpdateParams {
  /** Unit vector toward the Sun, world frame. */
  sunDir: THREE.Vector3;
  sunAltDeg: number;
  /** Unit vector toward the Moon, world frame. */
  moonDir: THREE.Vector3;
  /** 0..1 fraction lit, 0 if below the horizon. */
  moonIllum: number;
  /** Current linear sky colour near the horizon. */
  skyColorHorizon: THREE.Color;
  nightVision: boolean;
  /** 0..1 */
  lightPollution: number;
}

export interface Landscape {
  object: THREE.Object3D;
  /** 360 entries: silhouette altitude (deg) per integer azimuth (0 = N, 90 = E). */
  horizonProfile: Float32Array;
  kind: HorizonKind;
  update(p: LandscapeUpdateParams): void;
  setVisible(v: boolean): void;
  /** Horizon altitude (deg) at an arbitrary azimuth, linearly interpolated. */
  horizonAltAt(azDeg: number): number;
  dispose(): void;
}

// ───────────────────────────── layout ─────────────────────────────

const TEX_W = 4096;
const TEX_H = 1024;
const VH = TEX_H / 2; // rows per strip
const MARGIN_PX = 44; // overlap margin on each side of a 180° strip
const PPD = (TEX_W - 2 * MARGIN_PX) / 180; // px per degree of azimuth (22.27)
const CORE_PX = Math.round(360 * PPD); // 8016
const VW = CORE_PX + 2 * MARGIN_PX; // virtual panorama width (8104)
const STRIP_B_X0 = Math.round(180 * PPD); // 4008
const ALT_MIN = -6;
const ALT_MAX = 16;
const PPDY = VH / (ALT_MAX - ALT_MIN); // px per degree of altitude (25.6)
const AZ_LO = -MARGIN_PX / PPD;
const AZ_HI = 360 + MARGIN_PX / PPD;
const RADIUS = 700;
const GLOW_RADIUS = 880;
const D2R = Math.PI / 180;

// ───────────────────────────── random & noise ─────────────────────────────

class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  gauss(): number {
    return (this.next() + this.next() + this.next() - 1.5) * 1.1547;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

type Fn1 = (az: number) => number;

const wrap360 = (a: number): number => ((a % 360) + 360) % 360;
function angDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
function bump(az: number, c: number, w: number): number {
  const d = angDiff(az, c) / w;
  return Math.exp(-0.5 * d * d);
}
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Smooth periodic value noise over the full circle, range ≈ [-1, 1]. */
function periodicNoise(rng: Rng, cells: number): Fn1 {
  const v = new Float32Array(cells);
  for (let i = 0; i < cells; i++) v[i] = rng.range(-1, 1);
  return (az: number) => {
    const t = (wrap360(az) / 360) * cells;
    const i1 = Math.floor(t);
    const f = t - i1;
    const p0 = v[(i1 - 1 + cells) % cells];
    const p1 = v[i1 % cells];
    const p2 = v[(i1 + 1) % cells];
    const p3 = v[(i1 + 2) % cells];
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * f +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
        (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
    );
  };
}

function fbm(rng: Rng, cells: number, octaves: number, gain = 0.5): Fn1 {
  const ns: Fn1[] = [];
  let norm = 0;
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    ns.push(periodicNoise(rng, cells << o));
    norm += amp;
    amp *= gain;
  }
  return (az: number) => {
    let s = 0;
    let a = 1;
    for (const n of ns) {
      s += a * n(az);
      a *= gain;
    }
    return s / norm;
  };
}

/** Ridged multifractal — sharp mountain crests, range ≈ [0, 1]. */
function ridged(rng: Rng, cells: number, octaves: number, gain = 0.5): Fn1 {
  const ns: Fn1[] = [];
  for (let o = 0; o < octaves; o++) ns.push(periodicNoise(rng, cells << o));
  return (az: number) => {
    let s = 0;
    let a = 1;
    let norm = 0;
    let w = 1;
    for (const n of ns) {
      let r = 1 - Math.abs(n(az));
      r *= r;
      s += a * r * w;
      norm += a;
      w = clamp(r * 1.6, 0.3, 1);
      a *= gain;
    }
    return s / norm;
  };
}

/** Monotone cubic (PCHIP) through (x, y) points; returns `outside` beyond the range. */
function pchip(pts: [number, number][], outside = -20): Fn1 {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]));
  m.push(d[n - 2]);
  return (x: number) => {
    if (x < xs[0] || x > xs[n - 1]) return outside;
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1]
    );
  };
}

/** Tileable 256×256 fbm value noise used to add surface detail to albedo. */
function makeNoiseTile(rng: Rng): Float32Array {
  const N = 256;
  const t = new Float32Array(N * N);
  let amp = 1;
  let total = 0;
  for (let cells = 8; cells <= 128; cells *= 2) {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = rng.range(-1, 1);
    const s = N / cells;
    for (let y = 0; y < N; y++) {
      const fy = y / s;
      const y0 = Math.floor(fy);
      let ty = fy - y0;
      ty = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cells) * cells;
      const r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < N; x++) {
        const fx = x / s;
        const x0 = Math.floor(fx);
        let tx = fx - x0;
        tx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % cells;
        const c1 = (x0 + 1) % cells;
        const a = g[r0 + c0] + (g[r0 + c1] - g[r0 + c0]) * tx;
        const b = g[r1 + c0] + (g[r1 + c1] - g[r1 + c0]) * tx;
        t[y * N + x] += amp * (a + (b - a) * ty);
      }
    }
    total += amp;
    amp *= 0.8;
  }
  for (let i = 0; i < t.length; i++) t[i] = (t[i] / total) * 2.2;
  return t;
}

function sampleTile(t: Float32Array, u: number, v: number): number {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const xa = x0 & 255;
  const xb = (x0 + 1) & 255;
  const ya = (y0 & 255) << 8;
  const yb = ((y0 + 1) & 255) << 8;
  const a = t[ya + xa] + (t[ya + xb] - t[ya + xa]) * fx;
  const b = t[yb + xa] + (t[yb + xb] - t[yb + xa]) * fx;
  return a + (b - a) * fy;
}

// ───────────────────────────── canvas painting ─────────────────────────────

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Style = string | CanvasGradient | CanvasPattern;

function makeCtx(w: number, h: number): Ctx2D {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) return ctx;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('landscape: 2D canvas unavailable');
  return ctx;
}

/** Sets a transform so that drawing coordinates are (azimuth°, altitude°), shifted by `off` degrees. */
function setDeg(c: Ctx2D, off: number): void {
  c.setTransform(PPD, 0, 0, -PPDY, MARGIN_PX + off * PPD, ALT_MAX * PPDY);
}

const xToAz = (x: number): number => (x + 0.5 - MARGIN_PX) / PPD;

/** Emissive hue codes (see hueCol() in the shader). */
const HUE_RED = 0.05;
const HUE_SODIUM = 0.33;
const HUE_WARM = 0.66;
const HUE_LED = 1.0;

class Paint {
  /** Highest ridge crest altitude per virtual column (for slope-based shading). */
  crest: Float32Array | null = null;
  constructor(
    private c: Ctx2D,
    private e: Ctx2D | null,
  ) {}

  private offsets(az?: number, ext = 0): number[] {
    if (az === undefined) return [0];
    const out: number[] = [];
    for (const off of [-360, 0, 360]) {
      const a = az + off;
      if (a + ext >= AZ_LO - 0.5 && a - ext <= AZ_HI + 0.5) out.push(off);
    }
    return out;
  }

  /** Fill an opaque shape (degree coords). Also occludes emissive lights painted earlier in this layer. */
  fill(path: Path2D | WPath | Path2D[], style: Style, az?: number, ext?: number): void {
    const list = path instanceof Path2D ? [path] : Array.isArray(path) ? path : path.paths;
    for (const off of this.offsets(az, ext)) {
      setDeg(this.c, off);
      this.c.fillStyle = style;
      for (const pp of list) this.c.fill(pp);
      if (this.e) {
        setDeg(this.e, off);
        this.e.globalCompositeOperation = 'destination-out';
        this.e.fillStyle = '#000';
        for (const pp of list) this.e.fill(pp);
        this.e.globalCompositeOperation = 'source-over';
      }
    }
  }

  stroke(path: Path2D, style: Style, width: number, az?: number, ext?: number): void {
    for (const off of this.offsets(az, ext)) {
      setDeg(this.c, off);
      this.c.strokeStyle = style;
      this.c.lineWidth = width;
      this.c.lineCap = 'round';
      this.c.lineJoin = 'round';
      this.c.stroke(path);
      if (this.e) {
        setDeg(this.e, off);
        this.e.globalCompositeOperation = 'destination-out';
        this.e.strokeStyle = '#000';
        this.e.lineWidth = width;
        this.e.stroke(path);
        this.e.globalCompositeOperation = 'source-over';
      }
    }
  }

  /**
   * Seamless canopy texture (tree crowns seen from afar) for filling forest patches in degree space.
   * `dotPx` is the crown radius in pattern pixels, `scale` ≈ canvas px per pattern px.
   */
  canopy(rng: Rng, base: string, dark: string, light: string, dotPx: number, scale: number, density = 1): CanvasPattern {
    const N = 96;
    const pc = makeCtx(N, N);
    pc.fillStyle = base;
    pc.fillRect(0, 0, N, N);
    const n = Math.round(((N * N) / (dotPx * dotPx * 3)) * density);
    for (let i = 0; i < n; i++) {
      const x = rng.range(0, N);
      const y = rng.range(0, N);
      const r = dotPx * rng.range(0.6, 1.3);
      const light2 = rng.chance(0.5);
      for (const ox of [-N, 0, N]) {
        for (const oy of [-N, 0, N]) {
          const cx = x + ox;
          const cy = y + oy;
          if (cx < -2 * r || cx > N + 2 * r || cy < -2 * r || cy > N + 2 * r) continue;
          pc.fillStyle = dark;
          pc.beginPath();
          pc.ellipse(cx, cy + r * 0.3, r, r * 1.1, 0, 0, Math.PI * 2);
          pc.fill();
          pc.fillStyle = light2 ? light : base;
          pc.beginPath();
          pc.ellipse(cx - r * 0.2, cy - r * 0.25, r * 0.6, r * 0.6, 0, 0, Math.PI * 2);
          pc.fill();
        }
      }
    }
    const pat = this.c.createPattern(pc.canvas, 'repeat');
    if (!pat) throw new Error('landscape: pattern creation failed');
    // Choose a scale whose period divides the 360° width exactly so the texture is seamless at north.
    const m = Math.max(1, Math.round(CORE_PX / (N * scale)));
    const kx = CORE_PX / (N * m);
    pat.setTransform(new DOMMatrix([kx / PPD, 0, 0, -kx / PPDY, 0, 0]));
    return pat;
  }

  /** Seamless dry-grass / ground texture made of short blades. */
  grass(rng: Rng, base: string, dark: string, light: string, scale: number, blades = 1400): CanvasPattern {
    const N = 96;
    const pc = makeCtx(N, N);
    pc.fillStyle = base;
    pc.fillRect(0, 0, N, N);
    pc.lineCap = 'round';
    for (let i = 0; i < blades; i++) {
      const x = rng.range(0, N);
      const y = rng.range(0, N);
      const len = rng.range(1.5, 5);
      const lean = rng.range(-1.2, 1.2);
      pc.strokeStyle = rng.chance(0.55) ? dark : light;
      pc.lineWidth = rng.range(0.6, 1.3);
      for (const ox of [-N, 0, N]) {
        for (const oy of [-N, 0, N]) {
          if (x + ox < -6 || x + ox > N + 6 || y + oy < -6 || y + oy > N + 6) continue;
          pc.beginPath();
          pc.moveTo(x + ox, y + oy);
          pc.lineTo(x + ox + lean, y + oy - len);
          pc.stroke();
        }
      }
    }
    const pat = this.c.createPattern(pc.canvas, 'repeat');
    if (!pat) throw new Error('landscape: pattern creation failed');
    const m = Math.max(1, Math.round(CORE_PX / (N * scale)));
    const kx = CORE_PX / (N * m);
    pat.setTransform(new DOMMatrix([kx / PPD, 0, 0, -kx / PPDY, 0, 0]));
    return pat;
  }

  /** Point light (window, lamp). r in degrees, intensity 0..1, hue code 0..1. */
  light(az: number, alt: number, r: number, intensity: number, hue: number, halo = 0): void {
    if (!this.e) return;
    const h = Math.round(clamp(hue, 0, 1) * 255);
    for (const off of this.offsets(az, r * 4)) {
      setDeg(this.e, off);
      if (halo > 0) {
        this.e.fillStyle = `rgba(${h},0,0,${clamp(intensity * halo, 0, 1)})`;
        this.e.beginPath();
        this.e.ellipse(az, alt, r * 3, r * 3, 0, 0, Math.PI * 2);
        this.e.fill();
      }
      this.e.fillStyle = `rgba(${h},0,0,${clamp(intensity, 0, 1)})`;
      this.e.beginPath();
      this.e.ellipse(az, alt, r, r, 0, 0, Math.PI * 2);
      this.e.fill();
    }
  }

  /** Rectangular light (lit window) in degree coords. */
  lightRect(az: number, alt: number, w: number, h: number, intensity: number, hue: number): void {
    if (!this.e) return;
    const hh = Math.round(clamp(hue, 0, 1) * 255);
    for (const off of this.offsets(az, w)) {
      setDeg(this.e, off);
      this.e.fillStyle = `rgba(${hh},0,0,${clamp(intensity, 0, 1)})`;
      this.e.fillRect(az - w / 2, alt, w, h);
    }
  }

  /**
   * Fill the region below a periodic ridge function across the whole panorama.
   * Colours: a vertical gradient from `top` (at the crest) to `bottom` (`depthDeg` below).
   */
  ridge(f: Fn1, top: string | CanvasPattern, bottom: string, depthDeg = 3, bottomAlt = ALT_MIN - 1): Float32Array {
    const c = this.c;
    const crest = new Float32Array(VW);
    let hi = -90;
    for (let x = 0; x < VW; x++) {
      const a = f(xToAz(x));
      crest[x] = a;
      if (a > hi) hi = a;
    }
    // Build in degree space so patterns line up with object fills.
    setDeg(c, 0);
    const az0 = xToAz(-1);
    c.beginPath();
    c.moveTo(az0, bottomAlt);
    c.lineTo(az0, crest[0]);
    for (let x = 0; x < VW; x++) c.lineTo(xToAz(x), crest[x]);
    c.lineTo(xToAz(VW + 1), crest[VW - 1]);
    c.lineTo(xToAz(VW + 1), bottomAlt);
    c.closePath();
    if (typeof top === 'string') {
      const g = c.createLinearGradient(0, hi, 0, hi - depthDeg);
      g.addColorStop(0, top);
      g.addColorStop(1, bottom);
      c.fillStyle = g;
    } else {
      c.fillStyle = top;
    }
    c.fill();
    if (!this.crest) this.crest = crest;
    else for (let x = 0; x < VW; x++) this.crest[x] = Math.max(this.crest[x], crest[x]);
    return crest;
  }
}

/**
 * Path collector for many small objects spread around the panorama. Each object is added with
 * its own sub-seed so the copies replicated across the 0°/360° seam are identical.
 */
class WPath {
  /** One small Path2D per object copy — Skia fills many small paths far faster than one huge one. */
  readonly paths: Path2D[] = [];
  /** Woody parts (trunks, limbs) of the same objects, filled with a separate colour. */
  readonly wood: Path2D[] = [];
  constructor(private rng: Rng) {}
  add(az: number, ext: number, fn: (p: Path2D, r: Rng, az: number, wood: Path2D) => void): void {
    const a = wrap360(az);
    const seed = Math.floor(this.rng.next() * 4294967296);
    for (const off of [-360, 0, 360]) {
      const x = a + off;
      if (x + ext >= AZ_LO && x - ext <= AZ_HI) {
        const p = new Path2D();
        const w = new Path2D();
        fn(p, new Rng(seed), x, w);
        this.paths.push(p);
        this.wood.push(w);
      }
    }
  }
  push(p: Path2D): void {
    this.paths.push(p);
  }
}

// ───────────────────────────── shape builders ─────────────────────────────

/** Irregular closed blob outline added to `p`. `spike` adds needle-like fuzz. */
function blob(
  p: Path2D,
  rng: Rng,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  lumpiness = 0.18,
  spike = 0.05,
  n = 30,
): void {
  n = Math.max(n, Math.min(120, Math.round((2 * Math.PI * Math.max(rx * PPD, ry * PPDY)) / 2.5)));
  const f1 = rng.int(3, 6);
  const f2 = rng.int(6, 11);
  const p1 = rng.range(0, 6.28);
  const p2 = rng.range(0, 6.28);
  const a1 = lumpiness * rng.range(0.5, 1);
  const a2 = lumpiness * rng.range(0.3, 0.7);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const r = 1 + a1 * Math.sin(f1 * th + p1) + a2 * Math.sin(f2 * th + p2) + spike * (i % 2 ? -1 : 1) * rng.range(0.4, 1);
    const x = cx + rx * r * Math.cos(th);
    const y = cy + ry * r * Math.sin(th);
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
}

/** Cloud-like leaf cluster: a lumpy outline with many small rounded scallops. */
function leafy(p: Path2D, rng: Rng, cx: number, cy: number, rx: number, ry: number, bumps = 0): void {
  const k = bumps || rng.int(9, 15);
  const pix = Math.max(rx * PPD, ry * PPDY);
  const n = Math.max(k * 5, Math.min(160, Math.round((2 * Math.PI * pix) / 1.5)));
  const f1 = rng.int(2, 4);
  const p1 = rng.range(0, 6.28);
  const a1 = rng.range(0.05, 0.14);
  const ph = rng.range(0, 6.28);
  const s = rng.range(0.1, 0.16);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const sc = Math.abs(Math.sin((k * th) / 2 + ph));
    const r = 1 + a1 * Math.sin(f1 * th + p1) - s * (1 - Math.sqrt(sc)) + (rng.next() - 0.5) * 0.03;
    const x = cx + rx * r * Math.cos(th);
    const y = cy + ry * r * Math.sin(th);
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
}

/** Tapered trunk/limb quad from (x0,y0) to (x1,y1). */
function limb(p: Path2D, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  // Counter-clockwise (like blob/rect) so overlapping sub-paths union under the non-zero rule.
  p.moveTo(x0 - nx * w0, y0 - ny * w0);
  p.lineTo(x1 - nx * w1, y1 - ny * w1);
  p.lineTo(x1 + nx * w1, y1 + ny * w1);
  p.lineTo(x0 + nx * w0, y0 + ny * w0);
  p.closePath();
}

/** Closed polygon, normalised to counter-clockwise winding so it unions with other sub-paths. */
function poly(p: Path2D, pts: [number, number][]): void {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
  }
  const list = area < 0 ? [...pts].reverse() : pts;
  p.moveTo(list[0][0], list[0][1]);
  for (let i = 1; i < list.length; i++) p.lineTo(list[i][0], list[i][1]);
  p.closePath();
}

/** Ponderosa / Jeffrey pine: straight trunk, clumpy tufted crown with sky gaps, rounded top. */
function ponderosa(p: Path2D, rng: Rng, az: number, base: number, h: number, w: number, wood: Path2D = p): void {
  const top = base + h;
  limb(wood, az, base - h * 0.02, az + rng.range(-0.02, 0.02) * w, base + h * 0.95, w * 0.05, w * 0.012);
  const crownBase = base + h * rng.range(0.3, 0.48);
  const nWhorl = rng.int(10, 16);
  for (let i = 0; i < nWhorl; i++) {
    const t = i / (nWhorl - 1);
    const y = crownBase + (top - crownBase) * t * 0.94;
    const env = Math.sqrt(Math.max(0.03, 1 - ((t - 0.3) / 0.72) ** 2));
    const hw = (w / 2) * env;
    for (const s of [-1, 1]) {
      if (!rng.chance(0.85)) continue;
      const L = hw * rng.range(0.55, 1.05);
      const droop = h * rng.range(-0.03, 0.01);
      const cx = az + s * L * 0.62;
      if (L > w * 0.12) limb(wood, az, y - h * 0.01, cx, y + droop, h * 0.006, h * 0.003);
      blob(p, rng, cx, y + droop, L * rng.range(0.45, 0.62), h * rng.range(0.04, 0.065), 0.22, 0.14, 34);
    }
    if (rng.chance(0.55)) blob(p, rng, az + rng.range(-0.1, 0.1) * hw, y, hw * 0.4, h * 0.05, 0.2, 0.14, 26);
  }
  blob(p, rng, az, top - h * 0.03, w * 0.1, h * 0.05, 0.2, 0.15, 24);
}

/** Red fir / lodgepole: narrow conical spire with drooping branch tiers. */
function fir(p: Path2D, rng: Rng, az: number, base: number, h: number, w: number): void {
  const tiers = rng.int(14, 22);
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const bottom = base + h * rng.range(0.06, 0.14);
  for (let i = 0; i <= tiers; i++) {
    const t = i / tiers;
    const y = bottom + (base + h * 0.97 - bottom) * t;
    const hw = (w / 2) * Math.pow(1 - t, 0.92) * (0.3 + 0.7 * (1 - t * 0.2));
    const tierH = (h / tiers) * 0.55;
    const jl = rng.range(0.7, 1.15);
    const jr = rng.range(0.7, 1.15);
    left.push([az - hw * jl, y - tierH * 0.35]);
    left.push([az - hw * jl * 0.45, y + tierH * 0.25]);
    right.push([az + hw * jr, y - tierH * 0.35]);
    right.push([az + hw * jr * 0.45, y + tierH * 0.25]);
  }
  p.moveTo(az - w * 0.04, base - h * 0.02);
  p.lineTo(az - w * 0.04, bottom);
  for (const [x, y] of left) p.lineTo(x, y);
  p.lineTo(az, base + h);
  for (let i = right.length - 1; i >= 0; i--) p.lineTo(right[i][0], right[i][1]);
  p.lineTo(az + w * 0.04, bottom);
  p.lineTo(az + w * 0.04, base - h * 0.02);
  p.closePath();
}

/** Dead snag with a few stubs. */
function snag(p: Path2D, rng: Rng, az: number, base: number, h: number): void {
  const w = h * 0.03;
  limb(p, az, base - 0.1, az + rng.range(-0.2, 0.2) * w, base + h, w, w * 0.25);
  const n = rng.int(3, 6);
  for (let i = 0; i < n; i++) {
    const y = base + h * rng.range(0.4, 0.92);
    const s = rng.chance(0.5) ? -1 : 1;
    limb(p, az, y, az + s * h * rng.range(0.05, 0.14), y + h * rng.range(-0.04, 0.05), w * 0.35, w * 0.1);
  }
}

/** Oak: short trunk splitting into limbs, broad lobed crown wider than tall. */
function oak(p: Path2D, rng: Rng, az: number, base: number, h: number, w: number, dense = 0.7, wood: Path2D = p): void {
  const forkY = base + h * rng.range(0.22, 0.38);
  limb(wood, az, base - h * 0.03, az + rng.range(-0.05, 0.05) * w, forkY, w * 0.05, w * 0.04);
  const nLimbs = rng.int(3, 5);
  for (let i = 0; i < nLimbs; i++) {
    const tx = az + (i / (nLimbs - 1) - 0.5) * w * rng.range(0.5, 0.85);
    const ty = base + h * rng.range(0.55, 0.8);
    limb(wood, az, forkY, tx, ty, w * 0.028, w * 0.01);
  }
  const cy = base + h * 0.64;
  // Broad core plus leafy clusters, mostly around the upper rim.
  leafy(p, rng, az, cy, w * 0.37, h * 0.29, rng.int(10, 16));
  const nb = Math.round(7 + dense * 12);
  for (let i = 0; i < nb; i++) {
    const ang = rng.range(-0.25, Math.PI + 0.25);
    const rr = rng.range(0.55, 1.0);
    const bx = az + Math.cos(ang) * rr * w * 0.38;
    const by = Math.max(cy + Math.sin(ang) * rr * h * 0.28, base + h * 0.45);
    const r = w * rng.range(0.09, 0.16);
    leafy(p, rng, bx, by, r, r * (h / w) * 1.4);
  }
}

/** Broadleaf street tree: tall rounded canopy. */
function broadleaf(p: Path2D, rng: Rng, az: number, base: number, h: number, w: number, wood: Path2D = p): void {
  const forkY = base + h * rng.range(0.25, 0.4);
  limb(wood, az, base - h * 0.03, az, forkY, w * 0.045, w * 0.035);
  for (let i = 0; i < 3; i++) limb(wood, az, forkY, az + rng.range(-0.25, 0.25) * w, base + h * 0.7, w * 0.025, w * 0.01);
  const cx = az;
  const cy = base + h * 0.64;
  leafy(p, rng, cx, cy, w * 0.36, h * 0.27, rng.int(10, 16));
  const nb = rng.int(12, 20);
  for (let i = 0; i < nb; i++) {
    const ang = rng.range(-0.4, Math.PI + 0.4);
    const rr = rng.range(0.6, 1.0);
    const bx = cx + Math.cos(ang) * rr * w * 0.36;
    const by = Math.max(cy + Math.sin(ang) * rr * h * 0.28, base + h * 0.45);
    const r = w * rng.range(0.09, 0.15);
    leafy(p, rng, bx, by, r, r * (h / w) * 1.15);
  }
}

/** Fan palm (Washingtonia): very thin tall trunk with a spiky tuft. */
function palm(p: Path2D, rng: Rng, az: number, base: number, h: number): void {
  const lean = rng.range(-0.04, 0.04) * h;
  limb(p, az, base - 0.05, az + lean, base + h * 0.9, h * 0.018, h * 0.012);
  const cx = az + lean;
  const cy = base + h * 0.92;
  const r = h * 0.1;
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const droop = Math.sin(a) < 0 ? 1.25 : 1;
    const len = r * rng.range(0.8, 1.2) * droop;
    limb(p, cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len * 0.8 - (droop > 1 ? r * 0.3 : 0), h * 0.01, h * 0.002);
  }
  blob(p, rng, cx, cy - r * 0.35, r * 0.35, r * 0.55, 0.1, 0.1, 18);
}

function grassTufts(wp: WPath, rng: Rng, f: Fn1, hMin: number, hMax: number, spacing: number): void {
  for (let az = 0; az < 360; az += spacing * rng.range(0.3, 1.7)) {
    const base = f(az) - 0.02;
    const hh = rng.range(hMin, hMax);
    wp.add(az, 0.3, (p, r, a) => {
      const n = r.int(2, 6);
      for (let k = 0; k < n; k++) {
        const x = a + r.range(-0.06, 0.06);
        const lean = r.range(-0.08, 0.08);
        const bh = hh * r.range(0.5, 1);
        p.moveTo(x - 0.012, base);
        p.quadraticCurveTo(x + lean * 0.3, base + bh * 0.6, x + lean, base + bh);
        p.quadraticCurveTo(x + lean * 0.3 + 0.004, base + bh * 0.55, x + 0.012, base);
        p.closePath();
      }
    });
  }
}

function rect(p: Path2D, x0: number, y0: number, x1: number, y1: number): void {
  p.rect(x0, y0, x1 - x0, y1 - y0);
}

// ───────────────────────────── builder / compositor ─────────────────────────────

interface LayerOpts {
  /** 0 = nearest … 1 = farthest (drives haze & shadowing). */
  depth: number;
  /** Radius (px) for coverage-gradient normals (rounded shading of shapes). */
  normR?: number;
  /** Gain for coverage-gradient normals. */
  covGain?: number;
  /** Vertical edge shading: brighter tops / darker undersides of shapes (albedo gain). */
  vGain?: number;
  /** Radius (px) for the vertical edge shading. */
  vR?: number;
  /** Gain for ridge slope normals (0 = off). */
  ntGain?: number;
  /** e-folding depth (deg) below the crest for slope normals. */
  ntFall?: number;
  /** Albedo detail: amplitude, fine repeat count, fine vertical scale, coarse repeat count, coarse vertical scale. */
  detail?: [number, number, number, number, number];
  lights?: boolean;
}

class Builder {
  readonly color = new Uint8ClampedArray(VW * VH * 4);
  readonly aux = new Uint8ClampedArray(VW * VH * 4);
  private ctx = makeCtx(VW, VH);
  private ectx: Ctx2D | null = null;
  constructor(private tile: Float32Array) {}

  layer(o: LayerOpts, draw: (p: Paint) => void): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, VW, VH);
    let ectx: Ctx2D | null = null;
    if (o.lights) {
      if (!this.ectx) this.ectx = makeCtx(VW, VH);
      ectx = this.ectx;
      ectx.setTransform(1, 0, 0, 1, 0, 0);
      ectx.clearRect(0, 0, VW, VH);
    }
    const p = new Paint(ctx, ectx);
    draw(p);
    const L = ctx.getImageData(0, 0, VW, VH).data;
    const E = ectx ? ectx.getImageData(0, 0, VW, VH).data : null;
    this.composite(o, L, E, p.crest);
  }

  private composite(o: LayerOpts, L: Uint8ClampedArray, E: Uint8ClampedArray | null, crest: Float32Array | null): void {
    const C = this.color;
    const X = this.aux;
    const tile = this.tile;
    const normR = o.normR ?? 6;
    const covGain = o.covGain ?? 0.8;
    const fall = o.ntFall ?? 1.2;
    const [amp, m1, sy1, m2, sy2] = o.detail ?? [0, 31, 1, 7, 1];
    const sx1 = (m1 * 256) / CORE_PX;
    const sx2 = (m2 * 256) / CORE_PX;
    const depth8 = o.depth * 255;
    const vGain = o.vGain ?? 0.12;
    const vR = o.vR ?? normR;

    let ridgeNt: Float32Array | null = null;
    if (crest && o.ntGain) {
      ridgeNt = new Float32Array(VW);
      const k = Math.max(2, Math.round(PPD * 0.35));
      for (let x = 0; x < VW; x++) {
        const s = (crest[Math.min(VW - 1, x + k)] - crest[Math.max(0, x - k)]) / ((2 * k) / PPD);
        ridgeNt[x] = clamp(-s * o.ntGain, -0.95, 0.95);
      }
    }

    for (let y = 0; y < VH; y++) {
      const altRow = ALT_MAX - (y + 0.5) / PPDY;
      const row = y * VW;
      const v1 = y * sy1;
      const v2 = y * sy2 + 91;
      for (let x = 0; x < VW; x++) {
        const i = (row + x) << 2;
        const a8 = L[i + 3];
        const e8 = E ? E[i + 3] : 0;
        if (a8 === 0 && e8 === 0) continue;
        if (a8 > 0) {
          const a = a8 / 255;
          const ia = 1 - a;
          let f = 1;
          if (amp > 0) {
            let xm = x - MARGIN_PX;
            if (xm < 0) xm += CORE_PX;
            else if (xm >= CORE_PX) xm -= CORE_PX;
            f = 1 + amp * (0.65 * sampleTile(tile, xm * sx1, v1) + 0.35 * sampleTile(tile, xm * sx2 + 37, v2));
          }
          const aU = y >= vR ? L[((row - vR * VW + x) << 2) + 3] : 0;
          const aD = y + vR < VH ? L[((row + vR * VW + x) << 2) + 3] : 255;
          f *= 1 + vGain * ((aD - aU) / 255);
          const fa = f * a;
          C[i] = L[i] * fa + C[i] * ia;
          C[i + 1] = L[i + 1] * fa + C[i + 1] * ia;
          C[i + 2] = L[i + 2] * fa + C[i + 2] * ia;
          C[i + 3] = a8 + C[i + 3] * ia;
          const aL = L[((row + Math.max(0, x - normR)) << 2) + 3];
          const aR = L[((row + Math.min(VW - 1, x + normR)) << 2) + 3];
          let nt = ((aL - aR) / 255) * covGain;
          if (ridgeNt && crest) {
            const dd = crest[x] - altRow;
            if (dd >= -0.05) nt += ridgeNt[x] * Math.exp(-Math.max(dd, 0) / fall);
          }
          nt = clamp(nt, -1, 1);
          X[i] = X[i] * ia;
          X[i + 1] = X[i + 1] * ia;
          X[i + 2] = depth8 * a + X[i + 2] * ia;
          X[i + 3] = (nt * 0.5 + 0.5) * 255 * a + X[i + 3] * ia;
        }
        if (E && e8 > 0) {
          const e = e8;
          X[i] = X[i] + e;
          X[i + 1] = X[i + 1] + (E[i] / 255) * e;
        }
      }
    }
  }

  /** Silhouette altitude per integer azimuth (max over the ±0.5° bin of the first ≥50 % opaque row). */
  horizonProfile(): Float32Array {
    const out = new Float32Array(360);
    const C = this.color;
    for (let az = 0; az < 360; az++) {
      const x0 = Math.max(0, Math.floor(MARGIN_PX + (az - 0.5) * PPD));
      const x1 = Math.min(VW - 1, Math.ceil(MARGIN_PX + (az + 0.5) * PPD));
      let best = ALT_MIN;
      for (let x = x0; x <= x1; x++) {
        for (let y = 0; y < VH; y++) {
          if (C[((y * VW + x) << 2) + 3] >= 128) {
            const alt = ALT_MAX - (y + 0.5) / PPDY;
            if (alt > best) best = alt;
            break;
          }
        }
      }
      out[az] = best;
    }
    return out;
  }

  /** Pack the virtual panorama into the two-strip texture layout. */
  pack(src: Uint8ClampedArray): Uint8Array {
    const out = new Uint8Array(TEX_W * TEX_H * 4);
    const rowBytes = TEX_W * 4;
    for (let r = 0; r < VH; r++) {
      const a = r * VW * 4;
      out.set(src.subarray(a, a + rowBytes), r * rowBytes);
      const b = ((VH - 1 - r) * VW + STRIP_B_X0) * 4;
      out.set(src.subarray(b, b + rowBytes), (VH + r) * rowBytes);
    }
    return out;
  }
}

// ───────────────────────────── scene definitions ─────────────────────────────

interface Dome {
  az: number;
  width: number;
  amp: number;
  height: number;
}

interface KindConfig {
  ground: string; // sRGB hex of near ground albedo
  /** Aerial-perspective strength (1 = typical lowland haze). */
  haze?: number;
  domes: Dome[];
  emisGain: number;
}

/** 2-D patchiness in (az, alt), periodic in azimuth. Range ≈ [-1, 1]. */
function patchNoise(rng: Rng, cells: number): (az: number, alt: number) => number {
  const a = fbm(rng, cells, 3, 0.55);
  const b2 = fbm(rng, cells * 2, 2, 0.5);
  return (az, alt) => 0.65 * a(az + alt * 9) + 0.45 * b2(2 * az - alt * 13);
}

/** Scatter woodland blobs on a hillside below crest `f`, where patch noise exceeds `thr`. */
function woodland(
  wp: WPath,
  rng: Rng,
  f: Fn1,
  count: number,
  bottom: number,
  rMin: number,
  rMax: number,
  patch: (az: number, alt: number) => number,
  thr: number,
): void {
  for (let i = 0; i < count; i++) {
    const az = rng.range(0, 360);
    const top = f(az);
    if (top < bottom + 0.05) continue;
    const alt = top - rng.range(0, 1) ** 1.4 * (top - bottom);
    if (patch(az, alt) < thr) continue;
    const r = rng.range(rMin, rMax);
    wp.add(az, r * 2, (p, rr, a) => leafy(p, rr, a, alt, r * 1.25, r * 0.9, rr.int(6, 9)));
  }
}

/** Mariposa: rolling oak/grass foothills, ponderosas and gray pines nearby, the Sierra rising to the east. */
function buildFoothills(b: Builder, rng: Rng): KindConfig {
  const east = (az: number) => 0.5 + 0.5 * Math.cos((az - 95) * D2R);

  // 1 · Far Sierra crest, blue with distance.
  const sR = ridged(rng, 20, 5);
  const sF = fbm(rng, 6, 3);
  const sierra = (az: number) => {
    const e = east(az);
    return 1.25 + 2.3 * e ** 1.6 + (0.3 + 1.5 * e ** 1.4) * sR(az) + 0.3 * sF(az);
  };
  b.layer({ depth: 1, normR: 4, vGain: 0.1, ntGain: 2.5, ntFall: 1.0, detail: [0.08, 31, 0.5, 9, 0.5] }, (p) => {
    p.ridge(sierra, '#7a8894', '#6f7d88', 3);
  });

  // 2 · Far forested foothills (dense conifer fuzz on the crest).
  const f2 = fbm(rng, 9, 4, 0.55);
  const farHills = (az: number) => 0.95 + 1.9 * east(az) ** 1.4 + 0.6 * f2(az);
  b.layer({ depth: 0.8, normR: 4, vGain: 0.1, covGain: 0.4, ntGain: 3, ntFall: 0.7, detail: [0.14, 31, 1, 9, 1] }, (p) => {
    p.ridge(farHills, '#4f5d41', '#4a5840', 2);
    const wp = new WPath(rng);
    for (let az = 0; az < 360; ) {
      const e = east(az);
      az += rng.range(0.04, 0.16) / (0.5 + e);
      if (!rng.chance(0.4 + 0.5 * e)) continue;
      const h = rng.range(0.06, 0.17) * (0.8 + 0.4 * e);
      const base = farHills(az) - 0.02;
      wp.add(az, h, (pp, r, a) => fir(pp, r, a, base, h, h * r.range(0.35, 0.55)));
    }
    p.fill(wp, '#3f4c36');
  });

  // 3 · Mid ridges: golden grass with a mosaic of oak woodland.
  const f3 = fbm(rng, 7, 4, 0.5);
  const midHills = (az: number) => 0.45 + 1.5 * east(az) ** 1.2 + 0.85 * f3(az);
  const patch3 = patchNoise(rng, 14);
  b.layer({ depth: 0.6, normR: 5, vGain: 0.08, covGain: 0.5, ntGain: 3, ntFall: 0.8, detail: [0.2, 12, 1.2, 4, 1], lights: true }, (p) => {
    p.ridge(midHills, '#ae9762', '#8f7c4e', 2.5);
    const wood = new WPath(rng);
    patches(wood, rng, midHills, 1600, ALT_MIN, 0.2, 0.7, (az, alt) => patch3(az, alt) - 0.02, 0.45);
    p.fill(wood, p.canopy(rng, '#4a5033', '#383d27', '#5d6441', 1.7, 0.8));
    const wp = new WPath(rng);
    for (let az = 0; az < 360; az += rng.range(0.08, 0.5)) {
      if (patch3(az, midHills(az)) < -0.25) continue;
      const h = rng.range(0.1, 0.24);
      const base = midHills(az) - 0.03;
      wp.add(az, h, (pp, r, a) => oak(pp, r, a, base, h, h * r.range(1.2, 1.6), 0.3));
    }
    p.fill(wp, '#4b5033');
    for (let i = 0; i < 14; i++) {
      const az = rng.range(0, 360);
      const alt = midHills(az) - rng.range(0.2, 0.8);
      p.light(az, alt, 0.028, rng.range(0.35, 0.65), rng.pick([HUE_WARM, HUE_WARM, HUE_LED, HUE_SODIUM]));
    }
  });

  // 4 · Near hills: brighter golden grass, oak groves, gray pines, a few houses.
  const f4 = fbm(rng, 5, 4, 0.5);
  const nearHills = (az: number) => 0.05 + 1.0 * east(az) + 1.25 * f4(az);
  const patch4 = patchNoise(rng, 10);
  b.layer({ depth: 0.38, normR: 7, vR: 6, vGain: 0.12, covGain: 0.7, ntGain: 3.5, ntFall: 1.0, detail: [0.16, 10, 1.4, 3, 1], lights: true }, (p) => {
    p.ridge(nearHills, '#bca36a', '#977f4d', 3);
    const wood = new WPath(rng);
    patches(wood, rng, nearHills, 1300, ALT_MIN, 0.3, 1.0, (az, alt) => patch4(az, alt) - 0.05, 0.45);
    p.fill(wood, p.canopy(rng, '#474d31', '#383e27', '#565d3d', 2.2, 1.0));
    const dark = new WPath(rng);
    const gray = new WPath(rng);
    woodland(dark, rng, nearHills, 1500, ALT_MIN, 0.08, 0.2, patch4, -0.1);
    for (let az = 0; az < 360; ) {
      az += rng.range(0.2, 1.5);
      const top = nearHills(az);
      if (patch4(az, top) < -0.35 && rng.chance(0.7)) continue;
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const a0 = az + k * rng.range(0.2, 0.5);
        const base = nearHills(a0) - 0.05;
        if (rng.chance(0.18)) {
          const h = rng.range(0.5, 1.1);
          gray.add(a0, h, (pp, r, a) => ponderosa(pp, r, a, base, h, h * 0.45));
        } else {
          const h = rng.range(0.22, 0.5);
          dark.add(a0, h, (pp, r, a) => oak(pp, r, a, base, h, h * r.range(1.2, 1.7), 0.5));
        }
      }
    }
    p.fill(gray, '#56604a');
    p.fill(dark, '#454b2f');
    for (let i = 0; i < 10; i++) {
      const az = rng.range(0, 360);
      const alt = nearHills(az) - rng.range(0.15, 0.6);
      if (alt < -0.4) continue;
      p.light(az, alt, 0.032, rng.range(0.5, 0.85), rng.pick([HUE_WARM, HUE_WARM, HUE_SODIUM]), 0.15);
      if (rng.chance(0.5)) p.light(az + rng.range(0.07, 0.18), alt + rng.range(-0.03, 0.03), 0.022, rng.range(0.3, 0.6), HUE_WARM);
    }
  });

  // 5 · Close hill shoulders with individual oaks.
  const f6 = fbm(rng, 4, 3, 0.5);
  const f6b = fbm(rng, 16, 2);
  const close = (az: number) => -2.2 + 3.6 * Math.max(0, f6(az) + 0.25) ** 1.2 + 0.12 * f6b(az);
  const patch6 = patchNoise(rng, 8);
  b.layer({ depth: 0.2, normR: 10, vR: 8, vGain: 0.15, covGain: 0.8, ntGain: 3, ntFall: 1.2, detail: [0.14, 31, 0.8, 3, 1] }, (p) => {
    p.ridge(close, '#b99f66', '#8d7648', 2.5);
    const wood = new WPath(rng);
    patches(wood, rng, close, 900, ALT_MIN, 0.5, 1.6, (az, alt) => patch6(az, alt) - 0.12, 0.45);
    p.fill(wood, p.canopy(rng, '#454b2f', '#373d26', '#51583a', 3.0, 1.2));
    const oaks = new WPath(rng);
    const pines = new WPath(rng);
    woodland(oaks, rng, close, 900, ALT_MIN, 0.15, 0.35, patch6, 0.0);
    for (let az = 0; az < 360; az += rng.range(0.4, 2.5)) {
      const top = close(az);
      if (top < -1.8 || patch6(az, top) < -0.2) continue;
      const base = top - 0.08;
      if (rng.chance(0.2)) {
        const h = rng.range(1.2, 2.6);
        pines.add(az, h * 0.3, (pp, r, a) => ponderosa(pp, r, a, base, h, h * 0.4));
      } else {
        const h = rng.range(0.5, 1.2);
        oaks.add(az, h, (pp, r, a) => oak(pp, r, a, base, h, h * r.range(1.3, 1.7), 0.6));
      }
    }
    p.fill(oaks, '#434a2e');
    p.fill(pines, '#34402d');
  });

  // 6 · Foreground: dry grass, granite boulders, clusters of big ponderosas and oaks.
  const f5 = fbm(rng, 14, 3);
  const f5b = fbm(rng, 3, 2);
  const fg = (az: number) => -2.9 + 0.3 * f5(az) + 1.3 * f5b(az);
  b.layer({ depth: 0.06, normR: 18, vR: 14, vGain: 0.04, covGain: 0.9, ntGain: 2.5, ntFall: 1.5, detail: [0.14, 31, 0.6, 3, 0.8] }, (p) => {
    p.ridge(fg, '#a98f5a', '#7c6842', 3);
    const pines = new WPath(rng);
    const oaks = new WPath(rng);
    const brush = new WPath(rng);
    const rocks = new WPath(rng);
    const clusters: number[] = [];
    const nClusters = rng.int(5, 6);
    for (let i = 0; i < nClusters; i++) {
      let az = 0;
      for (let tries = 0; tries < 60; tries++) {
        az = rng.range(0, 360);
        if (clusters.every((c) => Math.abs(angDiff(c, az)) > 45)) break;
      }
      clusters.push(az);
    }
    const shade = new WPath(rng);
    clusters.forEach((c, ci) => {
      const n = rng.int(2, 5);
      for (let k = 0; k < n; k++) {
        const az = c + rng.gauss() * 4.5;
        const base = fg(az) - 0.1;
        shade.add(az, 4, (pp, r, a) => blob(pp, r, a, base - 0.35, r.range(2, 3.5), 0.35, 0.2, 0.02, 40));
        if (ci % 2 === 0 ? rng.chance(0.75) : rng.chance(0.25)) {
          const h = rng.range(5.5, 12);
          pines.add(az, h * 0.3, (pp, r, a, wd) => ponderosa(pp, r, a, base, h, h * r.range(0.34, 0.44), wd));
        } else {
          const h = rng.range(2.8, 5.5);
          oaks.add(az, h, (pp, r, a, wd) => oak(pp, r, a, base, h, h * r.range(1.15, 1.5), 0.7, wd));
        }
      }
    });
    for (let i = 0; i < 16; i++) {
      const az = rng.range(0, 360);
      const r0 = rng.range(0.12, 0.5);
      const y = fg(az) - r0 * 0.25 - rng.range(0, 2);
      rocks.add(az, r0 * 2, (pp, r, a) => blob(pp, r, a, y, r0 * 1.4, r0 * 0.5, 0.12, 0.01, 24));
    }
    for (let i = 0; i < 110; i++) {
      const az = rng.range(0, 360);
      const r0 = rng.range(0.12, 0.45);
      const base = fg(az) - rng.range(0, 2.5);
      brush.add(az, r0 * 2, (pp, r, a) => blob(pp, r, a, base + r0 * 0.15, r0 * 1.7, r0 * 0.6, 0.3, 0.08, 20));
    }
    grassTufts(brush, rng, fg, 0.1, 0.35, 0.08);
    p.fill(shade, 'rgba(70,58,34,0.55)');
    p.fill(rocks, '#7a7262');
    p.fill(brush, '#7d6f45');
    p.fill(oaks.wood, '#4a4034');
    p.fill(pines.wood, '#5a4636');
    p.fill(oaks, '#3a412b');
    p.fill(pines, '#2d3726');
  });

  return {
    ground: '#8a7549',
    domes: [
      { az: 255, width: 14, amp: 0.55, height: 5 }, // Merced
      { az: 160, width: 16, amp: 0.4, height: 5 }, // Fresno
      { az: 290, width: 18, amp: 0.2, height: 4 }, // Modesto / Stockton
      { az: 0, width: 180, amp: 0.05, height: 8 },
    ],
    emisGain: 1.6,
  };
}

/** Sacramento: flat valley, downtown skyline to the WSW, rooftops and a big urban tree canopy. */
function buildCity(b: Builder, rng: Rng): KindConfig {
  // Far: faint Sierra foothills to the east, Coast Range to the west.
  const fS = fbm(rng, 30, 4);
  b.layer({ depth: 1, normR: 3, ntGain: 1.5, detail: [0.05, 31, 1, 9, 1] }, (p) => {
    p.ridge(
      (az) => 0.08 + (0.4 + 0.18 * fS(az)) * bump(az, 80, 38) + (0.22 + 0.1 * fS(az + 90)) * bump(az, 268, 26),
      '#8c96a0',
      '#80898f',
      1,
    );
  });

  // Downtown skyline.
  b.layer({ depth: 0.7, normR: 3, covGain: 0.6, detail: [0.06, 31, 2, 9, 1], lights: true }, (p) => {
    const base = 0.02;
    p.ridge(() => base + 0.05, '#6e6d6b', '#6e6d6b', 1);
    type B = { x0: number; x1: number; h: number; style: number; tone: string };
    const bs: B[] = [];
    for (let i = 0; i < 34; i++) {
      const c = 246 + rng.gauss() * 7;
      const core = Math.exp(-0.5 * ((c - 246) / 6) ** 2);
      const w = rng.range(0.25, 0.9);
      const h = 0.45 + core * rng.range(0.5, 2.7) + rng.range(0, 0.4);
      bs.push({ x0: c - w / 2, x1: c + w / 2, h, style: rng.int(0, 4), tone: rng.pick(['#7d8288', '#8d8a84', '#6b737c', '#958b7c', '#7a7f76', '#a09a8e']) });
    }
    // Landmark towers: a pointed-crown tower and a stepped one.
    bs.push({ x0: 244.4, x1: 245.5, h: 3.5, style: 5, tone: '#948e84' });
    bs.push({ x0: 248.2, x1: 249.0, h: 3.0, style: 1, tone: '#6d7680' });
    bs.sort((a, b2) => a.h - b2.h);
    for (const bd of bs) {
      const path = new Path2D();
      const top = base + bd.h;
      const w = bd.x1 - bd.x0;
      const cx = (bd.x0 + bd.x1) / 2;
      rect(path, bd.x0, base - 0.2, bd.x1, top);
      if (bd.style === 1) {
        rect(path, bd.x0 + w * 0.15, top, bd.x1 - w * 0.15, top + bd.h * 0.06);
        rect(path, bd.x0 + w * 0.3, top + bd.h * 0.06, bd.x1 - w * 0.3, top + bd.h * 0.1);
      } else if (bd.style === 2) {
        rect(path, bd.x0 + w * 0.2, top, bd.x0 + w * 0.5, top + 0.08);
      } else if (bd.style === 3) {
        poly(path, [[bd.x0, top], [bd.x1, top + w * 0.25], [bd.x1, top]]);
      } else if (bd.style === 4) {
        rect(path, cx - 0.008, top, cx + 0.008, top + 0.45);
      } else if (bd.style === 5) {
        rect(path, bd.x0 + w * 0.1, top, bd.x1 - w * 0.1, top + 0.18);
        poly(path, [[bd.x0 + w * 0.1, top + 0.18], [cx, top + 0.62], [bd.x1 - w * 0.1, top + 0.18]]);
        rect(path, cx - 0.006, top + 0.6, cx + 0.006, top + 0.85);
      }
      p.fill(path, bd.tone, cx, w);
      // Windows.
      const fl = rng.range(0.085, 0.11);
      const col = rng.range(0.045, 0.065);
      const lit = rng.range(0.12, 0.45);
      const hue = rng.pick([HUE_WARM, HUE_WARM, HUE_LED, 0.8]);
      for (let y = base + 0.12; y < top - 0.08; y += fl) {
        for (let x = bd.x0 + col * 0.7; x < bd.x1 - col * 0.5; x += col) {
          if (rng.chance(lit)) p.lightRect(x, y, col * 0.5, fl * 0.45, rng.range(0.25, 0.7), hue);
        }
      }
      if (bd.h > 2.3) {
        const redTop = bd.style === 5 ? top + 0.85 : bd.style === 4 ? top + 0.45 : top + (bd.style === 1 ? bd.h * 0.1 : 0.02);
        p.light(cx, redTop, 0.03, 0.9, HUE_RED, 0.25);
      }
    }
    // State Capitol dome (low, east of the core).
    {
      const cx = 236.5;
      const path = new Path2D();
      rect(path, cx - 1.1, base - 0.2, cx + 1.1, base + 0.42);
      rect(path, cx - 0.28, base + 0.42, cx + 0.28, base + 0.62);
      path.moveTo(cx + 0.26, base + 0.6);
      path.bezierCurveTo(cx + 0.26, base + 0.9, cx + 0.08, base + 0.95, cx, base + 0.96);
      path.bezierCurveTo(cx - 0.08, base + 0.95, cx - 0.26, base + 0.9, cx - 0.26, base + 0.6);
      path.closePath();
      rect(path, cx - 0.05, base + 0.95, cx + 0.05, base + 1.08);
      rect(path, cx - 0.012, base + 1.08, cx + 0.012, base + 1.16);
      p.fill(path, '#b4ab98', cx, 1.2);
      for (let x = cx - 1.0; x < cx + 1.0; x += 0.07) p.light(x, base + 0.2, 0.02, 0.35, HUE_WARM);
      p.light(cx, base + 0.8, 0.12, 0.35, HUE_WARM);
    }
    // Tower Bridge: twin lift towers with a truss span, to the west.
    {
      const x0 = 262.4;
      const x1 = 265.2;
      const path = new Path2D();
      const tw = 0.22;
      const th = 1.25;
      for (const tx of [x0, x1]) {
        rect(path, tx - tw / 2, base - 0.1, tx + tw / 2, base + th);
        rect(path, tx - tw * 0.35, base + th, tx + tw * 0.35, base + th + 0.08);
        rect(path, tx - 0.01, base + th + 0.08, tx + 0.01, base + th + 0.18);
      }
      rect(path, x0, base + 0.22, x1, base + 0.3);
      rect(path, x0, base + 0.55, x1, base + 0.6);
      for (let x = x0; x < x1 - 0.01; x += 0.2) limb(path, x, base + 0.3, x + 0.2, base + 0.55, 0.01, 0.01);
      rect(path, x0 - 1.2, base + 0.12, x1 + 1.2, base + 0.2);
      p.fill(path, '#b89a4a', (x0 + x1) / 2, 3);
      for (const tx of [x0, x1]) {
        p.light(tx, base + th + 0.17, 0.028, 0.9, HUE_RED, 0.2);
        for (let y = base + 0.4; y < base + th; y += 0.2) p.light(tx, y, 0.03, 0.4, HUE_WARM);
      }
      for (let x = x0 - 1.1; x < x1 + 1.2; x += 0.35) p.light(x, base + 0.24, 0.03, 0.55, HUE_SODIUM, 0.15);
    }
    // Scattered mid-rises elsewhere (hospitals, apartment blocks).
    for (let i = 0; i < 10; i++) {
      const cx = rng.range(0, 360);
      if (Math.abs(angDiff(cx, 246)) < 25) continue;
      const w = rng.range(0.4, 1.4);
      const h = rng.range(0.35, 1.0);
      const path = new Path2D();
      rect(path, cx - w / 2, base - 0.2, cx + w / 2, base + h);
      p.fill(path, '#7a7c7c', cx, w);
      for (let y = base + 0.1; y < base + h - 0.05; y += 0.1)
        for (let x = cx - w / 2 + 0.04; x < cx + w / 2 - 0.03; x += 0.06)
          if (rng.chance(0.25)) p.lightRect(x, y, 0.03, 0.04, rng.range(0.2, 0.5), HUE_WARM);
    }
  });

  // Mid distance: the urban forest, roofs, palms, poles, water tower.
  const cF = fbm(rng, 60, 3, 0.55);
  b.layer({ depth: 0.42, normR: 5, covGain: 0.7, detail: [0.16, 31, 1, 9, 1], lights: true }, (p) => {
    p.ridge((az) => -0.05 + 0.04 * cF(az * 3), '#4a4a45', '#46463f', 1);
    const roofs = new WPath(rng);
    const roofLights: [number, number][] = [];
    for (let az = 0; az < 360; ) {
      const w = rng.range(0.6, 1.6);
      const h = rng.range(0.1, 0.25);
      const peak = rng.range(0.08, 0.2);
      const pk = rng.range(0.3, 0.7);
      const chimney = rng.chance(0.25);
      roofs.add(az + w / 2, w, (pp, _r, a) => {
        const x = a - w / 2;
        poly(pp, [[x, -0.1], [x, h], [x + w * pk, h + peak], [x + w, h], [x + w, -0.1]]);
        if (chimney) rect(pp, x + w * 0.2, h + peak * 0.3, x + w * 0.26, h + peak + 0.06);
      });
      if (rng.chance(0.35)) roofLights.push([az + w * rng.range(0.2, 0.8), h * 0.5]);
      az += w + rng.range(-0.2, 0.6);
    }
    p.fill(roofs, '#5d5752');
    for (const [az, alt] of roofLights) p.light(az, alt, 0.025, rng.range(0.35, 0.75), rng.pick([HUE_WARM, HUE_LED]));
    // Street lamps (drawn before the trees so canopies hide some of them).
    for (let i = 0; i < 80; i++) {
      p.light(rng.range(0, 360), rng.range(0.08, 0.35), 0.03, rng.range(0.5, 0.95), rng.chance(0.55) ? HUE_SODIUM : HUE_LED, 0.3);
    }
    // Tree canopy with gaps.
    const trees = new WPath(rng);
    const dark = new WPath(rng);
    for (let az = 0; az < 360; ) {
      az += rng.range(0.2, 0.9);
      if (!rng.chance(0.78)) {
        az += rng.range(0.5, 2);
        continue;
      }
      const h = (0.32 + 0.25 * cF(az)) * rng.range(0.9, 2.6);
      (rng.chance(0.5) ? trees : dark).add(az, h, (pp, r, a) => broadleaf(pp, r, a, -0.05, h, h * r.range(0.9, 1.5)));
    }
    for (let i = 0; i < 9; i++) {
      const h = rng.range(1.2, 2.0);
      dark.add(rng.range(0, 360), h * 0.3, (pp, r, a) => palm(pp, r, a, -0.05, h));
    }
    p.fill(trees, '#44533a');
    p.fill(dark, '#36422f');
    // Water tower.
    {
      const cx = 72;
      const wt = new Path2D();
      for (const dx of [-0.25, -0.08, 0.08, 0.25]) limb(wt, cx + dx, -0.05, cx + dx * 0.6, 1.1, 0.012, 0.01);
      blob(wt, rng, cx, 1.28, 0.36, 0.2, 0.0, 0.0, 30);
      rect(wt, cx - 0.36, 1.18, cx + 0.36, 1.3);
      limb(wt, cx, 1.45, cx, 1.62, 0.01, 0.005);
      p.fill(wt, '#7c7f80', cx, 0.5);
      p.light(cx, 1.62, 0.025, 0.85, HUE_RED, 0.2);
    }
    // Lattice cell tower.
    {
      const cx = 152;
      const ct = new Path2D();
      limb(ct, cx - 0.12, -0.05, cx - 0.015, 2.5, 0.008, 0.006);
      limb(ct, cx + 0.12, -0.05, cx + 0.015, 2.5, 0.008, 0.006);
      for (let y = 0; y < 2.4; y += 0.22) {
        const w0 = 0.12 - (y / 2.5) * 0.105;
        const w1 = 0.12 - ((y + 0.22) / 2.5) * 0.105;
        limb(ct, cx - w0, y, cx + w1, y + 0.22, 0.004, 0.004);
        limb(ct, cx + w0, y, cx - w1, y + 0.22, 0.004, 0.004);
      }
      rect(ct, cx - 0.06, 2.3, cx + 0.06, 2.42);
      p.fill(ct, '#666a6c', cx, 0.3);
      p.light(cx, 2.52, 0.03, 0.9, HUE_RED, 0.3);
      p.light(cx, 1.3, 0.022, 0.7, HUE_RED, 0.2);
    }
  });

  // Near: a neighbour's house, big street trees, a lamp post and a utility pole with wires.
  const gF = fbm(rng, 20, 2);
  const ground = (az: number) => -0.85 + 0.06 * gF(az);
  b.layer({ depth: 0.1, normR: 16, vR: 10, vGain: 0.15, covGain: 0.9, detail: [0.16, 31, 1, 9, 1], lights: true }, (p) => {
    p.ridge(ground, '#4c4d45', '#3f403a', 2);
    // Neighbour house to the south-east: hip roof with a front gable, chimney, TV antenna, lit windows.
    {
      const house = new Path2D();
      const x0 = 150;
      const x1 = 176;
      rect(house, x0, -1, x1, 1.4);
      poly(house, [[x0 - 1.2, 1.3], [x0 + 5.5, 3.0], [x1 - 5.5, 3.0], [x1 + 1.2, 1.3]]);
      poly(house, [[x0 + 4.5, 1.3], [x0 + 9.5, 3.9], [x0 + 14.5, 1.3]]);
      rect(house, x1 - 7.5, 2.7, x1 - 6.2, 4.3);
      rect(house, x1 - 7.7, 4.2, x1 - 6.0, 4.45);
      p.fill(house, '#4d4742', 163, 16);
      const ant = new Path2D();
      limb(ant, x0 + 17, 3.0, x0 + 17, 5.4, 0.05, 0.035);
      for (let i = 0; i < 4; i++) limb(ant, x0 + 16 + i * 0.12, 4.7 + i * 0.18, x0 + 18 - i * 0.12, 4.7 + i * 0.18, 0.02, 0.02);
      p.fill(ant, '#3b3835', 167, 4);
      // Warm windows (one with a curtain glow) and a porch light.
      p.lightRect(x0 + 3.2, 0.2, 2.2, 0.75, 0.55, HUE_WARM);
      p.lightRect(x0 + 16.5, 0.25, 1.6, 0.7, 0.3, 0.6);
      p.light(x0 + 7.6, 0.9, 0.07, 0.8, HUE_WARM, 0.2);
    }
    // Big street trees.
    const trees = new WPath(rng);
    for (const c of [28, 318, 212, 104]) {
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const az = c + rng.gauss() * 5;
        const h = rng.range(6.5, 12);
        const base = ground(az);
        trees.add(az, h, (pp, r, a, wd) => broadleaf(pp, r, a, base, h, h * r.range(1.0, 1.35), wd));
      }
    }
    p.fill(trees.wood, '#3b352f');
    p.fill(trees, '#34412c');
    // Lamp post with an LED cobra head.
    {
      const cx = 88;
      const lp = new Path2D();
      limb(lp, cx, ground(cx), cx, 5.4, 0.1, 0.07);
      limb(lp, cx, 5.35, cx + 1.8, 5.8, 0.06, 0.05);
      blob(lp, rng, cx + 1.9, 5.75, 0.35, 0.12, 0.02, 0, 20);
      p.fill(lp, '#3a3b3c', cx + 1, 3);
      p.light(cx + 1.9, 5.64, 0.2, 1.0, HUE_LED, 0.35);
    }
    // Utility poles (a near one and two receding ones) with sagging wires between them.
    {
      const pole = (cx: number, top: number, s: number): Path2D => {
        const up = new Path2D();
        limb(up, cx, ground(cx), cx + 0.01 * s, top, 0.16 * s, 0.11 * s);
        rect(up, cx - 1.4 * s, top - 0.7 * s, cx + 1.4 * s, top - 0.5 * s);
        for (const dx of [-1.25, -0.6, 0.6, 1.25]) rect(up, cx + (dx - 0.05) * s, top - 0.5 * s, cx + (dx + 0.05) * s, top - 0.32 * s);
        return up;
      };
      const cx = 238;
      const top = 7.3;
      const near = pole(cx, top, 1);
      blob(near, rng, cx - 0.26, top - 1.4, 0.2, 0.34, 0.02, 0, 20);
      p.fill(near, '#35302b', cx, 2);
      const ends: [number, number][] = [
        [cx - 36, 2.3],
        [cx + 36, 2.3],
      ];
      for (const [ex, et] of ends) p.fill(pole(ex, et, et / top), '#3a3530', ex, 1);
      const wires = new Path2D();
      for (const dx of [-1.25, -0.6, 0.6, 1.25]) {
        const y0 = top - 0.35;
        for (const [ex, et] of ends) {
          const k = et / top;
          const x1 = ex + dx * k;
          const y1 = et - 0.35 * k;
          const n = 80;
          wires.moveTo(cx + dx, y0);
          for (let i = 1; i <= n; i++) {
            const t = i / n;
            // Perspective foreshortening toward the far pole plus a catenary-like sag.
            const e = 1 - Math.pow(1 - t, 2.2);
            wires.lineTo(cx + dx + (x1 - cx - dx) * t, y0 + (y1 - y0) * e - Math.sin(t * Math.PI) * 0.7 * (1 - t * 0.5));
          }
        }
      }
      p.stroke(wires, '#2b2a28', 0.035, cx, 40);
    }
  });

  return {
    ground: '#4a4a43',
    domes: [
      { az: 246, width: 30, amp: 1.0, height: 9 }, // downtown
      { az: 20, width: 40, amp: 0.45, height: 7 }, // Roseville / Citrus Heights
      { az: 165, width: 35, amp: 0.4, height: 6 }, // Elk Grove
      { az: 0, width: 180, amp: 0.55, height: 10 }, // all-round urban glow
    ],
    emisGain: 2.2,
  };
}

/** Organic forest/woodland patches below crest `f` wherever `mask(az, alt) > 0`. */
function patches(
  wp: WPath,
  rng: Rng,
  f: Fn1,
  count: number,
  bottom: number,
  rxMin: number,
  rxMax: number,
  mask: (az: number, alt: number) => number,
  flat = 0.4,
): void {
  for (let i = 0; i < count; i++) {
    const az = rng.range(0, 360);
    const top = f(az);
    if (top < bottom + 0.05) continue;
    const alt = top - rng.range(0.0, 1) ** 0.8 * (top - bottom);
    if (mask(az, alt) <= 0) continue;
    const rx = rng.range(rxMin, rxMax);
    const ry = rx * flat * rng.range(0.7, 1.3);
    wp.add(az, rx * 1.6, (p, r, a) => blob(p, r, a, Math.min(alt, top - ry * 0.6), rx, ry, 0.3, 0.1, 36));
  }
}

/** Glacier Point: granite domes, Half Dome ENE, High Sierra, deep valley to the west. */
function buildAlpine(b: Builder, rng: Rng): KindConfig {
  // 1 · Distant High Sierra crest.
  const hR = ridged(rng, 40, 5, 0.55);
  const hF = fbm(rng, 10, 3);
  const farBase = (az: number) =>
    -0.9 + 3.1 * smooth(0, 1, bump(az, 70, 55) + 0.5 * bump(az, 150, 30)) + 1.6 * bump(az, 355, 25);
  const far = (az: number) => {
    const high = smooth(-0.5, 2.0, farBase(az));
    return farBase(az) + high * (1.3 * hR(az) - 0.2) + 0.15 * hF(az);
  };
  b.layer({ depth: 1, normR: 4, vGain: 0.04, ntGain: 2.5, ntFall: 0.9, detail: [0.08, 31, 0.3, 9, 0.3] }, (p) => {
    p.ridge(far, '#8e98a2', '#7a8791', 2.5);
    const snow = new WPath(rng);
    for (let az = 0; az < 360; az += 0.4) {
      const c = far(az);
      if (c > 2.6 && rng.chance(0.35)) {
        const y = c - rng.range(0.06, 0.25);
        const rx = rng.range(0.06, 0.2);
        const ry = rng.range(0.02, 0.06);
        snow.add(az, rx * 2, (pp, r, a) => blob(pp, r, a, y, rx, ry, 0.4, 0.1, 12));
      }
    }
    p.fill(snow, '#d6dade');
  });

  // 2 · Clouds Rest, the Clark Range, Mt Hoffmann.
  const cR = ridged(rng, 60, 4);
  const cloudsRest = pchip([
    [28, -1], [34, 2.6], [42, 3.9], [52, 5.0], [60, 5.55], [64, 5.4], [70, 4.3], [76, 2.5], [82, 0],
  ]);
  const clark = pchip([
    [92, -1], [98, 2.6], [103, 4.6], [106, 5.5], [109, 4.7], [114, 5.1], [118, 4.2], [122, 3.6], [132, 2.2], [140, -1],
  ]);
  const hoff = pchip([[2, -1], [8, 2.4], [14, 3.7], [17, 3.4], [22, 2.8], [28, -1]]);
  const mid = (az: number) => {
    const a = wrap360(az);
    return Math.max(cloudsRest(a) + 0.12 * cR(a), clark(a) + 0.35 * cR(a) - 0.1, hoff(a) + 0.2 * cR(a), -2);
  };
  const patchM = patchNoise(rng, 30);
  b.layer({ depth: 0.8, normR: 5, vGain: 0.05, covGain: 0.6, ntGain: 3.5, ntFall: 1.0, detail: [0.1, 31, 0.25, 9, 0.3] }, (p) => {
    p.ridge(mid, '#8f9296', '#80878a', 3);
    // Forest below a ragged treeline; bare granite above.
    const tl = fbm(rng, 90, 3);
    const forest = new Path2D();
    const tlAlt = (az: number) => Math.min(mid(az) - 0.15, 3.3 + 0.6 * tl(az) + 0.8 * patchM(az, 3));
    forest.moveTo(AZ_LO - 1, ALT_MIN - 1);
    for (let az = AZ_LO - 1; az <= AZ_HI + 1; az += 0.05) forest.lineTo(az, tlAlt(az));
    forest.lineTo(AZ_HI + 1, ALT_MIN - 1);
    forest.closePath();
    p.fill(forest, p.canopy(rng, '#56614f', '#434d40', '#67725f', 1.4, 0.6));
  });

  // 3 · Granite domes and valley walls: Half Dome, North/Basket Domes, Mt Starr King, Liberty Cap, the west rim.
  const halfDome = pchip([
    [51, -1.2], [54.0, 0.1], [55.6, 1.5], [56.5, 3.0], [56.75, 5.0], [56.95, 6.6], [57.25, 7.15], [58.0, 7.42], [60.0, 7.5],
    [62.0, 7.38], [64.0, 7.0], [66.0, 6.3], [67.5, 5.5], [68.8, 4.6], [70.0, 3.9], [71.5, 3.2], [73.5, 2.6], [76, 2.0], [80, 1.2], [85, 0.5], [90, -0.2],
  ]);
  const northDome = pchip([[344, -0.6], [348, 0.8], [352, 2.1], [355, 2.5], [358, 2.4], [361, 2.1], [363, 2.8], [366, 3.5], [369, 3.3], [373, 2.0], [378, 0.6], [383, -0.4]]);
  const starrKing = pchip([[113, -1.3], [118, 0.4], [122, 2.2], [124.5, 3.8], [126.5, 4.8], [127.8, 5.1], [129, 4.8], [131.5, 3.4], [135, 1.8], [140, 0.6], [146, -1.3]]);
  const libertyCap = pchip([[78, -0.5], [82, 0.8], [84, 1.9], [85.2, 2.3], [86.5, 2.1], [88, 1.0], [90, 1.3], [92, 1.4], [95, 0.5], [100, -0.4]]);
  const westRim = pchip([
    [180, 1.8], [195, 1.2], [210, 0.4], [225, -0.2], [240, -0.6], [255, -0.9], [264, -0.6], [268, 0.35], [271, 0.6], [273.5, 1.25],
    [276, 1.15], [280, 0.9], [290, 1.3], [300, 1.6], [310, 2.0], [318, 2.7], [321, 2.5], [326, 1.9], [332, 1.7], [340, 1.2], [345, 0.4], [350, -0.5], [356, -1.3],
  ]);
  const dN = fbm(rng, 90, 3);
  const domes = (az: number) => {
    const a = wrap360(az);
    const aN = a < 180 ? a + 360 : a;
    const rim = -1.1 + 2.0 * bump(a, 22, 30) + 0.9 * bump(a, 100, 8) + 0.35 * dN(a);
    return Math.max(halfDome(a), northDome(aN), starrKing(a), libertyCap(a), westRim(a) + 0.08 * dN(a), rim);
  };
  const bald = (az: number, alt = 99) => {
    const a = wrap360(az);
    return (halfDome(a) > 1.2 && alt > 1.8) || (starrKing(a) > 2.2 && alt > 2.6) || (libertyCap(a) > 1.3 && alt > 1.1);
  };
  b.layer({ depth: 0.55, normR: 8, vGain: 0.08, covGain: 0.9, ntGain: 2.2, ntFall: 1.8, detail: [0.16, 31, 0.15, 9, 0.2] }, (p) => {
    // Base: forest canopy everywhere; granite is then laid over domes and cliff bands.
    p.ridge(domes, p.canopy(rng, '#3f4b3b', '#2b352b', '#56644f', 1.6, 0.7), '', 5);
    const cN = fbm(rng, 36, 3, 0.55);
    const cN2 = fbm(rng, 140, 2);
    const granite = new Path2D();
    const streaks = new WPath(rng);
    /** Base altitude of the bare-granite dome that forms the crest here, or NaN. */
    const domeBase = (az: number): number => {
      const a = wrap360(az);
      const top = domes(az);
      if (halfDome(a) >= top - 0.01 && halfDome(a) > 1.0) return 1.2;
      if (starrKing(a) >= top - 0.01 && starrKing(a) > 2.0) return 2.2;
      if (libertyCap(a) >= top - 0.01 && libertyCap(a) > 0.9) return 1.0;
      return NaN;
    };
    const gTop = (az: number) => {
      const top = domes(az);
      return Number.isNaN(domeBase(az)) ? top - 0.18 - 0.25 * (0.5 + 0.5 * cN2(az)) : top + 0.05;
    };
    const gBot = (az: number) => {
      const t = gTop(az);
      const db = domeBase(az);
      if (!Number.isNaN(db)) return Math.min(t, db + 0.35 * cN2(az * 2));
      const thick = Math.max(0, cN(az) + 0.12) * 4.2;
      return t - thick - 0.35 * cN2(az * 3) * Math.min(1, thick);
    };
    // Build the granite region as runs of azimuth where a cliff band exists.
    const step = 0.08;
    let run: number[] = [];
    const flush = () => {
      if (run.length > 1) {
        granite.moveTo(run[0], gTop(run[0]));
        for (const az of run) granite.lineTo(az, gTop(az));
        for (let i = run.length - 1; i >= 0; i--) granite.lineTo(run[i], Math.min(gBot(run[i]), gTop(run[i])));
        granite.closePath();
      }
      run = [];
    };
    for (let az = AZ_LO - 0.2; az <= AZ_HI + 0.2; az += step) {
      if (gBot(az) < gTop(az) - 0.05) run.push(az);
      else flush();
    }
    flush();
    p.fill(granite, '#a09a8e');
    // Water-stain streaks on the exposed granite.
    for (let i = 0; i < 1400; i++) {
      const az = rng.range(0, 360);
      const t = gTop(az);
      const bt = gBot(az);
      if (bt > t - 0.3) continue;
      const y0 = t - rng.range(0.02, 0.4) * (t - bt);
      const len = rng.range(0.2, 0.9) * (y0 - bt);
      const w = rng.range(0.012, 0.045);
      streaks.add(az, 0.2, (pp, r, a) => limb(pp, a, y0, a + r.range(-0.03, 0.03), y0 - len, w, w * 0.25));
    }
    p.fill(streaks, '#7f7a70');
    const rim = new WPath(rng);
    for (let az = 0; az < 360; az += rng.range(0.02, 0.06)) {
      if (bald(az)) continue;
      const top = domes(az);
      const alt = top - rng.range(0, 0.25);
      const h = rng.range(0.07, 0.18);
      rim.add(az, h, (pp, r, x) => fir(pp, r, x, alt - h * 0.2, h, h * 0.45));
    }
    p.fill(rim, '#37432f');
    // The sheer NW face of Half Dome: paler, smoother granite.
    const face = new Path2D();
    face.moveTo(56.5, 3.0);
    face.lineTo(56.75, 5.0);
    face.lineTo(56.95, 6.6);
    face.lineTo(57.25, 7.15);
    face.lineTo(58.0, 7.42);
    face.lineTo(58.9, 6.9);
    face.lineTo(59.5, 5.2);
    face.lineTo(59.4, 3.0);
    face.lineTo(58.2, 1.6);
    face.closePath();
    p.fill(face, '#aaa498', 58, 4);
    const faceStreaks = new Path2D();
    for (let i = 0; i < 26; i++) {
      const x = rng.range(56.9, 59.3);
      const y0 = Math.min(halfDome(x) - 0.1, 7.3);
      limb(faceStreaks, x, y0, x + rng.range(-0.05, 0.05), y0 - rng.range(1, 4), rng.range(0.01, 0.03), 0.005);
    }
    p.fill(faceStreaks, '#8e887d', 58, 4);
  });

  // 4 · Nearer forested ridges to the south and Sentinel Dome to the SW.
  const sF = fbm(rng, 40, 3);
  const sentinel = pchip([[206, -1], [212, 1.5], [218, 4.5], [222, 6.8], [226, 8.1], [229, 8.4], [232, 8.0], [236, 6.6], [241, 4.2], [247, 2.2], [253, -1]]);
  const southRidge = (az: number) => {
    const a = wrap360(az);
    return Math.max(-4.5 + 7.0 * smooth(0, 1, bump(a, 205, 38)) + 0.5 * sF(a) + 1.4 * bump(a, 170, 10), sentinel(a));
  };
  b.layer({ depth: 0.28, normR: 8, vGain: 0.1, covGain: 0.8, ntGain: 2, ntFall: 1.5, detail: [0.14, 31, 0.4, 9, 0.4] }, (p) => {
    p.ridge(southRidge, p.canopy(rng, '#3a4637', '#28312a', '#526049', 3, 1.3), '', 3);
    // Bare granite crown of Sentinel Dome.
    const granite = new Path2D();
    granite.moveTo(219.5, 5.4);
    for (let az = 219.5; az <= 238.5; az += 0.25) granite.lineTo(az, sentinel(az) + 0.02);
    granite.lineTo(238.5, 5.0);
    for (let az = 238.5; az >= 219.5; az -= 0.5) granite.lineTo(az, 5.2 + 0.4 * Math.sin(az * 1.7) + 0.2 * Math.sin(az * 5.1));
    granite.closePath();
    p.fill(granite, '#a39d91', 229, 12);
    const trees = new WPath(rng);
    for (let az = 140; az < 285; az += rng.range(0.1, 0.45)) {
      const top = southRidge(az);
      if (top < -0.6) continue;
      if (sentinel(wrap360(az)) > 7.2 && rng.chance(0.92)) continue;
      const h = rng.range(0.4, 1.3);
      trees.add(az, h, (pp, r, a) => fir(pp, r, a, top - 0.05, h, h * r.range(0.28, 0.4)));
    }
    // The famous wind-sculpted Jeffrey pine on Sentinel Dome's summit.
    {
      const x = 228.6;
      const y = sentinel(x) - 0.05;
      const jp = new Path2D();
      trees.push(jp);
      limb(jp, x, y, x + 0.35, y + 0.9, 0.06, 0.03);
      limb(jp, x + 0.3, y + 0.8, x + 1.4, y + 1.05, 0.04, 0.015);
      limb(jp, x + 0.2, y + 0.55, x - 0.7, y + 0.8, 0.035, 0.012);
      blob(jp, rng, x + 1.2, y + 1.05, 0.35, 0.12, 0.3, 0.1, 18);
    }
    p.fill(trees, '#344033');
  });

  // 5 · Foreground: granite apron at the viewpoint, tall firs framing left and right, forest behind.
  const gF = fbm(rng, 24, 3);
  const ground = (az: number) => {
    const a = wrap360(az);
    return -3.2 + 0.35 * gF(a) + smooth(0, 1, bump(a, 215, 55)) * 2.9;
  };
  b.layer({ depth: 0.04, normR: 18, vR: 12, vGain: 0.06, covGain: 0.9, ntGain: 2, ntFall: 1.5, detail: [0.14, 31, 0.5, 9, 0.5] }, (p) => {
    p.ridge(ground, p.canopy(rng, '#8a847b', '#6f6a62', '#9d978d', 1.2, 1.6, 0.6), '', 3);
    const rocks = new WPath(rng);
    for (let i = 0; i < 30; i++) {
      const az = rng.range(0, 360);
      const r0 = rng.range(0.25, 0.9);
      const y = ground(az) - r0 * 0.1 - rng.range(0, 1.5);
      rocks.add(az, r0 * 2, (pp, r, a) => blob(pp, r, a, y, r0 * 1.5, r0 * 0.55, 0.15, 0.02, 24));
    }
    p.fill(rocks, '#8a8378');
    const firs = new WPath(rng);
    const dead = new WPath(rng);
    const groups: [number, number, number, number][] = [
      // centre az, spread, count, max height
      [22, 5, 3, 13.5],
      [148, 8, 4, 13],
      [185, 10, 5, 14],
      [252, 10, 5, 14],
      [292, 5, 2, 11],
    ];
    for (const [c, sp, n, hmax] of groups) {
      for (let k = 0; k < n; k++) {
        const az = c + rng.gauss() * sp;
        const h = rng.range(hmax * 0.55, hmax);
        const base = ground(az) - 0.2;
        firs.add(az, h * 0.2, (pp, r, a) => fir(pp, r, a, base, h, h * r.range(0.24, 0.32)));
      }
    }
    const sb = ground(306) - 0.2;
    dead.add(306, 2, (pp, r, a) => snag(pp, r, a, sb, 9.5));
    p.fill(firs, '#26301f');
    p.fill(dead, '#5a4d42');
  });

  return {
    ground: '#8a847a',
    haze: 0.55,
    domes: [
      { az: 245, width: 35, amp: 0.35, height: 3 }, // Central Valley (Merced / Modesto)
      { az: 195, width: 18, amp: 0.25, height: 3 }, // Fresno
    ],
    emisGain: 1.5,
  };
}

/** Generic site: low, gently irregular tree line. */
function buildFlat(b: Builder, rng: Rng): KindConfig {
  const f1 = fbm(rng, 40, 3);
  b.layer({ depth: 0.85, normR: 3, detail: [0.06, 31, 1, 9, 1] }, (p) => {
    p.ridge((az) => 0.05 + 0.05 * f1(az), '#6f7a70', '#6a7468', 1);
    const t = new WPath(rng);
    for (let az = 0; az < 360; az += rng.range(0.1, 0.4)) {
      if (rng.chance(0.25)) continue;
      const h = (0.25 + 0.2 * f1(az * 2)) * rng.range(0.7, 1.4);
      t.add(az, h, (pp, r, a) => blob(pp, r, a, 0.05 + h * 0.5, h * 0.7, h * 0.5, 0.2, 0.05, 16));
    }
    p.fill(t, '#56634f');
  });
  const f2 = fbm(rng, 16, 3);
  b.layer({ depth: 0.3, normR: 6, covGain: 0.8, detail: [0.14, 31, 1, 9, 1], lights: true }, (p) => {
    p.ridge((az) => -0.1 + 0.05 * f2(az), '#5f6246', '#56593f', 1);
    for (let i = 0; i < 10; i++) p.light(rng.range(0, 360), rng.range(0.0, 0.2), 0.03, rng.range(0.35, 0.7), rng.pick([HUE_WARM, HUE_SODIUM, HUE_LED]));
    const trees = new WPath(rng);
    for (let az = 0; az < 360; ) {
      const belt = f2(az) > -0.2;
      az += rng.range(0.25, 1.1);
      if (!belt) continue;
      const h = rng.range(0.5, 2.0);
      if (rng.chance(0.7)) trees.add(az, h, (pp, r, a) => broadleaf(pp, r, a, -0.1, h, h * r.range(0.9, 1.5)));
      else trees.add(az, h, (pp, r, a) => fir(pp, r, a, -0.1, h, h * 0.4));
    }
    p.fill(trees, '#3d4933');
    const barn = new Path2D();
    poly(barn, [[138, -0.2], [138, 0.35], [138.6, 0.62], [139.6, 0.62], [140.2, 0.35], [140.2, -0.2]]);
    p.fill(barn, '#5e4a3f', 139, 2);
    p.light(139.1, 0.2, 0.04, 0.8, HUE_SODIUM, 0.3);
  });
  const g = fbm(rng, 30, 2);
  const ground = (az: number) => -0.7 + 0.05 * g(az);
  b.layer({ depth: 0.06, normR: 12, vGain: 0.04, detail: [0.12, 31, 0.6, 3, 0.8] }, (p) => {
    p.ridge(ground, p.grass(rng, '#7a7650', '#625e3c', '#8f8a5e', 3.0, 1000), '', 3);
    const grass = new WPath(rng);
    grassTufts(grass, rng, ground, 0.1, 0.35, 0.1);
    const posts = new Path2D();
    grass.push(posts);
    for (let az = 200; az < 330; az += 2.4) limb(posts, az, ground(az) - 0.1, az, ground(az) + 0.9, 0.05, 0.04);
    const fence = new Path2D();
    for (const y of [0.45, 0.8]) {
      fence.moveTo(200, ground(200) + y);
      for (let az = 200; az <= 330; az += 1) fence.lineTo(az, ground(az) + y - 0.05 * Math.sin(((az - 200) / 2.4) * Math.PI));
    }
    p.fill(grass, '#5f5b3c');
    p.stroke(fence, '#4d4636', 0.03, 265, 70);
  });
  return {
    ground: '#6e6a47',
    domes: [
      { az: 0, width: 180, amp: 0.25, height: 6 },
      { az: 220, width: 30, amp: 0.4, height: 5 },
    ],
    emisGain: 1.6,
  };
}

// ───────────────────────────── shaders ─────────────────────────────

const LAND_VERT = /* glsl */ `
varying vec3 vPos;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const LAND_FRAG = /* glsl */ `
uniform sampler2D uColor;
uniform sampler2D uAux;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSky;
uniform vec3 uGround;
uniform float uSunAlt;
uniform float uMoonIllum;
uniform float uNV;
uniform float uLP;
uniform float uTime;
uniform float uHorizSun;
uniform float uEmisGain;
uniform float uNightF;
uniform float uHaze;
varying vec3 vPos;
#include <logdepthbuf_pars_fragment>

#define L_PI 3.14159265359
#define L_R2D 57.2957795131
const float TEXW = ${TEX_W.toFixed(1)};
const float TEXH = ${TEX_H.toFixed(1)};
const float MARGIN = ${MARGIN_PX.toFixed(1)};
const float PPD = ${PPD.toFixed(6)};
const float PPDY = ${PPDY.toFixed(6)};
const float ALT_MIN = ${ALT_MIN.toFixed(1)};
const float ALT_MAX = ${ALT_MAX.toFixed(1)};

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
float lhash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float lnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = lhash(i), b = lhash(i + vec2(1.0, 0.0)), c = lhash(i + vec2(0.0, 1.0)), d = lhash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 sunLight(float a) {
  float t = smoothstep(-2.0, 25.0, a);
  vec3 c = mix(vec3(1.0, 0.36, 0.13), vec3(1.0, 0.95, 0.88), t);
  float I = smoothstep(-5.0, 3.0, a) * (0.75 + 0.25 * smoothstep(0.0, 30.0, a));
  return c * I * 1.35;
}
vec3 hueCol(float h) {
  vec3 red = vec3(1.0, 0.06, 0.03);
  vec3 sod = vec3(1.0, 0.5, 0.15);
  vec3 warm = vec3(1.0, 0.78, 0.5);
  vec3 cool = vec3(0.82, 0.9, 1.0);
  vec3 c = mix(sod, warm, smoothstep(0.36, 0.64, h));
  c = mix(c, cool, smoothstep(0.7, 0.98, h));
  return mix(red, c, smoothstep(0.12, 0.22, h));
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vPos);
  float altD = asin(clamp(d.y, -1.0, 1.0)) * L_R2D;
  float azD = atan(d.x, -d.z) * L_R2D;
  if (azD < 0.0) azD += 360.0;
  // Screen-space gradients (continuous across the 0/360 wrap).
  float dax = dFdx(azD); dax -= 360.0 * floor(dax / 360.0 + 0.5);
  float day = dFdy(azD); day -= 360.0 * floor(day / 360.0 + 0.5);
  float dlx = dFdx(altD);
  float dly = dFdy(altD);
  if (altD > ALT_MAX) discard;

  float altT = max(altD, ALT_MIN + 0.02);
  float yv = (ALT_MAX - altT) * PPDY;
  bool stripB = azD >= 180.0;
  float xv = MARGIN + (stripB ? azD - 180.0 : azD) * PPD;
  vec2 uv = vec2(xv / TEXW, stripB ? (TEXH - yv) / TEXH : yv / TEXH);
  float sg = stripB ? 1.0 : -1.0;
  vec2 gx = vec2(dax * PPD / TEXW, sg * dlx * PPDY / TEXH);
  vec2 gy = vec2(day * PPD / TEXW, sg * dly * PPDY / TEXH);
  vec4 tc = textureGrad(uColor, uv, gx, gy);
  vec4 ta = textureGrad(uAux, uv, gx, gy);

  float gnd = smoothstep(ALT_MIN + 1.4, ALT_MIN + 0.1, altD);
  float a = tc.a;
  if (a < 0.004 && gnd <= 0.0) discard;
  float ia = 1.0 / max(a, 0.002);
  vec3 alb = toLinear(clamp(tc.rgb * ia, 0.0, 1.0));
  float depth = clamp(ta.b * ia, 0.0, 1.0);
  float nt = clamp(ta.a * ia * 2.0 - 1.0, -1.0, 1.0);
  float emis = ta.r;
  float hue = ta.g / max(ta.r, 0.004);

  if (gnd > 0.0) {
    // Looking down: procedural ground on the plane 1.6 m below the eye.
    vec2 gp = d.xz / max(-d.y, 0.05) * 1.6;
    float fw = length(fwidth(gp));
    float n = lnoise(gp * 0.25) * 0.5 + lnoise(gp * 0.9) * 0.3 * (1.0 - smoothstep(0.3, 1.2, fw)) + lnoise(gp * 3.1) * 0.2 * (1.0 - smoothstep(0.08, 0.35, fw));
    vec3 galb = uGround * (0.7 + 0.6 * n);
    alb = mix(alb, galb, gnd);
    depth *= 1.0 - gnd;
    nt *= 1.0 - gnd;
    emis *= 1.0 - gnd;
    a = mix(a, 1.0, gnd);
  }

  // Approximate surface normal: faces the viewer, tilted sideways by nt, up-facing for ground.
  vec3 radial = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 0.0));
  vec3 tang = vec3(-radial.z, 0.0, radial.x);
  float groundy = clamp(gnd + smoothstep(-0.5, -3.5, altD) * (1.0 - depth), 0.0, 1.0);
  vec3 nrm = normalize(-radial * (1.0 - 0.6 * abs(nt)) + tang * nt * 1.1 + vec3(0.0, mix(0.45, 2.5, groundy), 0.0));

  // Sun: near terrain is shadowed once the Sun drops behind the local horizon; high/far terrain keeps
  // catching light a little longer (alpenglow).
  float thr = mix(uHorizSun, -0.8 - max(altD, 0.0) * 0.5, smoothstep(0.1, 0.65, depth));
  float vis = smoothstep(-0.7, 0.9, uSunAlt - thr);
  float ndl = dot(nrm, uSunDir);
  vec3 light = sunLight(uSunAlt) * max(ndl * 0.9 + 0.1, 0.0) * vis;
  // Skylight (hemispherical): mostly sky colour from above.
  float skyL = dot(uSky, vec3(0.2126, 0.7152, 0.0722));
  vec3 skyTint = mix(uSky, skyL * vec3(0.72, 0.9, 1.35), 0.55 * smoothstep(-10.0, 2.0, uSunAlt));
  vec3 amb = skyTint * (0.32 + 0.3 * nrm.y);
  // Moonlight.
  float mUp = smoothstep(-0.02, 0.2, uMoonDir.y);
  light += vec3(0.62, 0.72, 0.95) * 0.06 * uMoonIllum * mUp * max(dot(nrm, uMoonDir) * 0.8 + 0.25, 0.0);
  // Urban skyglow reflected by the ground.
  light += vec3(1.0, 0.62, 0.32) * uLP * uLP * 0.012 * uNightF;
  vec3 col = alb * (light + amb);

  // Aerial perspective / airlight toward the horizon sky colour.
  float dp = pow(depth, 1.3);
  float hzNear = mix(0.03, 0.2, uNightF);
  float hzFar = mix(0.6, 0.5, uNightF);
  float hz = mix(hzNear, hzFar * mix(uHaze, 1.0, uNightF * 0.6), dp);
  col = mix(col, uSky, hz);

  // Emissive lights at night.
  if (emis > 0.002) {
    float h = lhash(floor(vec2(xv, yv) / 3.0) + (stripB ? 17.0 : 0.0));
    float tw = 1.0 + 0.1 * sin(uTime * (1.3 + 2.7 * h) + h * 40.0) + 0.05 * sin(uTime * 7.1 * (0.5 + h));
    float blink = hue < 0.15 ? (0.2 + 0.8 * smoothstep(0.35, 0.5, fract(uTime * 0.5 + h * 0.1)) * (1.0 - smoothstep(0.85, 1.0, fract(uTime * 0.5 + h * 0.1)))) : 1.0;
    col += hueCol(hue) * emis * uEmisGain * uNightF * tw * blink * (1.0 - 0.5 * hz);
  }

  if (uNV > 0.5) {
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = vec3(l * 1.1, l * 0.06, l * 0.03);
  }
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const GLOW_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
uniform vec4 uDomes[4];
uniform float uGlow;
uniform float uNV;
varying vec3 vPos;
void main() {
  vec3 d = normalize(vPos);
  float altD = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float azD = degrees(atan(d.x, -d.z));
  float I = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 dm = uDomes[i];
    float da = abs(mod(azD - dm.x + 540.0, 360.0) - 180.0);
    float w = max(dm.y, 0.001);
    I += dm.z * exp(-0.5 * da * da / (w * w)) * exp(-max(altD, 0.0) / max(dm.w, 0.1));
  }
  I *= smoothstep(-3.0, 0.0, altD) * uGlow;
  vec3 c = mix(vec3(1.0, 0.58, 0.28), vec3(0.9, 0.82, 0.74), smoothstep(0.0, 14.0, altD)) * I;
  if (uNV > 0.5) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = vec3(l * 1.1, l * 0.06, l * 0.03);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ───────────────────────────── public API ─────────────────────────────

const DEFAULT_SEEDS: Record<HorizonKind, number> = {
  foothills: 0x51e77a,
  city: 0x5ac7a,
  alpine: 0x91ac1e7,
  flat: 0xf1a7,
};

/** Build the landscape for a site. Painting is synchronous (~0.3–1 s on first build). */
export function createLandscape(kind: HorizonKind, seed?: number): Landscape {
  const rng = new Rng(seed ?? DEFAULT_SEEDS[kind]);
  const tile = makeNoiseTile(new Rng((seed ?? DEFAULT_SEEDS[kind]) ^ 0x7777));
  const b = new Builder(tile);
  let cfg: KindConfig;
  switch (kind) {
    case 'foothills':
      cfg = buildFoothills(b, rng);
      break;
    case 'city':
      cfg = buildCity(b, rng);
      break;
    case 'alpine':
      cfg = buildAlpine(b, rng);
      break;
    default:
      cfg = buildFlat(b, rng);
  }
  const horizonProfile = b.horizonProfile();

  const mkTex = (data: Uint8Array): THREE.DataTexture => {
    const t = new THREE.DataTexture(data, TEX_W, TEX_H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    t.flipY = false;
    t.premultiplyAlpha = false;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const colorTex = mkTex(b.pack(b.color));
  const auxTex = mkTex(b.pack(b.aux));

  const uniforms = {
    uColor: { value: colorTex },
    uAux: { value: auxTex },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uSky: { value: new THREE.Color(0.004, 0.006, 0.012) },
    uGround: { value: new THREE.Color(cfg.ground) },
    uSunAlt: { value: 45 },
    uMoonIllum: { value: 0 },
    uNV: { value: 0 },
    uLP: { value: 0 },
    uTime: { value: 0 },
    uHorizSun: { value: 0 },
    uEmisGain: { value: cfg.emisGain },
    uNightF: { value: 0 },
    uHaze: { value: cfg.haze ?? 1 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'LandscapeMaterial',
    uniforms,
    vertexShader: LAND_VERT,
    fragmentShader: LAND_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    premultipliedAlpha: false,
  });
  // Sphere cap from the nadir up to just above ALT_MAX.
  const thetaStart = (90 - ALT_MAX - 0.6) * D2R;
  const geometry = new THREE.SphereGeometry(RADIUS, 128, 40, 0, Math.PI * 2, thetaStart, Math.PI - thetaStart);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'landscape';
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;

  // Light-pollution domes just above the horizon (additive, behind the terrain).
  const domes = new Array(4).fill(0).map((_, i) => {
    const d = cfg.domes[i];
    return d ? new THREE.Vector4(d.az, d.width, d.amp, d.height) : new THREE.Vector4(0, 1, 0, 1);
  });
  const glowUniforms = {
    uDomes: { value: domes },
    uGlow: { value: 0 },
    uNV: { value: 0 },
  };
  const glowMat = new THREE.ShaderMaterial({
    name: 'LightDomeMaterial',
    uniforms: glowUniforms,
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const glowStart = (90 - 50) * D2R;
  const glowGeom = new THREE.SphereGeometry(GLOW_RADIUS, 96, 24, 0, Math.PI * 2, glowStart, (90 + 4) * D2R - glowStart);
  const glow = new THREE.Mesh(glowGeom, glowMat);
  glow.name = 'light-domes';
  glow.renderOrder = 9;
  glow.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'landscape-root';
  group.add(glow);
  group.add(mesh);

  const horizonAltAt = (azDeg: number): number => {
    const a = wrap360(azDeg);
    const i0 = Math.floor(a) % 360;
    const i1 = (i0 + 1) % 360;
    const f = a - Math.floor(a);
    return horizonProfile[i0] * (1 - f) + horizonProfile[i1] * f;
  };

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  return {
    object: group,
    horizonProfile,
    kind,
    horizonAltAt,
    update(p: LandscapeUpdateParams) {
      const u = uniforms;
      u.uSunDir.value.copy(p.sunDir).normalize();
      u.uMoonDir.value.copy(p.moonDir).normalize();
      u.uSunAlt.value = p.sunAltDeg;
      u.uMoonIllum.value = clamp(p.moonIllum, 0, 1);
      u.uSky.value.copy(p.skyColorHorizon);
      u.uNV.value = p.nightVision ? 1 : 0;
      u.uLP.value = clamp(p.lightPollution, 0, 1);
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      u.uTime.value = (now - t0) / 1000;
      u.uNightF.value = 1 - smooth(-9, -4, p.sunAltDeg);
      const sunAz = Math.atan2(p.sunDir.x, -p.sunDir.z) / D2R;
      u.uHorizSun.value = horizonAltAt(sunAz);
      glowUniforms.uGlow.value = u.uLP.value * 0.06 * (1 - smooth(-13, -3, p.sunAltDeg));
      glowUniforms.uNV.value = u.uNV.value;
    },
    setVisible(v: boolean) {
      group.visible = v;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      glowGeom.dispose();
      glowMat.dispose();
      colorTex.dispose();
      auxTex.dispose();
      group.removeFromParent();
    },
  };
}
