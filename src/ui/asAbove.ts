import type { App } from '../app';
import type { PanelView } from './panels';
import type { Chart, PointId } from '../esoteric/types';
import type { Moment } from '../esoteric/moments';
import { computeChart, eclipticConstellations, formatLongitude, planetaryHour, transitsToChart } from '../esoteric/astrology';
import {
  SIGNS, POINT_INFO, HEBREW_LETTERS, SEPHIROTH, DAAT, ASPECT_INFO, EMERALD_TABLET,
  moonPhaseMeaning, planetInfo, planetLetter, activePaths, letterForPath, gematria,
} from '../esoteric/correspondences';
import { HOUSE_THEMES, PLANET_TRANSIT_THEMES } from '../esoteric/interpretations';
import { computeAstroEvents, personalNote, type AstroEvent } from '../esoteric/astroEvents';
import { downloadText } from '../esoteric/moments';
import { ayanamsaValue } from '../esoteric/ayanamsa';
import { chartWheel, ELEMENT_COLORS } from './chartWheel';
import { h, icon, fmtRelative } from './dom';
import '../styles/asabove.css';

type Tab = 'chart' | 'notes' | 'journal' | 'tree' | 'letters';
let lastTab: Tab = 'chart';

interface Subject {
  label: string;
  date: Date;
  lat: number;
  lon: number;
  timeZone: string;
  place: string;
  timeKnown: boolean;
  moment: Moment | null;
}

function subjectOf(app: App): Subject {
  const m = app.asAboveSubject !== 'now' ? app.moments.get(app.asAboveSubject) : undefined;
  if (m)
    return { label: m.name, date: new Date(m.utc), lat: m.place.lat, lon: m.place.lon, timeZone: m.place.timeZone, place: m.place.name, timeKnown: m.timeKnown, moment: m };
  const site = app.getSite();
  return { label: 'The sky now', date: app.frame?.time ?? new Date(), lat: site.lat, lon: site.lon, timeZone: site.timeZone, place: site.name, timeKnown: true, moment: null };
}

function chartFor(app: App, s: { date: Date; lat: number; lon: number }): Chart {
  const st = app.settings.get();
  return computeChart({ date: s.date, lat: s.lat, lon: s.lon, zodiac: st.zodiac, ayanamsa: st.ayanamsa, houseSystem: st.houseSystem });
}

const conName = (app: App, id?: string) => (id ? app.catalogs.constellations.find((c) => c.id === id)?.name ?? id : '');
const glyph = (id: PointId) => POINT_INFO[id].glyph;

function traditionNote(): HTMLElement {
  return h(
    'div',
    { class: 'tradition-note' },
    icon('info', 15),
    h('span', {}, 'Positions are exact astronomy. Meanings are what astrologers and Hermetic tradition hold — symbolic readings, not measured effects. Keep a journal and judge them by your own experience.'),
  );
}

// ------------------------------------------------------------------ Chart tab

