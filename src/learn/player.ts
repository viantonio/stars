import type { App } from '../app';
import type { Settings } from '../core/settings';
import { h, icon } from '../ui/dom';
import type { Lesson, LessonStep } from './types';
import { LESSONS } from './lessons';
import { LessonContext } from './runtime';
import { glossify, hidePop } from './glossary';
import { progress } from './progress';
import { lessonIcon } from './icons';

const players = new WeakMap<App, LessonPlayer>();

/**
 * Plays a lesson: a floating card with the step text, and the step actions
 * driving the real sky. Everything the lesson changes is restored on exit.
 */
export class LessonPlayer {
  static for(app: App): LessonPlayer {
    let p = players.get(app);
    if (!p) players.set(app, (p = new LessonPlayer(app)));
    return p;
  }

  lesson: Lesson | null = null;
  index = 0;
  private ctx: LessonContext | null = null;
  private baseline: Settings | null = null;
  private touched = new Set<keyof Settings>();
  private spotlit: Element[] = [];
  private el: HTMLElement | null = null;
  private refs: {
    kicker: HTMLElement;
    title: HTMLElement;
    text: HTMLElement;
    reflection: HTMLElement;
    dots: HTMLElement;
    back: HTMLButtonElement;
    next: HTMLButtonElement;
    body: HTMLElement;
    min: HTMLButtonElement;
  } | null = null;
  private readonly onPageHide = () => this.restore();
  private readonly onResize = () => this.position();
  private listeners = new Set<() => void>();

  private constructor(private app: App) {}

