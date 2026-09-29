import * as THREE from 'three';
import { altAzToWorld, worldToAltAz } from '../astro/frames';

export const MIN_FOV = 0.04;
export const MAX_FOV = 110;

/**
 * "Look around" camera controls: drag to pan the sky, wheel / pinch to zoom
 * (toward the pointer), keyboard arrows, inertia, animated fly-to, object
 * tracking, and a device-orientation mode for pointing a phone at the sky.
 */
export class LookControls {
  az = 180;
  alt = 25;
  fov = 70;
  private velAz = 0;
  private velAlt = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPinch = 0;
  private dragging = false;
  private moved = 0;
  private flight: { fromDir: THREE.Vector3; toDir: THREE.Vector3; fromFov: number; toFov: number; t: number; dur: number } | null = null;
  /** When set, the view follows this world direction each frame. */
  trackTarget: (() => THREE.Vector3 | null) | null = null;
  private keys = new Set<string>();
  onClick: ((x: number, y: number) => void) | null = null;
  onUserMove: (() => void) | null = null;

  // Device orientation (sky-pointing) mode.
  private orientationActive = false;
  private deviceQuat = new THREE.Quaternion();
  private smoothedQuat = new THREE.Quaternion();
  private hasOrientation = false;
  private screenAngle = 0;
  private compassOffset = 0;
  private orientationHandler = (e: DeviceOrientationEvent) => this.handleOrientation(e);
  private screenHandler = () => (this.screenAngle = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number);