function chartTab(app: App, subject: Subject, chart: Chart, rerender: () => void): HTMLElement {
  const wrap = h('div');
  const detail = h('div');
  const showPoint = (id: PointId) => {
    const p = chart.points.find((x) => x.id === id);
    if (!p) return;
    const info = planetInfo(id);
    const sign = SIGNS[p.sign];
    const house = HOUSE_THEMES[p.house - 1];
    const letter = planetLetter(id, app.settings.get().letterTradition);
    const seph = info?.sephira ? SEPHIROTH[info.sephira - 1] : null;
    detail.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'obj-name' }, h('span', { class: 'big-glyph' }, glyph(id)), `${POINT_INFO[id].name} in ${sign.name}`, p.retrograde ? h('span', { class: 'pill warn' }, 'Retrograde') : ''),
        h('p', { class: 'note' }, info?.theme ?? ''),
        h('p', { class: 'note' }, `${sign.glyph} ${sign.theme} (${sign.element}, ${sign.modality.toLowerCase()}; keywords: ${sign.keywords.join(', ')}).`),
        house ? h('p', { class: 'note' }, `House ${p.house} — ${house.name}. ${house.line}`) : '',
        seph || letter
          ? h('p', { class: 'note' }, `On the Tree: ${seph ? `the sphere of ${seph.translit} (${seph.english})` : ''}${seph && letter ? '; ' : ''}${letter ? `the letter ${letter.name} ${letter.glyph} (“${letter.meaning}”, ${letter.value})` : ''}.`)
          : '',
        p.constellation ? h('p', { class: 'note' }, `In the real sky ${POINT_INFO[id].name} stood in front of the constellation ${conName(app, p.constellation)}.`) : '',
      ),
    );
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const size = Math.min(360, (app.root.clientWidth || 400) - 60);
  const cons = eclipticConstellations(subject.date);
  const names = Object.fromEntries(app.catalogs.constellations.map((c) => [c.id, c.name]));
  const wheel = chartWheel(chart, { size, constellations: cons, names, onPick: showPoint });

  const get = (id: PointId) => chart.points.find((p) => p.id === id)!;
  const sun = get('Sun');
  const big3: [string, PointId, string][] = [
    ['Sun', 'Sun', 'Your core self and vital purpose'],
    ['Moon', 'Moon', 'Your inner life, needs and instincts'],
    ['Rising', 'Ascendant', 'How you meet the world'],
  ];
  const sunCon = conName(app, sun.constellation);
  const sameSign = SIGNS[sun.sign].constellation.name === sunCon;

  wrap.append(
    traditionNote(),
    h('div', { class: 'wheel-wrap' }, wheel),
    h('div', { class: 'wheel-legend muted small' }, 'Outer ring: the twelve signs · violet ring: the constellations the ecliptic really crosses · inner: houses and aspects. Tap a planet.'),
    h(
      'div',
      { class: 'big-three' },
      ...big3.map(([label, id, what]) => {
        const p = get(id);
        const s = SIGNS[p.sign];
        const unreliable = id === 'Ascendant' && !subject.timeKnown;
        return h(
          'div',
          { class: 'card clickable b3', onclick: () => id !== 'Ascendant' && showPoint(id) },
          h('div', { class: 'b3-label' }, label),
          h('div', { class: 'b3-sign', style: `color:${ELEMENT_COLORS[p.sign % 4]}` }, s.glyph),
          h('div', { class: 'b3-name' }, s.name),
          h('div', { class: 'muted small' }, unreliable ? 'needs a birth time' : what),
        );
      }),
    ),
    h(
      'p',
      { class: 'note' },
      `The Sun was at ${formatLongitude(sun.longitude)} in the ${app.settings.get().zodiac} zodiac, and physically in front of the constellation ${sunCon}. `,
      sameSign
        ? 'Here sign and constellation agree.'
        : `The sign and the constellation differ because Earth's axis has precessed about ${ayanamsaValue(subject.date).toFixed(0)}° since the zodiac was fixed some two thousand years ago — the tropical signs follow the seasons, the constellations follow the stars.`,
    ),
    !subject.timeKnown ? h('p', { class: 'note warn-note' }, 'Birth time unknown: the rising sign, Midheaven and houses are not meaningful; planetary signs are (except perhaps the Moon, which moves ~13° a day).') : '',
    chart.housesFallback ? h('p', { class: 'note warn-note' }, 'Placidus houses are undefined this close to the pole; Porphyry houses are shown.') : '',
    h('div', { class: 'section-title' }, 'Placements'),
    h(
      'div',
      { class: 'placements' },
      ...chart.points
        .filter((p) => p.id !== 'SouthNode' && p.id !== 'Midheaven')
        .map((p) =>
          h(
            'button',
            { class: 'placement', onclick: () => showPoint(p.id) },
            h('span', { class: 'pl-glyph' }, glyph(p.id)),
            h('span', { class: 'pl-name' }, POINT_INFO[p.id].name, p.retrograde ? h('sup', { class: 'retro' }, 'R') : ''),
            h('span', { class: 'pl-pos tabnum' }, formatLongitude(p.longitude)),
            h('span', { class: 'pl-house muted' }, p.id === 'Ascendant' ? '' : `H${p.house}`),
            h('span', { class: 'pl-sky muted' }, p.constellation ? `sky: ${conName(app, p.constellation)}` : ''),
          ),
        ),
    ),
    detail,
    h('div', { class: 'section-title' }, 'Aspects'),
    h(
      'div',
      { class: 'aspects' },
      ...chart.aspects
        .slice()
        .sort((a, b) => a.orb - b.orb)
        .slice(0, 18)
        .map((a) => {
          const info = ASPECT_INFO[a.type];
          return h(
            'div',
            { class: `aspect ${info.nature}`, title: info.meaning },
            h('span', {}, glyph(a.a)),
            h('span', { class: 'asp-glyph' }, info.glyph),
            h('span', {}, glyph(a.b)),
            h('span', { class: 'asp-text' }, `${POINT_INFO[a.a].name} ${a.type} ${POINT_INFO[a.b].name}`),
            h('span', { class: 'muted small tabnum' }, `${a.orb.toFixed(1)}°${a.applying ? ' applying' : ''}`),
          );
        }),
    ),
    h('p', { class: 'note' }, 'Harmonious aspects (trine, sextile) are drawn blue and green, challenging ones (square, opposition) red. Traditionally a tight orb matters more.'),
    moonPhaseCard(chart),
  );
  if (!subject.moment) {
    const ph = planetaryHour(subject.date, subject.lat, subject.lon);
    if (ph) {
      wrap.append(
        h('div', { class: 'section-title' }, 'Planetary hour'),
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'obj-name' }, h('span', { class: 'big-glyph' }, glyph(ph.ruler)), `Hour of ${ph.ruler}`, h('span', { class: 'pill gold' }, `Day of ${ph.dayRuler}`)),
          h('p', { class: 'note' }, `${ph.isDay ? 'Day' : 'Night'} hour ${ph.index} of 12, until ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone: subject.timeZone }).format(ph.end)}. The traditional unequal hours divide daylight and darkness into twelve parts each, ruled in the Chaldean order — Saturn, Jupiter, Mars, Sun, Venus, Mercury, Moon — the order that also names our weekdays.`),
        ),
      );
    }
  }
  void rerender;
  return wrap;
}