  get playing(): boolean {
    return !!this.lesson;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(lesson: Lesson, at = 0): void {
    if (this.lesson) this.stop(false);
    const app = this.app;
    if (app.viewingMoment) app.exitMoment();
    this.lesson = lesson;
    this.baseline = { ...app.settings.get() };
    this.touched.clear();
    app.panels.close();
    app.info.close();
    if (app.pointing.active) void app.pointing.toggle();
    this.build();
    document.body.classList.add('learn-playing');
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('resize', this.onResize);
    this.position();
    this.emit();
    void this.go(Math.max(0, Math.min(lesson.steps.length - 1, at)));
    requestAnimationFrame(() => this.refs?.next.focus({ preventScroll: true }));
  }

  /** Leaves the lesson, restoring the sky. */
  stop(completed: boolean): void {
    const lesson = this.lesson;
    if (!lesson) return;
    this.restore();
    this.lesson = null;
    this.el?.remove();
    this.el = null;
    this.refs = null;
    document.body.classList.remove('learn-playing', 'learn-spot');
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('resize', this.onResize);
    if (completed) {
      progress.complete(lesson.id);
      this.app.toasts.show(`Lesson complete: ${lesson.title}`, 3200);
      this.app.panels.open('learn');
    }
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** Puts back everything the lesson changed. */
  private restore(): void {
    const app = this.app;
    this.ctx?.dispose();
    this.ctx = null;
    this.clearSpotlight();
    hidePop();
    if (this.baseline) {
      const want: Partial<Settings> = {};
      for (const k of this.touched) (want as Record<string, unknown>)[k] = this.baseline[k];
      app.settings.set(want);
    }
    this.touched.clear();
    app.view.setSelectionPath(null);
    app.track(null);
    app.view.select(null);
    app.time.resetToNow();
  }

  // ---------------------------------------------------------------- steps

  /** Settings for step i: the lesson's steps applied in order over the saved baseline. */
  private settingsFor(i: number): Partial<Settings> {
    const lesson = this.lesson!;
    const base = this.baseline!;
    const want: Partial<Settings> = {};
    const w = want as Record<string, unknown>;
    for (const k of this.touched) w[k] = base[k];
    let location: string | undefined;
    for (let j = 0; j <= i; j++) {
      const s = lesson.steps[j];
      if (s.settings) Object.assign(want, s.settings);
      if (s.location) location = s.location;
    }
    if (location) {
      want.locationId = location;
      want.custom = base.custom;
    }
    // Only keys that differ from what the user had are "touched"; remember them for restore.
    for (const k of Object.keys(want) as (keyof Settings)[]) if (want[k] !== base[k] || this.touched.has(k)) this.touched.add(k);
    return want;
  }

  async go(i: number): Promise<void> {
    const lesson = this.lesson;
    if (!lesson || !this.refs) return;
    this.ctx?.dispose();
    hidePop();
    this.index = i;
    const step = lesson.steps[i];
    const app = this.app;

    const prevLocation = app.settings.get().locationId;
    app.settings.set(this.settingsFor(i));
    const loc = app.settings.get().locationId;
    if (loc !== prevLocation) app.toasts.show(`Observing from ${app.getSite().name}`);

    this.clearSpotlight();
    if (step.spotlight) {
      this.spotlit = [...document.querySelectorAll(step.spotlight)];
      for (const el of this.spotlit) el.classList.add('learn-spotlight');
    }
    this.position();

    this.renderStep(step, i);
    const ctx = (this.ctx = new LessonContext(app, (patch) => {
      for (const k of Object.keys(patch) as (keyof Settings)[]) this.touched.add(k);
      app.settings.set(patch);
    }));
    ctx.mark(null);
    app.view.setSelectionPath(null);
    app.track(null);
    this.el?.classList.add('busy');
    try {
      await step.action?.(ctx);
    } catch (e) {
      console.warn('Lesson step failed', e);
    }
    if (ctx !== this.ctx || ctx.cancelled) return;
    if (typeof step.text === 'function') {
      await ctx.waitFrame();
      if (ctx !== this.ctx) return;
      this.renderText(step, true);
    }
    this.el?.classList.remove('busy');
    progress.setReached(lesson.id, i);
  }

  next(): void {
    if (!this.lesson) return;
    if (this.index >= this.lesson.steps.length - 1) this.stop(true);
    else void this.go(this.index + 1);
  }

  back(): void {
    if (this.lesson && this.index > 0) void this.go(this.index - 1);
  }

  /** Keeps the card clear of the time bar (desktop) or of spotlit controls (phone). */
  private position(): void {
    const el = this.el;
    if (!el) return;
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    const spot = this.spotlit.length > 0;
    document.body.classList.toggle('learn-spot', spot);
    el.classList.toggle('lifted', mobile && spot);
    const top = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().top ?? window.innerHeight;
    let bottom: number | null = null;
    if (!mobile) bottom = window.innerHeight - top('.timebar') + 12;
    else if (spot) bottom = window.innerHeight - Math.min(top('.timebar'), top('.toolbar')) + 10;
    if (bottom != null && bottom > 0 && bottom < window.innerHeight * 0.6) el.style.setProperty('--learn-bottom', `${Math.round(bottom)}px`);
    else el.style.removeProperty('--learn-bottom');
  }

  private clearSpotlight(): void {
    for (const el of this.spotlit) el.classList.remove('learn-spotlight');
    this.spotlit = [];
  }

  // ---------------------------------------------------------------- UI

  private build(): void {
    this.el?.remove();
    const lesson = this.lesson!;
    const num = LESSONS.indexOf(lesson) + 1;
    const kicker = h('div', { class: 'lc-kicker' });
    const title = h('h3', { class: 'lc-title', tabindex: '-1' });
    const text = h('div', { class: 'lc-text' });
    const reflection = h('aside', { class: 'lc-reflection', 'aria-label': 'Reflection' });
    const dots = h('div', { class: 'lc-dots', role: 'group', 'aria-label': 'Steps' });
    const back = h('button', { class: 'btn lc-back', type: 'button', onclick: () => this.back() }, icon('chevronRight', 16), h('span', {}, 'Back')) as HTMLButtonElement;
    const next = h('button', { class: 'btn primary lc-next', type: 'button', onclick: () => this.next() }) as HTMLButtonElement;
    const min = h('button', { class: 'icon-btn lc-min', type: 'button', 'aria-label': 'Minimise lesson card', 'aria-expanded': 'true', onclick: () => this.toggleMin() }, icon('chevronDown', 18)) as HTMLButtonElement;
    const body = h('div', { class: 'lc-body', 'aria-live': 'polite' }, title, text, reflection);
    this.el = h(
      'section',
      { class: 'learn-card glass', role: 'region', 'aria-label': `Lesson: ${lesson.title}` },
      h(
        'header',
        { class: 'lc-head' },
        h('span', { class: 'lc-icon' }, lessonIcon(lesson.icon, 18)),
        h('div', { class: 'lc-head-text' }, h('div', { class: 'lc-lesson' }, `Lesson ${num} · ${lesson.title}`), kicker),
        h('span', { class: 'lc-spinner', 'aria-hidden': 'true' }),
        min,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Exit lesson', title: 'Exit lesson', onclick: () => this.stop(false) }, icon('close', 18)),
      ),
      body,
      h('footer', { class: 'lc-foot' }, back, dots, next),
    );
    this.refs = { kicker, title, text, reflection, dots, back, next, body, min };
    this.app.root.append(this.el);
  }

  private toggleMin(): void {
    if (!this.el || !this.refs) return;
    const m = this.el.classList.toggle('minimised');
    this.refs.min.setAttribute('aria-expanded', String(!m));
    this.refs.min.setAttribute('aria-label', m ? 'Expand lesson card' : 'Minimise lesson card');
  }

  private renderStep(step: LessonStep, i: number): void {
    const r = this.refs!;
    const n = this.lesson!.steps.length;
    r.kicker.textContent = `Step ${i + 1} of ${n}`;
    r.title.textContent = step.title;
    this.renderText(step, false);
    r.reflection.replaceChildren();
    r.reflection.hidden = !step.reflection;
    if (step.reflection) r.reflection.append(h('div', { class: 'lc-ref-label' }, lessonIcon('star', 12), 'Reflection'), h('p', {}, step.reflection));
    r.dots.replaceChildren(
      ...this.lesson!.steps.map((s, j) =>
        h('button', {
          type: 'button',
          class: `lc-dot${j === i ? ' on' : j < i ? ' done' : ''}`,
          'aria-label': `Step ${j + 1}: ${s.title}`,
          'aria-current': j === i ? 'step' : undefined,
          onclick: () => void this.go(j),
        }),
      ),
    );
    r.back.disabled = i === 0;
    const last = i === n - 1;
    r.next.replaceChildren(h('span', {}, last ? 'Finish' : 'Next'), icon(last ? 'star' : 'chevronRight', 16));
    r.next.setAttribute('aria-label', last ? 'Finish lesson' : 'Next step');
    r.body.scrollTop = 0;
  }

  private renderText(step: LessonStep, ready: boolean): void {
    const r = this.refs;
    if (!r) return;
    const text = step.text;
    if (typeof text === 'function' && !ready) {
      // Computed text waits until the sky has moved to the step's moment.
      r.text.replaceChildren(h('p', { class: 'lc-skel' }), h('p', { class: 'lc-skel' }), h('p', { class: 'lc-skel short' }));
      return;
    }
    const paras = typeof text === 'function' ? safe(() => text(this.app)) : text;
    const seen = new Set<string>();
    r.text.replaceChildren(...paras.map((p) => h('p', {}, glossify(p, seen))));
  }
}

function safe(fn: () => string[]): string[] {
  try {
    return fn();
  } catch (e) {
    console.warn(e);
    return [];
  }
}
