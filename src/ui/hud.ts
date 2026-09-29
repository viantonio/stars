import type { App } from '../app';
import type { FrameInfo } from '../render/skyview';
import { h, icon, compass16, fmtDate } from './dom';

function skyStateLabel(sunAlt: number): { text: string; cls: string } {
  if (sunAlt > 0) return { text: 'Daytime', cls: 'gold' };
  if (sunAlt > -6) return { text: 'Civil twilight', cls: 'warn' };
  if (sunAlt > -12) return { text: 'Nautical twilight', cls: 'blue' };
  if (sunAlt > -18) return { text: 'Astronomical twilight', cls: 'blue' };
  return { text: 'Dark night', cls: 'good' };
}

/** Top-left clock & location card, bottom-left view readout and zoom buttons. */
export class Hud {
  private timeEl = h('div', { class: 'clock-time tabnum' });
  private dateEl = h('div', { class: 'clock-date' });
  private locEl = h('div', { class: 'clock-location' });
  private statusEl = h('div', { class: 'clock-status' });
  private readout = h('div', { class: 'readout tabnum' });
  private needle: SVGElement;

  constructor(private app: App) {
    const card = h(
      'div',
      { class: 'clock-card glass', title: 'Change location', onclick: () => app.panels.open('location') },
      this.locEl,
      this.timeEl,
      this.dateEl,
      this.statusEl,
    );
    const hud = h('div', { class: 'hud' }, h('div', { class: 'brand' }, h('div', { class: 'brand-mark' }), 'STARS OBSERVATORY'), card);
    this.needle = icon('compass', 14);
    this.needle.classList.add('compass-needle');
    const zoom = h(
      'div',
      { class: 'zoom-buttons glass' },
      h('button', { title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => app.view.controls.zoomBy(0.6) }, icon('zoomIn', 19)),
      h('button', { title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => app.view.controls.zoomBy(1 / 0.6) }, icon('zoomOut', 19)),
    );
    app.root.append(hud, this.readout, zoom);
    app.onFrame((f) => this.update(f));
  }

  private update(f: FrameInfo): void {
    const tz = f.site.timeZone;
    const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: tz }).formatToParts(f.time);
    const main = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
    const period = parts.find((p) => p.type === 'dayPeriod')?.value;
    this.timeEl.replaceChildren(main, period ? h('span', { class: 'ampm' }, period) : '');
    const tzName = new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'short' }).formatToParts(f.time).find((p) => p.type === 'timeZoneName')?.value ?? '';
    this.dateEl.textContent = `${fmtDate(f.time, tz, { weekday: 'long', month: 'long' })} · ${tzName}`;
    this.locEl.replaceChildren(icon('pin', 14), f.site.name, h('small', {}, f.site.region));

    const sky = skyStateLabel(f.sunAlt);
    const moon = f.bodies.get('Moon')!;
    const chips: HTMLElement[] = [];
    if (this.app.time.isLive) chips.push(h('span', { class: 'chip live' }, 'Live'));
    chips.push(h('span', { class: `chip ${sky.cls}` }, sky.text));
    chips.push(h('span', { class: 'chip' }, `Moon ${Math.round(moon.phase * 100)}% ${f.moonAlt > 0 ? '↑' : '↓'}`));
    const s = this.app.settings.get();
    chips.push(h('span', { class: 'chip', title: 'Naked-eye limiting magnitude at the zenith' }, `Limit mag ${f.sky.limitingMag.toFixed(1)}`));
    if (s.perfectSky) chips.push(h('span', { class: 'chip gold' }, 'Perfect sky'));
    this.statusEl.replaceChildren(...chips);

    const showChips = s.showHud;
    this.statusEl.style.display = showChips ? '' : 'none';
    this.readout.style.display = showChips ? '' : 'none';
    const v = f.view;
    this.needle.style.transform = `rotate(${-v.az + 45}deg)`;
    const fovText = v.fov >= 10 ? `${v.fov.toFixed(0)}°` : v.fov >= 1 ? `${v.fov.toFixed(1)}°` : `${(v.fov * 60).toFixed(0)}′`;
    const mag = Math.max(1, 60 / v.fov);
    this.readout.replaceChildren(
      h('span', { class: 'chip' }, this.needle, `${compass16(v.az)} ${v.az.toFixed(0)}°`),
      h('span', { class: 'chip' }, `Alt ${v.alt.toFixed(0)}°`),
      h('span', { class: 'chip' }, `FOV ${fovText}${mag >= 2 ? ` · ${mag.toFixed(0)}×` : ''}`),
      h('span', { class: 'chip', title: 'Faintest stars currently drawn' }, `Stars to mag ${f.limitingMag.toFixed(1)}`),
    );
  }
}