function moonPhaseCard(chart: Chart): HTMLElement {
  const m = moonPhaseMeaning(chart.moonPhase);
  return h('div', {}, h('div', { class: 'section-title' }, 'Lunar phase'), h('div', { class: 'card' }, h('div', { class: 'obj-name' }, m.name), h('p', { class: 'note' }, m.meaning)));
}

// ------------------------------------------------------------------ Sky notes tab

const eventCache = new Map<string, AstroEvent[]>();

function eventsAround(app: App, center: Date): AstroEvent[] {
  const st = app.settings.get();
  const month = Math.floor(center.getTime() / (30 * 86400e3));
  const key = `${st.zodiac}:${st.ayanamsa}:${month}`;
  let ev = eventCache.get(key);
  if (!ev) {
    const start = new Date(month * 30 * 86400e3 - 45 * 86400e3);
    const end = new Date(month * 30 * 86400e3 + 150 * 86400e3);
    ev = computeAstroEvents(start, end, { zodiac: st.zodiac, ayanamsa: st.ayanamsa, timeZone: app.getSite().timeZone });
    eventCache.set(key, ev);
  }
  return ev;
}

function journalBox(app: App, skyDate: Date, event?: AstroEvent): HTMLElement {
  const box = h('div', { class: 'journal-box' });
  const draw = (open: boolean) => {
    const entries = event ? app.journal.forEvent(event.id) : [];
    const list = entries.map((e) =>
      h(
        'div',
        { class: 'journal-entry' },
        h('div', { class: 'je-text' }, e.text),
        h('div', { class: 'muted small' }, `Written ${new Date(e.written).toLocaleDateString(undefined, { dateStyle: 'medium' })}`, ' · ', h('button', { class: 'link', onclick: () => confirm('Delete this note?') && (app.journal.remove(e.id), draw(false)) }, 'delete')),
      ),
    );
    if (!open) {
      box.replaceChildren(...list, h('button', { class: 'btn small-btn', onclick: () => draw(true) }, icon('sparkles', 14), entries.length ? 'Add another note' : 'Write what you notice'));
      return;
    }
    const ta = h('textarea', { class: 'field-input', placeholder: 'What happened for you around this time? How did it feel? Note it now, and look back later.', rows: 3 }) as HTMLTextAreaElement;
    box.replaceChildren(
      ...list,
      ta,
      h(
        'div',
        { class: 'btn-row', style: 'margin-top:8px' },
        h('button', {
          class: 'btn primary small-btn',
          onclick: () => {
            if (!ta.value.trim()) return;
            app.journal.add({ skyDate: skyDate.toISOString(), eventId: event?.id, eventTitle: event?.title, text: ta.value.trim() });
            app.toasts.show('Saved to your sky journal');
            draw(false);
          },
        }, 'Save note'),
        h('button', { class: 'btn small-btn', onclick: () => draw(false) }, 'Cancel'),
      ),
    );
    ta.focus();
  };
  draw(false);
  return box;
}

