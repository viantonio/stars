import * as A from 'astronomy-engine';
import type { App } from '../app';
import { describeRate } from '../core/time';
import { h, icon } from './dom';

/**
 * Bottom time controls: speed stepping, pause, "now", a date/time picker and
 * a 24-hour day strip showing daylight, twilight and night that can be
 * dragged to scrub through time.
 */
export class TimeBar {
  private rateEl = h('div', { class: 'tb-rate tabnum' });
  private playBtn: HTMLButtonElement;
  private nowBtn: HTMLButtonElement;
  private dateInput = h('input', { type: 'date', 'aria-label': 'Date' }) as HTMLInputElement;
  private timeInput = h('input', { type: 'time', 'aria-label': 'Time' }) as HTMLInputElement;
  private strip = h('div', { class: 'day-strip', title: 'Drag to scrub through the day' });
  private stripCanvas = h('canvas');
  private marker = h('div', { class: 'marker' });
  private stripKey = '';
  private stripStart = 0;
  private scrubbing = false;

  constructor(private app: App) {
    const t = app.time;
    this.playBtn = h('button', { class: 'tb-btn primary', 'aria-label': 'Play / pause', title: 'Play / pause (Space)', onclick: () => t.togglePause() });
    this.nowBtn = h('button', { class: 'tb-btn now', title: 'Jump to now (N)', onclick: () => t.resetToNow() }, icon('now', 18), 'Now');
    const bar = h(
      'div',
      { class: 'timebar glass' },
      h(
        'div',
        { class: 'timebar-row' },
        h('button', { class: 'tb-btn desktop', title: 'Back one day', onclick: () => t.shift(-86400e3) }, '−1d'),
        h('button', { class: 'tb-btn', title: 'Back one hour', onclick: () => t.shift(-3600e3) }, '−1h'),
        h('button', { class: 'tb-btn', title: 'Slower / reverse ([)', 'aria-label': 'Slower', onclick: () => t.stepRate(-1) }, icon('back', 18)),
        this.playBtn,
        h('button', { class: 'tb-btn', title: 'Faster (])', 'aria-label': 'Faster', onclick: () => t.stepRate(1) }, icon('forward', 18)),
        this.rateEl,
        h('button', { class: 'tb-btn', title: 'Forward one hour', onclick: () => t.shift(3600e3) }, '+1h'),
        h('button', { class: 'tb-btn desktop', title: 'Forward one day', onclick: () => t.shift(86400e3) }, '+1d'),
        h('div', { class: 'tb-spacer' }),
        h('div', { class: 'tb-datetime' }, this.dateInput, this.timeInput),
        this.nowBtn,
      ),
      this.strip,
    );
    this.strip.append(this.stripCanvas, this.marker);
    app.root.append(bar);

    const apply = () => this.applyInputs();
    this.dateInput.addEventListener('change', apply);
    this.timeInput.addEventListener('change', apply);

    this.strip.addEventListener('pointerdown', (e) => {
      this.scrubbing = true;
      this.strip.setPointerCapture(e.pointerId);
      this.scrubTo(e.clientX);
    });
    this.strip.addEventListener('pointermove', (e) => this.scrubbing && this.scrubTo(e.clientX));
    const end = () => (this.scrubbing = false);
    this.strip.addEventListener('pointerup', end);
    this.strip.addEventListener('pointercancel', end);

    app.onFrame(() => this.update());
    t.onChange(() => this.update());
  }

  private tz(): string {
    return this.app.getSite().timeZone;
  }