  constructor(private camera: THREE.PerspectiveCamera, private el: HTMLElement) {
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      // macOS sends no keyup for keys released while Cmd is held.
      if (e.key === 'Meta') this.keys.clear();
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  get orientationMode(): boolean {
    return this.orientationActive;
  }

  /** True once the device has reported at least one orientation reading. */
  get receivingOrientation(): boolean {
    return this.hasOrientation;
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragging = true;
    this.moved = 0;
    this.velAz = this.velAlt = 0;
    this.flight = null;
    if (this.pointers.size === 2) this.lastPinch = this.pinchDistance();
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 2) {
      const d = this.pinchDistance();
      if (this.lastPinch > 0 && d > 0) this.zoomBy(this.lastPinch / d);
      this.lastPinch = d;
      this.moved += 10;
      return;
    }
    if (!this.dragging || this.orientationActive) return;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.moved < 3) return;
    const degPerPx = this.fov / this.el.clientHeight;
    const cosAlt = Math.max(0.15, Math.cos((this.alt * Math.PI) / 180));
    const dAz = (dx * degPerPx) / cosAlt;
    const dAlt = dy * degPerPx;
    this.az -= dAz;
    this.alt = THREE.MathUtils.clamp(this.alt + dAlt, -89.9, 89.9);
    this.velAz = -dAz;
    this.velAlt = dAlt;
    this.trackTarget = null;
    this.onUserMove?.();
  };

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.lastPinch = 0;
    if (this.pointers.size === 0) {
      this.dragging = false;
      if (this.moved < 6 && e.target === this.el) this.onClick?.(e.clientX, e.clientY);
    }
  };

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    // Zoom toward the pointer: keep the sky point under the cursor fixed.
    const before = this.screenToWorld(e.clientX, e.clientY);
    this.zoomBy(factor);
    if (!this.trackTarget && !this.orientationActive && before) {
      this.applyCamera();
      const after = this.screenToWorld(e.clientX, e.clientY);
      if (after) {
        const a = worldToAltAz(before);
        const b = worldToAltAz(after);
        let dAz = a.az - b.az;
        if (dAz > 180) dAz -= 360;
        if (dAz < -180) dAz += 360;
        this.az += dAz;
        this.alt = THREE.MathUtils.clamp(this.alt + (a.alt - b.alt), -89.9, 89.9);
      }
    }
  };

  zoomBy(factor: number): void {
    this.flight = null;
    this.fov = THREE.MathUtils.clamp(this.fov * factor, MIN_FOV, MAX_FOV);
  }

  setFov(fov: number): void {
    this.fov = THREE.MathUtils.clamp(fov, MIN_FOV, MAX_FOV);
  }

  /** Unit world direction under a client pixel. */
  screenToWorld(x: number, y: number): THREE.Vector3 | null {
    const r = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector3(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    return ndc.sub(this.camera.position).normalize();
  }

  lookAt(dir: THREE.Vector3): void {
    const { alt, az } = worldToAltAz(dir);
    this.az = az;
    this.alt = THREE.MathUtils.clamp(alt, -89.9, 89.9);
  }

  /** Smoothly fly to a direction (and optionally a field of view). */
  flyTo(dir: THREE.Vector3, fov?: number, durationMs = 1400): void {
    if (this.orientationActive) return;
    this.flight = {
      fromDir: altAzToWorld(this.alt, this.az),
      toDir: dir.clone().normalize(),
      fromFov: this.fov,
      toFov: fov ?? this.fov,
      t: 0,
      dur: durationMs,
    };
  }

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 100) / 1000;
    // Keyboard.
    const k = this.keys;
    const rate = this.fov * 0.9 * dt;
    if (k.has('ArrowLeft') || k.has('KeyA')) (this.az -= rate / Math.max(0.2, Math.cos((this.alt * Math.PI) / 180))), (this.trackTarget = null);
    if (k.has('ArrowRight') || k.has('KeyD')) (this.az += rate / Math.max(0.2, Math.cos((this.alt * Math.PI) / 180))), (this.trackTarget = null);
    if (k.has('ArrowUp') || k.has('KeyW')) (this.alt = Math.min(89.9, this.alt + rate)), (this.trackTarget = null);
    if (k.has('ArrowDown') || k.has('KeyS')) (this.alt = Math.max(-89.9, this.alt - rate)), (this.trackTarget = null);
    if (k.has('PageUp') || k.has('Equal') || k.has('NumpadAdd')) this.zoomBy(Math.exp(-1.2 * dt));
    if (k.has('PageDown') || k.has('Minus') || k.has('NumpadSubtract')) this.zoomBy(Math.exp(1.2 * dt));

    if (this.flight) {
      const f = this.flight;
      f.t += dtMs;
      const x = Math.min(1, f.t / f.dur);
      const e = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
      const ang = f.fromDir.angleTo(f.toDir);
      const dir = new THREE.Vector3();
      if (ang < 1e-6) dir.copy(f.toDir);
      else {
        const s = Math.sin(ang);
        dir.copy(f.fromDir).multiplyScalar(Math.sin((1 - e) * ang) / s).addScaledVector(f.toDir, Math.sin(e * ang) / s);
      }
      this.lookAt(dir);
      // Zoom out a little mid-flight for long slews, then in.
      const bump = Math.sin(Math.PI * e) * Math.min(1, ang / 1.2) * 0.6;
      this.fov = THREE.MathUtils.clamp(Math.exp(THREE.MathUtils.lerp(Math.log(f.fromFov), Math.log(f.toFov), e)) * (1 + bump), MIN_FOV, MAX_FOV);
      if (x >= 1) this.flight = null;
    } else if (this.trackTarget && !this.orientationActive) {
      const d = this.trackTarget();
      if (d) {
        const cur = altAzToWorld(this.alt, this.az);
        cur.lerp(d, 1 - Math.exp(-dt * 8)).normalize();
        this.lookAt(cur);
      }
    } else if (!this.dragging) {
      // Inertia.
      const damp = Math.exp(-dt * 5.5);
      this.velAz *= damp;
      this.velAlt *= damp;
      if (Math.abs(this.velAz) + Math.abs(this.velAlt) > 1e-4) {
        this.az += this.velAz * dt * 60;
        this.alt = THREE.MathUtils.clamp(this.alt + this.velAlt * dt * 60, -89.9, 89.9);
      }
    }
    this.az = ((this.az % 360) + 360) % 360;
    this.applyCamera(dt);
  }

  private applyCamera(dt = 0): void {
    this.camera.fov = this.fov;
    if (this.orientationActive && this.hasOrientation) {
      const t = dt > 0 ? 1 - Math.exp(-dt * 12) : 1;
      this.smoothedQuat.slerp(this.deviceQuat, t);
      this.camera.quaternion.copy(this.smoothedQuat);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const { alt, az } = worldToAltAz(dir);
      this.alt = alt;
      this.az = az;
    } else {
      const dir = altAzToWorld(this.alt, this.az);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(dir);
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  // ------------------------------------------------------------- sky pointing

  /** Request sensor permission (iOS) and start following the device's attitude. */
  async enableOrientation(): Promise<boolean> {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    this.screenHandler();
    window.addEventListener('orientationchange', this.screenHandler);
    screen.orientation?.addEventListener?.('change', this.screenHandler);
    const absolute = 'ondeviceorientationabsolute' in window;
    window.addEventListener(absolute ? 'deviceorientationabsolute' : 'deviceorientation', this.orientationHandler as EventListener);
    this.orientationActive = true;
    this.hasOrientation = false;
    this.flight = null;
    this.trackTarget = null;
    return true;
  }

  disableOrientation(): void {
    window.removeEventListener('deviceorientationabsolute', this.orientationHandler as EventListener);
    window.removeEventListener('deviceorientation', this.orientationHandler as EventListener);
    window.removeEventListener('orientationchange', this.screenHandler);
    this.orientationActive = false;
  }

  /** Nudge the compass heading (degrees) if the device's magnetometer is off. */
  adjustCompass(deltaDeg: number): void {
    this.compassOffset += deltaDeg;
  }

  private handleOrientation(e: DeviceOrientationEvent): void {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    // iOS reports a true compass heading separately; alpha is relative there.
    const webkitHeading = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
    let alpha = e.alpha;
    if (typeof webkitHeading === 'number' && !Number.isNaN(webkitHeading)) alpha = 360 - webkitHeading;
    alpha += this.compassOffset;
    const toRad = Math.PI / 180;
    // W3C device frame → world (x east, y up, −z north), as in three's former DeviceOrientationControls.
    const euler = new THREE.Euler(e.beta * toRad, alpha * toRad, -e.gamma * toRad, 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(euler);
    q.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))); // camera looks out the back of the device
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -this.screenAngle * toRad));
    this.deviceQuat.copy(q);
    if (!this.hasOrientation) this.smoothedQuat.copy(q);
    this.hasOrientation = true;
  }
}