function notesTab(app: App, subject: Subject): HTMLElement {
  const wrap = h('div');
  const now = app.frame?.time ?? new Date();
  const st = app.settings.get();
  const me = app.moments.primary();
  const natal = me ? chartFor(app, { date: new Date(me.utc), lat: me.place.lat, lon: me.place.lon }) : null;
  const tz = app.getSite().timeZone;
  void subject;

  // Where everything is now.
  const current = computeChart({ date: now, lat: app.getSite().lat, lon: app.getSite().lon, zodiac: st.zodiac, ayanamsa: st.ayanamsa, houseSystem: st.houseSystem });
  wrap.append(
    traditionNote(),
    h('div', { class: 'section-title' }, `The planets now (${st.zodiac})`),
    h(
      'div',
      { class: 'placements' },
      ...current.points
        .filter((p) => !['Ascendant', 'Midheaven', 'SouthNode'].includes(p.id))
        .map((p) => {
          const natalHouse = natal ? houseIn(natal, p.longitude) : 0;
          return h(
            'div',
            { class: 'placement' },
            h('span', { class: 'pl-glyph' }, glyph(p.id)),
            h('span', { class: 'pl-name' }, POINT_INFO[p.id].name, p.retrograde ? h('sup', { class: 'retro' }, 'R') : ''),
            h('span', { class: 'pl-pos tabnum' }, formatLongitude(p.longitude)),
            h('span', { class: 'pl-house muted' }, natal ? `your H${natalHouse}` : ''),
            h('span', { class: 'pl-sky muted' }, PLANET_TRANSIT_THEMES[p.id]?.typicalStay ? `~${PLANET_TRANSIT_THEMES[p.id]!.typicalStay} per sign` : ''),
          );
        }),
    ),
  );

  if (natal) {
    const transits = transitsToChart(natal, now).sort((a, b) => a.orb - b.orb).slice(0, 8);
    if (transits.length)
      wrap.append(
        h('div', { class: 'section-title' }, 'Touching your chart now'),
        ...transits.map((t) =>
          h(
            'div',
            { class: `aspect ${ASPECT_INFO[t.type].nature}` },
            h('span', {}, glyph(t.a)),
            h('span', { class: 'asp-glyph' }, ASPECT_INFO[t.type].glyph),
            h('span', {}, glyph(t.b)),
            h('span', { class: 'asp-text' }, `${POINT_INFO[t.a].name} ${t.type} your ${POINT_INFO[t.b].name}`),
            h('span', { class: 'muted small tabnum' }, `${t.orb.toFixed(1)}°`),
          ),
        ),
      );
  } else {
    wrap.append(h('div', { class: 'card', style: 'margin-top:12px' }, h('p', { class: 'note', style: 'margin:0' }, 'Add your birth moment (Moments panel) and mark it as you to see which part of your chart each event touches.'), h('button', { class: 'btn small-btn', style: 'margin-top:8px', onclick: () => app.panels.open('moments') }, 'Add my birth moment')));
  }

  // Events: recent and coming.
  const events = eventsAround(app, now).filter((e) => e.date.getTime() > now.getTime() - 30 * 86400e3);
  const past = events.filter((e) => e.date < now).reverse().slice(0, 6);
  const coming = events.filter((e) => e.date >= now).slice(0, 30);
  const card = (e: AstroEvent) => {
    const pn = natal ? personalNote(e, natal) : null;
    const when = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(e.date);
    return h(
      'div',
      { class: 'card sky-note' },
      h('div', { class: 'sn-head' }, h('span', { class: 'big-glyph' }, glyph(e.body)), h('div', {}, h('div', { class: 'obj-name' }, e.title), h('div', { class: 'muted small' }, `${when} · ${fmtRelative(e.date, now)}${e.duration ? ` · ${e.duration}` : ''}`))),
      h('p', { class: 'note' }, h('b', {}, 'For the world: '), e.world),
      pn ? h('p', { class: 'note' }, h('b', {}, 'For you: '), pn.text) : '',
      h('div', { class: 'btn-row' }, h('button', { class: 'btn small-btn', onclick: () => (app.time.setTime(e.date), app.time.setRate(0), app.select({ kind: 'body', id: e.body as never }, { fly: true, fov: 40 })) }, icon('eye', 14), 'See this sky')),
      journalBox(app, e.date, e),
    );
  };
  if (coming.length) wrap.append(h('div', { class: 'section-title' }, 'Coming up'), ...coming.map(card));
  if (past.length) wrap.append(h('div', { class: 'section-title' }, 'Recent — how did it go?'), ...past.map(card));
  return wrap;
}