  /** Local wall-clock parts for the site's time zone. */
  private localParts(d: Date): { date: string; time: string } {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: this.tz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(d)
        .map((x) => [x.type, x.value]),
    );
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  }

  /** Convert a wall-clock time in the site's zone to a UTC instant. */
  private fromLocal(date: string, time: string): Date | null {
    const [y, mo, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    if (!y || !mo || !d || Number.isNaN(hh)) return null;
    let guess = Date.UTC(y, mo - 1, d, hh, mm || 0);
    for (let i = 0; i < 2; i++) {
      const p = this.localParts(new Date(guess));
      const [py, pmo, pd] = p.date.split('-').map(Number);
      const [ph, pm] = p.time.split(':').map(Number);
      const diff = Date.UTC(y, mo - 1, d, hh, mm || 0) - Date.UTC(py, pmo - 1, pd, ph, pm);
      guess += diff;
    }
    return new Date(guess);
  }

  private applyInputs(): void {
    const d = this.fromLocal(this.dateInput.value, this.timeInput.value || '21:00');
    if (d) {
      this.app.time.setTime(d);
      this.app.toasts.show('Time travel engaged — press N to return to now');
    }
  }

  private scrubTo(clientX: number): void {
    const r = this.strip.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    this.app.time.setTime(this.stripStart + f * 86400e3);
  }

  private update(): void {
    const t = this.app.time;
    this.playBtn.replaceChildren(icon(t.paused ? 'play' : 'pause', 18));
    this.rateEl.textContent = describeRate(t.rate);
    this.nowBtn.classList.toggle('live', t.isLive);
    const now = t.now();
    if (document.activeElement !== this.dateInput && document.activeElement !== this.timeInput) {
      const p = this.localParts(now);
      this.dateInput.value = p.date;
      this.timeInput.value = p.time;
    }
    this.drawStrip(now);
  }

  /** The strip spans local noon to noon so the whole night sits in the middle. */
  private drawStrip(now: Date): void {
    const site = this.app.getSite();
    const p = this.localParts(new Date(now.getTime() - 12 * 3600e3));
    const noon = this.fromLocal(p.date, '12:00')!;
    const start = noon.getTime();
    const key = `${site.id}:${site.lat}:${start}:${this.strip.clientWidth}`;
    if (key !== this.stripKey) {
      this.stripKey = key;
      this.stripStart = start;
      const c = this.stripCanvas;
      const W = Math.max(100, this.strip.clientWidth);
      const H = 26;
      const dpr = Math.min(2, window.devicePixelRatio);
      c.width = W * dpr;
      c.height = H * dpr;
      const ctx = c.getContext('2d')!;
      ctx.scale(dpr, dpr);
      const obs = new A.Observer(site.lat, site.lon, site.elevation);
      for (let x = 0; x < W; x++) {
        const tm = new Date(start + (x / W) * 86400e3);
        const eq = A.Equator(A.Body.Sun, tm, obs, true, true);
        const alt = A.Horizon(tm, obs, eq.ra, eq.dec).altitude;
        ctx.fillStyle = skyColor(alt);
        ctx.fillRect(x, 0, 1, H);
        const meq = A.Equator(A.Body.Moon, tm, obs, true, true);
        if (A.Horizon(tm, obs, meq.ra, meq.dec).altitude > 0 && alt < -6) {
          ctx.fillStyle = 'rgba(220,230,255,0.22)';
          ctx.fillRect(x, H - 4, 1, 4);
        }
      }
      // Hour ticks.
      this.strip.querySelectorAll('.tick').forEach((e) => e.remove());
      for (const hh of [15, 18, 21, 0, 3, 6, 9]) {
        const offset = ((hh - 12 + 24) % 24) / 24;
        const label = new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: site.timeZone }).format(new Date(start + offset * 86400e3));
        this.strip.append(h('div', { class: 'tick', style: `left:${offset * 100}%` }, label));
      }
    }
    const frac = (now.getTime() - this.stripStart) / 86400e3;
    this.marker.style.left = `${Math.min(1, Math.max(0, frac)) * 100}%`;
  }
}

function skyColor(alt: number): string {
  if (alt > 6) return '#3f7fc6';
  if (alt > 0) return '#c98a4a';
  if (alt > -6) return '#6b4a7a';
  if (alt > -12) return '#2d2f5e';
  if (alt > -18) return '#161a38';
  return '#070913';
}
