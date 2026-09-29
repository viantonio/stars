import type { App } from '../app';
import type { SkyObject } from '../core/objects';
import { objectKey } from '../core/objects';
import { describe, type ObjectInfo } from '../core/describe';
import { h, icon, fmtTime, compass16 } from './dom';

/** The details card for the selected object, refreshed live. */
export class InfoCard {
  private el = h('aside', { class: 'info glass', 'aria-live': 'polite', 'aria-hidden': 'true' });
  private obj: SkyObject | null = null;
  private lastKey = '';
  private lastRefresh = 0;
  private dirty = false;

  constructor(private app: App) {
    app.root.append(this.el);
    app.onFrame(() => {
      const now = performance.now();
      if (this.obj && (this.dirty || now - this.lastRefresh > 1000)) this.render();
    });
  }

  open(o: SkyObject): void {
    this.obj = o;
    this.lastKey = '';
    this.render();
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    if (window.innerWidth < 760) this.app.panels.close();
  }

  close(deselect = true): void {
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    if (deselect && this.obj) {
      this.obj = null;
      this.app.view.select(null);
      this.app.track(null);
    }
  }

  refreshSoon(): void {
    this.dirty = true;
  }

  onUserMove(): void {
    if (this.obj) this.render();
  }

  private render(): void {
    const o = this.obj;
    if (!o) return;
    this.lastRefresh = performance.now();
    this.dirty = false;
    const info = describe(o, this.app.view, this.app.catalogs);
    if (!info) return;
    const key = objectKey(o);
    const scrollTop = key === this.lastKey ? this.el.querySelector('.info-body')?.scrollTop ?? 0 : 0;
    this.lastKey = key;
    this.el.style.setProperty('--accent', info.accent);
    this.el.style.setProperty('--accent-glow', `${info.accent}33`);
    this.el.replaceChildren(this.head(info), this.body(info), this.actions(info));
    const b = this.el.querySelector('.info-body');
    if (b) b.scrollTop = scrollTop;
  }

  private head(info: ObjectInfo): HTMLElement {
    return h(
      'div',
      { class: 'info-head' },
      h('div', { class: 'info-orb' }),
      h('div', { class: 'info-title' }, h('div', { class: 'info-badge' }, info.badge), h('h3', {}, info.title), h('div', { class: 'sub' }, info.subtitle)),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => this.close() }, icon('close', 18)),
    );
  }

  private body(info: ObjectInfo): HTMLElement {
    const tz = this.app.getSite().timeZone;
    const rows = h('dl', { class: 'info-rows' });
    for (const r of info.rows) rows.append(h('dt', {}, r.label), h('dd', {}, r.value, r.hint ? h('small', {}, r.hint) : ''));
    const passes = info.passes?.length
      ? h(
          'div',
          {},
          h('div', { class: 'section-title' }, 'Upcoming passes'),
          ...info.passes.map((p) => {
            const a = p.visibleStart ?? p.rise;
            const b = p.visibleEnd ?? p.set;
            return h(
              'div',
              { class: 'pass tabnum' },
              h('div', {}, h('b', {}, new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: tz }).format(a.time)), ' ', fmtTime(a.time, tz), h('div', { class: 'muted small' }, `${compass16(a.az)} → ${Math.round(p.maxAlt)}° → ${compass16(b.az)} · ${Math.round(p.durationSec / 60)} min`)),
              h('div', { style: 'text-align:right' }, p.visible ? h('span', { class: 'pill' }, `mag ${p.peakMag.toFixed(1)}`) : h('span', { class: 'pill off' }, 'not visible'), h('div', { class: 'muted small', style: 'margin-top:4px' }, p.visible ? 'sunlit' : 'daylight or shadow')),
            );
          }),
        )
      : '';
    return h(
      'div',
      { class: 'info-body' },
      info.status ? h('div', { class: 'info-status' }, h('span', { class: `chip ${info.status.tone === 'good' ? 'good' : info.status.tone === 'warn' ? 'warn' : ''}` }, info.status.text)) : '',
      info.description ? h('p', { class: 'info-desc' }, info.description) : '',
      rows,
      passes,
    );
  }

  private actions(info: ObjectInfo): HTMLElement {
    const o = this.obj!;
    const tracking = this.app.tracking;
    return h(
      'div',
      { class: 'info-actions' },
      h('button', { class: 'btn', onclick: () => this.app.flyTo(o) }, icon('target', 16), 'Center'),
      h('button', { class: 'btn', onclick: () => this.app.flyTo(o, info.zoomFov) }, icon('zoomIn', 16), 'Zoom'),
      h(
        'button',
        {
          class: `btn ${tracking ? 'on' : ''}`,
          onclick: () => {
            this.app.track(tracking ? null : o);
            if (!tracking) this.app.flyTo(o);
            this.render();
          },
        },
        icon('track', 16),
        tracking ? 'Tracking' : 'Track',
      ),
    );
  }
}
