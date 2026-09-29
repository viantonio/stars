import type { App } from '../app';
import { h, icon } from './dom';
import { objectTitle } from '../core/describe';

/**
 * Phone "sky-pointing" mode: the view follows the device's orientation
 * sensors, with an optional live camera background, a centre reticle that
 * names what you're pointing at, and compass fine-tuning.
 */
export class PointingMode {
  active = false;
  private bar: HTMLElement;
  private crosshair = h('div', { class: 'crosshair' });
  private label = h('div', { class: 'pointing-at' });
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private lastPick = 0;

  constructor(private app: App) {
    this.bar = h(
      'div',
      { class: 'ar-bar glass' },
      h('span', { class: 'label' }, 'Pointing mode'),
      h('button', { class: 'tb-btn', title: 'Rotate view left (compass correction)', onclick: () => app.view.controls.adjustCompass(-2) }, '⟲ 2°'),
      h('button', { class: 'tb-btn', title: 'Rotate view right (compass correction)', onclick: () => app.view.controls.adjustCompass(2) }, '2° ⟳'),
      h('button', { class: 'tb-btn', title: 'Camera background', onclick: () => void this.toggleCamera() }, icon('camera', 18)),
      h('button', { class: 'tb-btn', title: 'Exit', onclick: () => void this.toggle() }, icon('close', 18)),
    );
  }

  async toggle(): Promise<void> {
    if (this.active) {
      this.app.view.controls.disableOrientation();
      this.stopCamera();
      this.bar.remove();
      this.crosshair.remove();
      this.label.remove();
      this.active = false;
      this.app.toasts.show('Pointing mode off');
      return;
    }
    const ok = await this.app.view.controls.enableOrientation();
    if (!ok) {
      this.app.toasts.show('Motion sensors are not available — try this on your phone (HTTPS required)', 4200);
      return;
    }
    this.active = true;
    this.app.root.append(this.bar, this.crosshair, this.label);
    this.app.panels.close();
    this.app.toasts.show('Hold your phone up to the sky. Calibrate your compass with a figure-8 if the view drifts.', 5000);
    // If no sensor events arrive, the device has no gyroscope.
    setTimeout(() => {
      if (this.active && !this.app.view.controls.receivingOrientation) {
        void this.toggle();
        this.app.toasts.show('No motion sensor data — this device may not have a gyroscope/compass', 4200);
      }
    }, 2500);
  }

  private async toggleCamera(): Promise<void> {
    if (this.stream) return this.stopCamera();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      this.video = h('video', { class: 'camera-feed', playsinline: true, muted: true, autoplay: true }) as HTMLVideoElement;
      this.video.srcObject = this.stream;
      this.app.root.prepend(this.video);
      this.app.view.renderer.domElement.style.mixBlendMode = 'screen';
    } catch {
      this.app.toasts.show('Camera unavailable');
    }
  }

  private stopCamera(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video?.remove();
    this.video = null;
    this.app.view.renderer.domElement.style.mixBlendMode = '';
  }

  /** Name what's under the reticle a few times per second. */
  update(): void {
    if (!this.active) return;
    const now = performance.now();
    if (now - this.lastPick < 250) return;
    this.lastPick = now;
    const r = this.app.view.renderer.domElement.getBoundingClientRect();
    const o = this.app.view.pick(r.left + r.width / 2, r.top + r.height / 2, 40);
    this.label.textContent = o ? objectTitle(o, this.app.view, this.app.catalogs) : '';
  }
}