function houseIn(chart: Chart, lon: number): number {
  for (let i = 0; i < 12; i++) {
    const a = chart.cusps[i];
    const b = chart.cusps[(i + 1) % 12];
    const span = (b - a + 360) % 360;
    if ((lon - a + 360) % 360 < span) return i + 1;
  }
  return 1;
}

// ------------------------------------------------------------------ Journal tab

function journalTab(app: App): HTMLElement {
  const wrap = h('div');
  const tz = app.getSite().timeZone;
  const draw = () => {
    const entries = [...app.journal.all()].sort((a, b) => b.skyDate.localeCompare(a.skyDate));
    wrap.replaceChildren(
      h('p', { class: 'note' }, 'Your sky journal: notes you have written against events and moments. Looking back over months is how you learn which readings ring true for you.'),
      h('div', { class: 'card' }, h('div', { class: 'section-title', style: 'margin-top:0' }, 'A note for this moment'), journalBox(app, app.frame?.time ?? new Date())),
      ...(entries.length
        ? entries.map((e) =>
            h(
              'div',
              { class: 'card' },
              h('div', { class: 'muted small' }, new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(e.skyDate)), e.eventTitle ? ` · ${e.eventTitle}` : ''),
              h('div', { class: 'je-text' }, e.text),
              h('div', { class: 'btn-row', style: 'margin-top:6px' },
                h('button', { class: 'btn small-btn', onclick: () => (app.time.setTime(new Date(e.skyDate)), app.time.setRate(0)) }, icon('eye', 14), 'See that sky'),
                h('button', { class: 'btn small-btn', onclick: () => confirm('Delete this note?') && app.journal.remove(e.id) }, 'Delete')),
            ),
          )
        : [h('p', { class: 'note' }, 'No notes yet.')]),
      h(
        'div',
        { class: 'btn-row', style: 'margin-top:14px' },
        h('button', { class: 'btn small-btn', onclick: () => downloadText('sky-journal.md', app.journal.toMarkdown(tz), 'text/markdown') }, 'Export as text'),
        h('button', { class: 'btn small-btn', onclick: () => downloadText('stars-backup.json', JSON.stringify({ moments: app.moments.all(), journal: app.journal.all() }, null, 2), 'application/json') }, 'Back up moments & journal'),
        h('label', { class: 'btn small-btn' }, 'Restore backup', h('input', {
          type: 'file', accept: 'application/json', style: 'display:none',
          onchange: async (ev: Event) => {
            const f = (ev.target as HTMLInputElement).files?.[0];
            if (!f) return;
            try {
              const j = JSON.parse(await f.text());
              if (Array.isArray(j.moments)) app.moments.replaceAll(j.moments);
              if (Array.isArray(j.journal)) app.journal.replaceAll(j.journal);
              app.toasts.show('Backup restored');
            } catch {
              app.toasts.show('That file could not be read');
            }
          },
        })),
      ),
    );
  };
  const off = app.journal.onChange(draw);
  draw();
  (wrap as unknown as { dispose: () => void }).dispose = off;
  return wrap;
}

