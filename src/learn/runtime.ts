import * as THREE from 'three';
import * as A from 'astronomy-engine';
import type { App } from '../app';
import type { SkyObject } from '../core/objects';
import type { MajorBodyId } from '../astro/solarsystem';
import type { Settings } from '../core/settings';
import { altAzToWorld, worldToAltAz, raDecToVec } from '../astro/frames';

/** Wall-clock parts of an instant in an IANA time zone. */
function zoneParts(ms: number, tz: string): number[] {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, Number(x.value)]),
  );
  return [p.year, p.month, p.day, p.hour % 24, p.minute];
}

/** UTC instant for a local wall-clock time (month 1–12) in a zone, honouring DST. */
export function zonedDate(tz: string, y: number, month: number, d: number, hh = 0, mm = 0): Date {
  const target = Date.UTC(y, month - 1, d, hh, mm);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const [py, pmo, pd, ph, pm] = zoneParts(guess, tz);
    const diff = target - Date.UTC(py, pmo - 1, pd, ph, pm);
    if (!diff) break;
    guess += diff;
  }
  return new Date(guess);
}

/** Local calendar date [y, m, d] of an instant in a zone. */
export function localDay(ms: number, tz: string): [number, number, number] {
  const [y, m, d] = zoneParts(ms, tz);
  return [y, m, d];
}

/**
 * Everything a lesson step may do to the app. Each step gets a fresh context;
 * once the step is left the context is cancelled, its timers stop and any
 * pending camera moves are dropped.
 */
export class LessonContext {
  private cleanups: (() => void)[] = [];
  private dead = false;

  /** `setSettings` lets the player remember which settings a step changed, to restore them later. */
  constructor(
    readonly app: App,
    private readonly setSettings: (patch: Partial<Settings>) => void = (p) => app.settings.set(p),
  ) {}

  get cancelled(): boolean {
    return this.dead;
  }

