import * as A from 'astronomy-engine';
import type { App } from '../app';
import type { PanelView } from './panels';
import type { SkyEvent, EventKind } from '../astro/events';
import type { MajorBodyId } from '../astro/solarsystem';
import { raDecToVec } from '../astro/frames';
import { h, fmtTime, fmtRelative } from './dom';

type Filter = 'all' | 'top' | 'moon' | 'planets' | 'eclipses' | 'meteors';

const FILTERS: [Filter, string][] = [
  ['top', 'Don’t miss'],
  ['all', 'All'],
  ['moon', 'Moon'],
  ['planets', 'Planets'],
  ['eclipses', 'Eclipses'],
  ['meteors', 'Meteors'],
];

const KIND_FILTER: Record<EventKind, Filter[]> = {
  'moon-phase': ['moon'],
  'lunar-eclipse': ['eclipses', 'moon'],
  'solar-eclipse': ['eclipses'],
  opposition: ['planets'],
  'solar-conjunction': ['planets'],
  elongation: ['planets'],
  'peak-brightness': ['planets'],
  conjunction: ['planets', 'moon'],
  'planet-parade': ['planets'],
  season: [],
  'meteor-shower': ['meteors'],
};

let lastFilter: Filter = 'top';

function resolveBody(name?: string): A.Body | null {
  if (!name) return null;
  return (Object.values(A.Body) as string[]).includes(name) ? (name as A.Body) : null;
}

/**
 * The best moment near an event to actually look: the target high while the
 * sky is dark, as close as possible to the event itself.
 */
export function bestViewingTime(app: App, e: SkyEvent): Date {
  const site = app.getSite();
  const obs = new A.Observer(site.lat, site.lon, site.elevation);
  const body = resolveBody(e.focus?.body);
  const altOf = (t: Date): number | null => {
    if (body) {
      const eq = A.Equator(body, t, obs, true, true);
      return A.Horizon(t, obs, eq.ra, eq.dec).altitude;
    }
    if (e.focus?.ra != null && e.focus.dec != null) return A.Horizon(t, obs, e.focus.ra, e.focus.dec).altitude;
    return null;
  };
  const sunAlt = (t: Date) => {
    const s = A.Equator(A.Body.Sun, t, obs, true, true);
    return A.Horizon(t, obs, s.ra, s.dec).altitude;
  };
  if (e.kind === 'solar-eclipse') return e.date;
  let best = e.date;
  let bestScore = -Infinity;
  for (let m = -16 * 60; m <= 16 * 60; m += 15) {
    const t = new Date(e.date.getTime() + m * 60e3);
    const sa = sunAlt(t);
    const alt = altOf(t);
    if (alt == null) {
      // No target: prefer the nearest dusk.
      const score = -Math.abs(sa + 10) - Math.abs(m) / 120;
      if (score > bestScore) (bestScore = score), (best = t);
      continue;
    }
    if (alt < 3) continue;
    const dark = sa < -6 ? 1 : sa < 0 ? 0.4 : 0;
    const score = dark * 40 + Math.min(alt, 40) - Math.abs(m) / 90;
    if (score > bestScore) (bestScore = score), (best = t);
  }
  return best;
}

export function goToEvent(app: App, e: SkyEvent): void {
  const t = bestViewingTime(app, e);
  app.time.setTime(t);
  app.time.setRate(e.kind === 'meteor-shower' ? 60 : 1);
  const body = e.focus?.body as MajorBodyId | undefined;
  setTimeout(() => {
    if (body && app.frame?.bodies.has(body)) {
      const fov = e.kind === 'lunar-eclipse' ? 3 : e.kind === 'conjunction' ? 12 : e.kind === 'solar-eclipse' ? 3 : 40;
      app.select({ kind: 'body', id: body }, { fly: true, fov });
    } else if (e.focus?.ra != null && e.focus.dec != null && app.frame) {
      const dir = raDecToVec(e.focus.ra, e.focus.dec).applyMatrix4(app.frame.eqjToWorld).normalize();
      app.view.controls.flyTo(dir, e.kind === 'meteor-shower' ? 95 : 40);
    }
  }, 60);
  app.toasts.show(`${e.title} — ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: app.getSite().timeZone }).format(t)}`, 3800);
  if (window.innerWidth < 760) app.panels.close();
}

export function renderEvents(app: App): PanelView {
  const site = app.getSite();
  const tz = site.timeZone;
  const list = h('div');
  const filters = h('div', { class: 'filters' });
  const now = app.frame?.time ?? new Date();
  let all: SkyEvent[] = [];

  const draw = () => {
    filters.replaceChildren(
      ...FILTERS.map(([id, label]) =>
        h('button', { class: lastFilter === id ? 'active' : '', onclick: () => ((lastFilter = id), draw()) }, label),
      ),
    );
    const upcoming = all.filter((e) => (e.endDate ?? e.date).getTime() > now.getTime() - 86400e3);
    const shown = upcoming.filter((e) => {
      if (lastFilter === 'all') return true;
      if (lastFilter === 'top') return e.importance >= 2 && e.visibleFromSite !== false;
      return KIND_FILTER[e.kind]?.includes(lastFilter);
    });
    let month = '';
    const nodes: HTMLElement[] = [];
    for (const e of shown.slice(0, 200)) {
      const m = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: tz }).format(e.date);
      if (m !== month) {
        month = m;
        nodes.push(h('div', { class: 'month-head' }, m));
      }
      const mon = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: tz }).format(e.date);
      const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: tz }).format(e.date);
      const wd = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: tz }).format(e.date);
      const vis = e.visibleFromSite;
      nodes.push(
        h(
          'div',
          { class: `card clickable event ${vis === false ? 'dim' : ''}`, onclick: () => goToEvent(app, e), title: 'Show me' },
          h('div', { class: 'event-date' }, h('div', { class: 'm' }, mon), h('div', { class: 'd' }, day), h('div', { class: 'w' }, wd)),
          h(
            'div',
            { class: 'event-body' },
            h(
              'div',
              { class: 'event-title' },
              e.title,
              e.importance === 3 ? h('span', { class: 'pill gold' }, 'Don’t miss') : '',
              vis === false ? h('span', { class: 'pill off' }, 'Not visible here') : vis === true && e.importance >= 2 ? h('span', { class: 'pill' }, 'Visible') : '',
            ),
            h('div', { class: 'event-sub' }, `${e.subtitle} · ${fmtTime(e.date, tz)} · ${fmtRelative(e.date, now)}`),
            h('div', { class: 'event-desc' }, e.description),
          ),
        ),
      );
    }
    list.replaceChildren(...(nodes.length ? nodes : [h('p', { class: 'note' }, 'Nothing in this category over the next year.')]));
  };

  list.append(h('p', { class: 'note' }, 'Calculating a year of sky events…'));
  setTimeout(() => {
    all = app.events();
    draw();
  }, 20);
  draw();

  return {
    title: 'Sky events',
    subtitle: `Next 12 months from ${site.name} · tap to see it`,
    header: h('div', { style: 'padding:0 16px 0 18px' }, filters),
    body: list,
  };
}