// ------------------------------------------------------------------ Tree of Life tab

const NS = 'http://www.w3.org/2000/svg';
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

function treeTab(app: App, chart: Chart): HTMLElement {
  const tradition = app.settings.get().letterTradition;
  const active = activePaths(chart, tradition);
  const info = h('div');
  const W = 300;
  const H = 520;
  const pos = (x: number, y: number) => [W / 2 + x * 105, 34 + y * (H - 68)] as const;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'tree-svg', role: 'img', 'aria-label': 'Tree of Life' });

  const showSephira = (n: number) => {
    const s = SEPHIROTH[n - 1];
    const why = active.reasons.filter((r) => r.kind === 'sephira' && r.target === n);
    info.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'obj-name' }, `${n}. ${s.translit}`, h('span', { class: 'hebrew' }, s.hebrew)), h('div', { class: 'muted small' }, `${s.english} · ${s.sphere}`), h('p', { class: 'note' }, s.meaning), ...why.map((r) => h('p', { class: 'note lit-note' }, `✦ ${r.note}`))));
  };
  const showPath = (n: number) => {
    const l = letterForPath(n);
    if (!l) return;
    const why = active.reasons.filter((r) => r.kind !== 'sephira' && r.target === n);
    const from = SEPHIROTH[l.connects[0] - 1];
    const to = SEPHIROTH[l.connects[1] - 1];
    const attrib = l.attribution.kind === 'sign' ? `the sign ${SIGNS.find((x) => x.name === l.attribution.id)?.name ?? l.attribution.id}` : l.attribution.kind === 'planet' ? `the planet ${l.attribution.id}` : `the element ${l.attribution.id}`;
    info.replaceChildren(
      h('div', { class: 'card' }, h('div', { class: 'obj-name' }, `Path ${n}: ${l.name}`, h('span', { class: 'hebrew' }, l.glyph)), h('div', { class: 'muted small' }, `“${l.meaning}” · value ${l.value} · ${l.class} letter · ${attrib}`), h('p', { class: 'note' }, `Joins ${from.translit} (${from.english}) and ${to.translit} (${to.english}).`), ...why.map((r) => h('p', { class: 'note lit-note' }, `✦ ${r.note}`))),
    );
  };

  for (const l of HEBREW_LETTERS) {
    const a = SEPHIROTH[l.connects[0] - 1];
    const b = SEPHIROTH[l.connects[1] - 1];
    const [x1, y1] = pos(a.x, a.y);
    const [x2, y2] = pos(b.x, b.y);
    const lit = active.paths.includes(l.path);
    const g = svgEl('g', { class: `tree-path ${lit ? 'lit' : ''}`, tabindex: 0, role: 'button', 'aria-label': `Path ${l.path}, ${l.name}` });
    g.append(svgEl('line', { x1, y1, x2, y2, class: 'tp-hit' }), svgEl('line', { x1, y1, x2, y2, class: 'tp-line' }));
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    g.append(svgEl('circle', { cx: mx, cy: my, r: 8.5, class: 'tp-badge' }), svgEl('text', { x: mx, y: my + 0.5, class: 'tp-letter', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, l.glyph));
    g.addEventListener('click', () => showPath(l.path));
    g.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && showPath(l.path));
    svg.append(g);
  }
  const [dx, dy] = pos(DAAT.x, DAAT.y);
  svg.append(svgEl('circle', { cx: dx, cy: dy, r: 17, class: 'daat' }));
  for (const s of SEPHIROTH) {
    const [x, y] = pos(s.x, s.y);
    const lit = active.sephiroth.includes(s.number);
    const g = svgEl('g', { class: `sephira ${lit ? 'lit' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${s.translit}, ${s.english}` });
    g.append(svgEl('circle', { cx: x, cy: y, r: 22 }), svgEl('text', { x, y: y - 3, 'text-anchor': 'middle', class: 'seph-num' }, String(s.number)), svgEl('text', { x, y: y + 9, 'text-anchor': 'middle', class: 'seph-name' }, s.translit));
    g.addEventListener('click', () => showSephira(s.number));
    g.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && showSephira(s.number));
    svg.append(g);
  }

  return h(
    'div',
    {},
    traditionNote(),
    h('p', { class: 'note' }, 'The Tree of Life of Hermetic Qabalah: ten spheres joined by twenty-two paths, one for each Hebrew letter. Gold shows what this chart lights — each classical planet its sphere and its letter, each placement the letter of its sign. Tap any sphere or path.'),
    h('div', { class: 'field' }, h('label', {}, 'Letter attribution'), segmented(app, [['golden-dawn', 'Golden Dawn'], ['sefer-yetzirah', 'Sefer Yetzirah (Gra)']], tradition, (v) => app.settings.set({ letterTradition: v as never }))),
    h('div', { class: 'tree-wrap' }, svg),
    info,
    h('div', { class: 'section-title' }, 'The Emerald Tablet'),
    h('blockquote', { class: 'emerald' }, ...EMERALD_TABLET.map((l) => h('p', {}, l)), h('cite', {}, '— tr. Isaac Newton')),
  );
}