  /** Stops timers and runs cleanups. Called by the player when the step is left. */
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    for (const c of this.cleanups.splice(0)) {
      try {
        c();
      } catch (e) {
        console.warn(e);
      }
    }
  }

  onLeave(fn: () => void): void {
    this.cleanups.push(fn);
  }

  get tz(): string {
    return this.app.getSite().timeZone;
  }

  /** Local wall-clock time at the current site (month 1–12). */
  local(y: number, month: number, d: number, hh = 0, mm = 0): Date {
    return zonedDate(this.tz, y, month, d, hh, mm);
  }

  /** hh:mm (local, 12–29 allowed for after midnight) on the evening of the real current night. */
  tonight(hh: number, mm = 0): Date {
    const now = Date.now();
    let [y, m, d] = localDay(now, this.tz);
    const hourNow = zoneParts(now, this.tz)[3];
    if (hourNow < 6) [y, m, d] = localDay(now - 86400e3, this.tz);
    const base = zonedDate(this.tz, y, m, d, 12, 0).getTime();
    return new Date(base + ((hh - 12) * 60 + mm) * 60e3);
  }

  /** Local noon (or another hour) today at the site. */
  today(hh: number, mm = 0): Date {
    const [y, m, d] = localDay(Date.now(), this.tz);
    return zonedDate(this.tz, y, m, d, hh, mm);
  }

  /** Sets the clock and resolves once a frame at that time has been drawn. */
  async setTime(t: Date | number, rate = 0): Promise<void> {
    if (this.dead) return;
    const ms = typeof t === 'number' ? t : t.getTime();
    this.app.time.setRate(rate);
    this.app.time.setTime(ms);
    await this.waitFrame(ms);
  }

  /**
   * Resolves after the next frame whose time matches `targetMs` (object
   * directions are only valid once the sky has been recomputed for it).
   */
  waitFrame(targetMs?: number, timeoutMs = 5000): Promise<void> {
    const app = this.app;
    const f0 = app.frame;
    const start = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const f = app.frame;
        const elapsed = performance.now() - start;
        const slack = Math.abs(app.time.rate) * (elapsed + 250) + 1500;
        const ok = !!f && f !== f0 && (targetMs == null || Math.abs(f.time.getTime() - targetMs) <= slack);
        if (ok || this.dead || elapsed > timeoutMs) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /** Changes settings for this step; the player restores them when the lesson ends. */
  set(patch: Partial<Settings>): void {
    if (!this.dead) this.setSettings(patch);
  }

  /** Pauses (or runs) the clock without changing the time. */
  setRate(rate: number): void {
    if (!this.dead) this.app.time.setRate(rate);
  }

  /**
   * Smoothly turns the camera so that altitude/azimuth (degrees) sits in the
   * middle of the sky left visible above the lesson card.
   */
  look(alt: number, az: number, fov?: number, ms = 1600): void {
    if (this.dead) return;
    const f = fov ?? this.app.view.controls.fov;
    this.app.view.controls.trackTarget = null;
    this.app.view.controls.flyTo(altAzToWorld(Math.min(89, alt - f * liftFraction()), az), fov, ms);
  }

  /** Current world direction of an object (after the frame has caught up). */
  dir(o: SkyObject): THREE.Vector3 | null {
    return this.app.view.directionOf(o);
  }

  altAz(o: SkyObject): { alt: number; az: number } | null {
    const d = this.dir(o);
    return d ? worldToAltAz(d) : null;
  }

  /**
   * Flies to a world direction. `lift` (degrees, default a fifth of the
   * field) places the target above the centre so the lesson card, which
   * covers the lower part of the screen, does not hide it.
   */
  flyToDir(d: THREE.Vector3, fov?: number, lift?: number): void {
    if (this.dead) return;
    const controls = this.app.view.controls;
    const f = fov ?? controls.fov;
    const l = lift ?? f * liftFraction();
    const { alt, az } = worldToAltAz(d);
    const camAlt = Math.min(89, Math.max(alt - l, Math.min(alt, -2)));
    controls.trackTarget = null;
    controls.flyTo(altAzToWorld(camAlt, az), fov);
  }

  /** Flies to an object and marks it with the selection reticle (without opening its card). */
  flyTo(o: SkyObject, fov?: number, opts: { mark?: boolean; lift?: number } = {}): void {
    if (this.dead) return;
    const d = this.dir(o);
    if (!d) return;
    this.flyToDir(d, fov, opts.lift);
    if (opts.mark !== false) this.mark(o);
  }

  /** Flies to the middle of several objects. */
  flyToGroup(objs: (SkyObject | null)[], fov?: number, lift?: number): void {
    const sum = new THREE.Vector3();
    for (const o of objs) {
      const d = o && this.dir(o);
      if (d) sum.add(d);
    }
    if (sum.lengthSq() > 0) this.flyToDir(sum.normalize(), fov, lift);
  }

  /** Shows the selection reticle on an object (null clears it). */
  mark(o: SkyObject | null): void {
    if (this.dead) return;
    this.app.info.close(false);
    this.app.view.select(o);
  }

  /** Keeps the camera centred on an object while time runs. */
  track(o: SkyObject | null): void {
    if (this.dead) return;
    this.app.track(o);
    this.onLeave(() => this.app.track(null));
  }

  /** Opens an object's info card (the full details). */
  select(o: SkyObject, fov?: number): void {
    if (this.dead) return;
    this.app.select(o, { fly: true, fov });
  }

  /** A named star (e.g. "Polaris") or null. */
  star(name: string): SkyObject | null {
    return findStar(this.app, name);
  }

  body(id: MajorBodyId): SkyObject {
    return { kind: 'body', id };
  }

  constellation(id: string): SkyObject {
    return { kind: 'constellation', id };
  }

  /** Runs `fn` every `ms` until the step is left (or `fn` returns false). */
  every(ms: number, fn: () => boolean | void): void {
    if (this.dead) return;
    const id = window.setInterval(() => {
      if (this.dead || fn() === false) window.clearInterval(id);
    }, ms);
    this.onLeave(() => window.clearInterval(id));
  }

  wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Draws a dashed guide path fixed to the stars. `points` are J2000 unit
   * vectors; they are re-projected to the horizon for the displayed moment.
   */
  guide(points: THREE.Vector3[]): void {
    if (this.dead) return;
    const view = this.app.view;
    const m = new THREE.Matrix3();
    view.setSelectionPath(() => {
      const f = view.frame;
      if (!f) return null;
      m.setFromMatrix4(f.eqjToWorld);
      return points.map((p) => {
        const { alt, az } = worldToAltAz(p.clone().applyMatrix3(m));
        return [alt, az] as [number, number];
      });
    });
    this.onLeave(() => view.setSelectionPath(null));
  }

  /** A guide path through objects' current directions, fixed to the stars. */
  guideThrough(objs: (SkyObject | null)[], extendLast = 0): void {
    const f = this.app.view.frame;
    if (!f) return;
    const inv = new THREE.Matrix3().setFromMatrix4(f.eqjToWorld).transpose();
    const eqj = objs
      .map((o) => (o ? this.dir(o) : null))
      .filter((d): d is THREE.Vector3 => !!d)
      .map((d) => d.clone().applyMatrix3(inv).normalize());
    if (eqj.length < 2) return;
    // Densify along great circles so the curve follows the sky.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < eqj.length - 1; i++) pts.push(...slerpPoints(eqj[i], eqj[i + 1], 24, i > 0));
    if (extendLast > 0) {
      const a = eqj[eqj.length - 2];
      const b = eqj[eqj.length - 1];
      const ang = a.angleTo(b);
      const axis = new THREE.Vector3().crossVectors(a, b).normalize();
      for (let k = 1; k <= 12; k++) pts.push(b.clone().applyAxisAngle(axis, (ang * extendLast * k) / 12));
    }
    this.guide(pts);
  }
}

/**
 * How far above the screen centre (as a fraction of the field of view) a
 * target should sit so the lesson card does not cover it.
 */
function liftFraction(): number {
  const card = document.querySelector('.learn-card');
  if (!card || card.classList.contains('minimised')) return 0.05;
  // Aim for the middle of the sky above the card (a little lower on wide screens,
  // where the sky beside the card is visible too).
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  const top = card.getBoundingClientRect().top / window.innerHeight;
  return Math.min(0.3, Math.max(0.1, (0.5 - top / 2) * (mobile ? 1 : 0.8)));
}

function slerpPoints(a: THREE.Vector3, b: THREE.Vector3, n: number, skipFirst: boolean): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const ang = a.angleTo(b);
  const s = Math.sin(ang) || 1;
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const t = i / n;
    out.push(a.clone().multiplyScalar(Math.sin((1 - t) * ang) / s).addScaledVector(b, Math.sin(t * ang) / s).normalize());
  }
  return out;
}

export function findStar(app: App, name: string): SkyObject | null {
  const want = name.toLowerCase();
  for (const m of app.catalogs.stars.meta.values()) if (m.name && m.name.toLowerCase() === want) return { kind: 'star', index: m.index };
  return null;
}

/** J2000 unit vectors of a body's geocentric path, sampled daily. */
export function bodyPathEqj(body: A.Body, start: Date, end: Date, stepDays = 1): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += stepDays * 86400e3) {
    const eq = A.EquatorFromVector(A.GeoVector(body, new Date(t), true));
    out.push(raDecToVec(eq.ra, eq.dec));
  }
  return out;
}
