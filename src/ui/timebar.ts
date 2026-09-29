import * as A from 'astronomy-engine';
import type { App } from '../app';
import { describeRate } from '../core/time';
import { h, icon } from './dom';
import { fromLocal, localParts } from '../core/zones';

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
  private lastStripDraw = 0;
  private unitSelect: HTMLSelectElement;
  private jog = h('div', { class: 'jog', role: 'slider', tabindex: '0', 'aria-label': 'Spin time: drag left for the past, right for the future', 'aria-valuetext': 'stopped' });
  private jogKnob = h('div', { class: 'jog-knob' });
  private jogLabel = h('div', { class: 'jog-label' }, h('span', {}, '◀ past'), h('span', {}, 'drag to spin time'), h('span', {}, 'future ▶'));
  private jogRestoreRate = 0;
  private jogging = false;
  private datePop: HTMLElement;
  private dateBtn: HTMLButtonElement;

  constructor(private app: App) {
    const t = app.time;
    this.playBtn = h('button', { class: 'tb-btn primary', 'aria-label': 'Play / pause', title: 'Play / pause (Space)', onclick: () => t.togglePause() });
    this.nowBtn = h('button', { class: 'tb-btn now', title: 'Jump to now (N)', onclick: () => app.goNow() }, icon('now', 18), 'Now');
    this.unitSelect = h(
      'select',
      { class: 'tb-unit', 'aria-label': 'Step size', title: 'Step size for the ◀ ▶ buttons' },
      ...STEP_UNITS.map((u) => h('option', { value: u.id, selected: u.id === app.settings.get().stepUnit }, u.label)),
    ) as HTMLSelectElement;
    this.unitSelect.addEventListener('change', () => app.settings.set({ stepUnit: this.unitSelect.value }));
    // Date & time live in a small pop-up so the bar never overflows.
    this.datePop = h(
      'div',
      { class: 'tb-datepop glass', role: 'dialog', 'aria-label': 'Go to a date and time' },
      h('label', {}, 'Date', this.dateInput),
      h('label', {}, 'Time', this.timeInput),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary small-btn', onclick: () => (this.applyInputs(), this.toggleDatePop(false)) }, 'Go'), h('button', { class: 'btn small-btn', onclick: () => this.toggleDatePop(false) }, 'Close')),
    );
    this.dateBtn = h('button', { class: 'tb-btn', title: 'Go to a date and time', 'aria-label': 'Go to a date and time', 'aria-expanded': 'false', onclick: () => this.toggleDatePop() }, icon('calendar', 18));
    const bar = h(
      'div',
      { class: 'timebar glass' },
      h(
        'div',
        { class: 'timebar-row' },
        h('button', { class: 'tb-btn', title: 'Step back ( , )', 'aria-label': 'Step back', onclick: () => this.step(-1) }, icon('stepBack', 18)),
        this.unitSelect,
        h('button', { class: 'tb-btn', title: 'Step forward ( . )', 'aria-label': 'Step forward', onclick: () => this.step(1) }, icon('stepForward', 18)),
        h('div', { class: 'tb-sep' }),
        h('button', { class: 'tb-btn tb-speed', title: 'Slower / reverse ([)', 'aria-label': 'Slower', onclick: () => t.stepRate(-1) }, icon('back', 18)),
        this.playBtn,
        h('button', { class: 'tb-btn tb-speed', title: 'Faster (])', 'aria-label': 'Faster', onclick: () => t.stepRate(1) }, icon('forward', 18)),
        this.rateEl,
        h('div', { class: 'tb-spacer' }),
        this.dateBtn,
        this.nowBtn,
      ),
      this.jog,
      this.strip,
      this.datePop,
    );
    this.strip.append(this.stripCanvas, this.marker);
    this.jog.append(h('div', { class: 'jog-ticks' }), this.jogLabel, this.jogKnob);
    this.installJog();
    // Scroll over the time bar to nudge time by the step unit.
    bar.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    app.root.append(bar);

    for (const input of [this.dateInput, this.timeInput])
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') (this.applyInputs(), this.toggleDatePop(false));
      });

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

  private localParts(d: Date): { date: string; time: string } {
    return localParts(d, this.tz());
  }

  private fromLocal(date: string, time: string): Date | null {
    return fromLocal(date, time, this.tz());
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
    const f = Math.min(0.9999, Math.max(0, (clientX - r.left) / r.width));
    this.app.time.setTime(this.stripStart + f * 86400e3);
  }

  /** Open or close the date/time pop-up. */
  toggleDatePop(open = !this.datePop.classList.contains('open')): void {
    this.datePop.classList.toggle('open', open);
    this.dateBtn.setAttribute('aria-expanded', String(open));
    this.dateBtn.classList.toggle('active', open);
    if (open) {
      const p = this.localParts(this.app.time.now());
      this.dateInput.value = p.date;
      this.timeInput.value = p.time;
      this.dateInput.focus();
    }
  }

  get datePopOpen(): boolean {
    return this.datePop.classList.contains('open');
  }

  /** Jump by the selected step (calendar-aware for months and years). */
  step(dir: 1 | -1): void {
    const unit = STEP_UNITS.find((u) => u.id === this.app.settings.get().stepUnit) ?? STEP_UNITS[1];
    const t = this.app.time;
    if (unit.months) {
      const d = t.now();
      d.setUTCMonth(d.getUTCMonth() + dir * unit.months);
      t.setTime(d);
    } else t.shift(dir * unit.ms);
  }

  /**
   * The jog dial: while held, time runs at a speed set by how far the knob is
   * pulled from centre (1 min/s near the middle up to ~1 year/s at the ends);
   * on release the clock pauses on the moment you found.
   */
  private installJog(): void {
    const t = this.app.time;
    const setFrom = (clientX: number) => {
      const r = this.jog.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((clientX - r.left) / r.width) * 2 - 1));
      this.jogKnob.style.left = `${(x * 0.5 + 0.5) * 100}%`;
      const mag = Math.abs(x) < 0.04 ? 0 : 60 * Math.pow(10, ((Math.abs(x) - 0.04) / 0.96) * 5.7);
      const rate = Math.sign(x) * Math.round(mag);
      t.setRate(rate);
      this.jog.setAttribute('aria-valuetext', describeRate(rate));
    };
    const release = () => {
      if (!this.jogging) return;
      this.jogging = false;
      this.jog.classList.remove('active');
      this.jogKnob.style.left = '50%';
      t.setRate(this.jogRestoreRate === 1 ? 0 : this.jogRestoreRate);
      this.jog.setAttribute('aria-valuetext', 'stopped');
    };
    this.jog.addEventListener('pointerdown', (e) => {
      this.jogging = true;
      this.jogRestoreRate = t.rate;
      this.jog.classList.add('active');
      this.jog.setPointerCapture(e.pointerId);
      setFrom(e.clientX);
    });
    this.jog.addEventListener('pointermove', (e) => this.jogging && setFrom(e.clientX));
    this.jog.addEventListener('pointerup', release);
    this.jog.addEventListener('pointercancel', release);
    this.jog.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        this.step(e.key === 'ArrowLeft' ? -1 : 1);
      }
    });
  }

  private update(): void {
    const t = this.app.time;
    this.playBtn.replaceChildren(icon(t.paused ? 'play' : 'pause', 18));
    this.rateEl.textContent = describeRate(t.rate);
    this.nowBtn.classList.toggle('live', t.isLive);
    const now = t.now();
    if (!this.datePopOpen) {
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
    // Hold the strip still while scrubbing, and redraw at most once a second
    // when time is racing by days per second.
    const racing = Math.abs(this.app.time.rate) >= 86400 && performance.now() - this.lastStripDraw < 1000;
    if (key !== this.stripKey && !this.scrubbing && !racing) {
      this.lastStripDraw = performance.now();
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
      // Sample every 10 minutes and interpolate per pixel.
      const obs = new A.Observer(site.lat, site.lon, site.elevation);
      const N = 144;
      const sunAlt = new Float32Array(N + 1);
      const moonAlt = new Float32Array(N + 1);
      for (let i = 0; i <= N; i++) {
        const tm = new Date(start + (i / N) * 86400e3);
        const s = A.Equator(A.Body.Sun, tm, obs, true, true);
        sunAlt[i] = A.Horizon(tm, obs, s.ra, s.dec).altitude;
        const m = A.Equator(A.Body.Moon, tm, obs, true, true);
        moonAlt[i] = A.Horizon(tm, obs, m.ra, m.dec).altitude;
      }
      const lerp = (arr: Float32Array, f: number) => {
        const i = Math.min(N - 1, Math.floor(f * N));
        const t = f * N - i;
        return arr[i] + (arr[i + 1] - arr[i]) * t;
      };
      for (let x = 0; x < W; x++) {
        const alt = lerp(sunAlt, x / W);
        ctx.fillStyle = skyColor(alt);
        ctx.fillRect(x, 0, 1, H);
        if (lerp(moonAlt, x / W) > 0 && alt < -6) {
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

export interface StepUnit {
  id: string;
  label: string;
  ms: number;
  months?: number;
}

/** Step sizes. A sidereal day brings the stars back to the same place, so only the Sun, Moon and planets move. */
export const STEP_UNITS: StepUnit[] = [
  { id: 'minute', label: '1 minute', ms: 60e3 },
  { id: 'hour', label: '1 hour', ms: 3600e3 },
  { id: 'day', label: '1 day', ms: 86400e3 },
  { id: 'sidereal', label: '1 sidereal day', ms: 86164.0905e3 },
  { id: 'week', label: '1 week', ms: 7 * 86400e3 },
  { id: 'lunar', label: '1 lunar month', ms: 29.530589 * 86400e3 },
  { id: 'month', label: '1 month', ms: 0, months: 1 },
  { id: 'year', label: '1 year', ms: 0, months: 12 },
  { id: 'decade', label: '10 years', ms: 0, months: 120 },
  { id: 'century', label: '100 years', ms: 0, months: 1200 },
];

function skyColor(alt: number): string {
  if (alt > 6) return '#3f7fc6';
  if (alt > 0) return '#c98a4a';
  if (alt > -6) return '#6b4a7a';
  if (alt > -12) return '#2d2f5e';
  if (alt > -18) return '#161a38';
  return '#070913';
}