// ------------------------------------------------------------------ Letters tab

function lettersTab(app: App, chart: Chart): HTMLElement {
  const tradition = app.settings.get().letterTradition;
  const get = (id: PointId) => chart.points.find((p) => p.id === id)!;
  const sig = (['Sun', 'Moon', 'Ascendant'] as PointId[]).map((id) => {
    const s = SIGNS[get(id).sign];
    return { id, sign: s, letter: HEBREW_LETTERS.find((l) => l.glyph === s.letter)! };
  });
  const word = sig.map((x) => x.letter.glyph).join('');
  const lit = new Set(activePaths(chart, tradition).paths);
  return h(
    'div',
    {},
    traditionNote(),
    h('p', { class: 'note' }, 'In the Sefer Yetzirah the twenty-two letters are the building blocks of creation: three mothers (the elements), seven doubles (the planets) and twelve simples (the signs).'),
    h('div', { class: 'section-title' }, 'The letters of this chart'),
    h(
      'div',
      { class: 'card signature' },
      h('div', { class: 'sig-word hebrew', dir: 'rtl' }, word),
      h('div', { class: 'sig-parts' }, ...sig.map((x) => h('div', {}, h('span', { class: 'hebrew' }, x.letter.glyph), ` ${x.letter.name} — ${x.id === 'Ascendant' ? 'Rising' : x.id} in ${x.sign.name} · “${x.letter.meaning}”`))),
      h('div', { class: 'muted small' }, `Sun, Moon and rising sign letters · gematria ${gematria(word)}`),
    ),
    h('div', { class: 'section-title' }, 'The twenty-two letters'),
    h(
      'div',
      { class: 'letters-grid' },
      ...HEBREW_LETTERS.map((l) => {
        const planet = l.attribution.kind === 'planet' ? (tradition === 'sefer-yetzirah' ? l.syPlanet : l.attribution.id) : null;
        const attrib = l.attribution.kind === 'sign' ? l.attribution.id : l.attribution.kind === 'planet' ? planet : l.attribution.id;
        return h(
          'div',
          { class: `letter-card ${lit.has(l.path) ? 'lit' : ''}`, title: `${l.name}: ${l.meaning}` },
          h('div', { class: 'lc-glyph hebrew' }, l.glyph),
          h('div', { class: 'lc-name' }, l.name),
          h('div', { class: 'muted small' }, `${l.meaning} · ${l.value}`),
          h('div', { class: 'lc-attr' }, String(attrib ?? '')),
        );
      }),
    ),
  );
}

