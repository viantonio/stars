import type { App } from '../app';
import type { Moment } from '../esoteric/moments';
import { h, icon } from './dom';

/** Banner shown while viewing the sky of a saved moment. */
export class MomentBanner {
  private el = h('div', { class: 'moment-banner glass', role: 'status' });

  constructor(private app: App) {}

  show(m: Moment): void {
    const when = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'long',
      ...(m.timeKnown ? { timeStyle: 'short' } : {}),
      timeZone: m.place.timeZone,
    }).format(new Date(m.utc));
    this.el.replaceChildren(
      h('span', { class: 'mb-star', 'aria-hidden': 'true' }, '✦'),
      h('div', { class: 'mb-text' }, h('b', {}, m.kind === 'birth' ? `${m.name} — birth sky` : m.name), h('span', {}, `${when}${m.timeKnown ? '' : ' (time unknown)'} · ${m.place.name}`)),
      h('button', { class: 'btn', onclick: () => this.app.panels.open('asabove') }, icon('sparkles', 15), 'Chart'),
      h('button', { class: 'btn', onclick: () => this.app.exitMoment() }, icon('now', 15), 'Return to now'),
    );
    if (!this.el.isConnected) this.app.root.append(this.el);
  }

  hide(): void {
    this.el.remove();
  }
}