// ------------------------------------------------------------------ shared bits

function segmented(app: App, options: [string, string][], value: string, onChange: (v: string) => void): HTMLElement {
  void app;
  return h('div', { class: 'seg' }, ...options.map(([v, label]) => h('button', { class: v === value ? 'active' : '', 'aria-pressed': String(v === value), onclick: () => onChange(v) }, label)));
}

// ------------------------------------------------------------------ panel

export function renderAsAbove(app: App): PanelView {
  const body = h('div');
  const tabs = h('div', { class: 'panel-tabs as-tabs', role: 'tablist' });
  const controls = h('div', { class: 'as-controls' });
  let disposeTab: (() => void) | null = null;

  const render = () => {
    disposeTab?.();
    disposeTab = null;
    const st = app.settings.get();
    const subject = subjectOf(app);
    const TABS: [Tab, string][] = [['chart', 'Chart'], ['notes', 'Sky notes'], ['journal', 'Journal'], ['tree', 'Tree of Life'], ['letters', 'Letters']];
    tabs.replaceChildren(...TABS.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(id === lastTab), class: id === lastTab ? 'active' : '', onclick: () => ((lastTab = id), render()) }, label)));

    const select = h(
      'select',
      { class: 'field-input', 'aria-label': 'Whose chart' },
      h('option', { value: 'now', selected: app.asAboveSubject === 'now' }, `The sky now — ${app.getSite().name}`),
      ...app.moments.all().map((m) => h('option', { value: m.id, selected: app.asAboveSubject === m.id }, `${m.name}${m.primary ? ' (you)' : ''}`)),
    ) as HTMLSelectElement;
    select.addEventListener('change', () => ((app.asAboveSubject = select.value), render()));
    controls.replaceChildren(
      lastTab === 'journal' || lastTab === 'notes' ? '' : select,
      h(
        'div',
        { class: 'as-opts' },
        segmented(app, [['tropical', 'Tropical'], ['sidereal', 'Sidereal']], st.zodiac, (v) => (app.settings.set({ zodiac: v as never }), render())),
        lastTab === 'chart' ? segmented(app, [['placidus', 'Placidus'], ['whole-sign', 'Whole sign'], ['equal', 'Equal']], st.houseSystem, (v) => (app.settings.set({ houseSystem: v as never }), render())) : '',
      ),
    );

    let content: HTMLElement;
    const chart = chartFor(app, subject);
    switch (lastTab) {
      case 'chart':
        content = chartTab(app, subject, chart, render);
        break;
      case 'notes':
        content = notesTab(app, subject);
        break;
      case 'journal':
        content = journalTab(app);
        disposeTab = (content as unknown as { dispose: () => void }).dispose;
        break;
      case 'tree':
        content = treeTab(app, chart);
        break;
      case 'letters':
        content = lettersTab(app, chart);
        break;
    }
    const when = subject.moment
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long', ...(subject.timeKnown ? { timeStyle: 'short' } : {}), timeZone: subject.timeZone }).format(subject.date)
      : 'Live — follows the time controls';
    body.replaceChildren(h('div', { class: 'muted small', style: 'margin:2px 0 8px' }, `${subject.label} · ${when} · ${subject.place}`), content);
  };

  const offSettings = app.settings.onChange((_s, changed) => {
    if (changed.some((k) => k === 'letterTradition')) render();
  });
  render();
  return {
    title: 'As Above',
    subtitle: 'So below — tradition, read from the real sky',
    header: h('div', {}, tabs, h('div', { style: 'padding:0 16px 8px 18px' }, controls)),
    body,
    dispose: () => (offSettings(), disposeTab?.()),
  };
}
