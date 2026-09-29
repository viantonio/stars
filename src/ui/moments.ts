import type { App } from '../app';
import type { PanelView } from './panels';
import { searchPlaces, type Moment, type Place } from '../esoteric/moments';
import { skySummary, setConstellationNames } from '../esoteric/skySummary';
import { h, icon } from './dom';

function fmtMoment(m: Moment): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long', ...(m.timeKnown ? { timeStyle: 'short' } : {}), timeZone: m.place.timeZone }).format(new Date(m.utc));
}

/** Physical facts about a moment's sky, phrased plainly. */
function summaryCard(m: Moment): HTMLElement {
  const s = skySummary(new Date(m.utc), m.place.lat, m.place.lon, m.place.elevation);
  const planets = s.planetsUp.length
    ? s.planetsUp.map((p) => `${p.name}${p.visible ? '' : ' (not visible)'} in ${p.constellation}`).join(', ')
    : 'none above the horizon';
  const rows: [string, string][] = [
    ['Sky', `${s.skyState}${m.timeKnown ? '' : ' (assuming noon — time unknown)'}`],
    ['The Sun', `in front of ${s.sunConstellation}${s.sunAltitude > 0 ? `, ${Math.round(s.sunAltitude)}° up` : ', below the horizon'}`],
    ['The Moon', `${s.moonPhase}, ${Math.round(s.moonIllumination * 100)}% lit, in ${s.moonConstellation}${s.moonUp ? ' — up' : ' — below the horizon'}`],
    ['Planets up', planets],
    ['Overhead', s.zenithConstellation],
    ['Rising in the east', s.risingConstellation],
    ['Setting in the west', s.settingConstellation],
  ];
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'section-title', style: 'margin-top:0' }, 'What the sky physically held'),
    h('dl', { class: 'info-rows' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', { style: 'text-align:right' }, v)])),
  );
}

export function renderMoments(app: App): PanelView {
  setConstellationNames(app.catalogs.constellations);
  const body = h('div');
  let editing = false;

  const draw = () => {
    const list = app.moments.all();
    const primary = app.moments.primary();
    body.replaceChildren();
    if (!list.length && !editing) {
      body.append(
        h(
          'div',
          { class: 'card' },
          h('div', { style: 'font-weight:650;font-size:15px' }, 'Begin with your birth'),
          h('p', { class: 'note' }, 'Enter the date, time and place you were born to see the exact sky of that moment — every star, planet and the Moon where they truly were — and your chart in the As Above panel. Add other meaningful moments too.'),
          h('button', { class: 'btn primary', onclick: () => ((editing = true), draw()) }, icon('sparkles', 16), 'Add my birth moment'),
        ),
      );
    }
    if (editing) body.append(form(app, !list.length, () => ((editing = false), draw())));
    for (const m of list) {
      body.append(
        h(
          'div',
          { class: `card ${m.id === primary?.id ? 'is-me' : ''}` },
          h(
            'div',
            { class: 'obj-row' },
            h('div', { class: 'obj-dot', style: `background:${m.kind === 'birth' ? 'var(--gold)' : 'var(--violet)'};color:${m.kind === 'birth' ? 'var(--gold)' : 'var(--violet)'}` }),
            h(
              'div',
              { class: 'obj-main' },
              h('div', { class: 'obj-name' }, m.name, m.id === primary?.id ? h('span', { class: 'pill gold' }, 'You') : ''),
              h('div', { class: 'obj-meta' }, `${fmtMoment(m)} · ${m.place.name}`),
            ),
          ),
          h(
            'div',
            { class: 'btn-row', style: 'margin-top:10px' },
            h('button', { class: 'btn primary', onclick: () => (app.viewMoment(m), window.innerWidth < 760 && app.panels.close()) }, icon('eye', 15), 'View this sky'),
            h('button', { class: 'btn', onclick: () => ((app.asAboveSubject = m.id), app.panels.open('asabove')) }, icon('sparkles', 15), 'Chart'),
            m.id !== primary?.id ? h('button', { class: 'btn', onclick: () => app.moments.update(m.id, { primary: true }), title: 'Use as your own chart for personal notes' }, 'Set as me') : '',
            h('button', { class: 'btn', 'aria-label': `Delete ${m.name}`, onclick: () => confirm(`Delete “${m.name}”?`) && app.moments.remove(m.id) }, icon('close', 15)),
          ),
        ),
      );
    }
    if (primary) body.append(h('div', { class: 'section-title' }, primary.kind === 'birth' ? 'Your birth sky' : primary.name), summaryCard(primary));
    if (list.length && !editing)
      body.append(h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: () => ((editing = true), draw()) }, icon('sparkles', 15), 'Add a moment')));
    body.append(h('p', { class: 'note' }, 'Moments are stored only on this device. Birth times on certificates are usually rounded — even a few minutes shift the rising sign and houses, but not the planets.'));
  };
  const off = app.moments.onChange(draw);
  draw();
  return { title: 'Moments', subtitle: 'Births and turning points — the sky as it was', body, dispose: off };
}

function form(app: App, first: boolean, done: () => void): HTMLElement {
  let place: Place | null = null;
  const name = h('input', { class: 'field-input', placeholder: first ? 'Your name' : 'Name of this moment', value: first ? 'Me' : '' }) as HTMLInputElement;
  const kind = h('select', { class: 'field-input' }, h('option', { value: 'birth' }, 'Birth'), h('option', { value: 'moment' }, 'Other moment')) as HTMLSelectElement;
  const date = h('input', { class: 'field-input', type: 'date', min: '1800-01-01', max: '2200-12-31' }) as HTMLInputElement;
  const time = h('input', { class: 'field-input', type: 'time', value: '12:00' }) as HTMLInputElement;
  const unknown = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const primary = h('input', { type: 'checkbox', checked: first }) as HTMLInputElement;
  const q = h('input', { class: 'field-input', placeholder: 'City or town, e.g. Mariposa', autocomplete: 'off' }) as HTMLInputElement;
  const results = h('div', { class: 'place-results' });
  const chosen = h('div', { class: 'muted small' }, 'No place chosen yet');
  unknown.addEventListener('change', () => (time.disabled = unknown.checked));

  let ctrl: AbortController | null = null;
  let timer = 0;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const found = await searchPlaces(q.value, ctrl.signal);
        results.replaceChildren(
          ...found.map((p) =>
            h(
              'button',
              {
                class: 'result',
                type: 'button',
                onclick: () => {
                  place = p;
                  chosen.textContent = `${p.name}, ${p.region} · ${p.lat.toFixed(3)}°, ${p.lon.toFixed(3)}° · ${p.timeZone}`;
                  results.replaceChildren();
                  q.value = p.name;
                },
              },
              h('span', { class: 'name' }, p.name),
              h('span', { class: 'extra' }, p.region),
            ),
          ),
        );
        if (!found.length) results.replaceChildren(h('p', { class: 'note' }, 'No matches.'));
      } catch (e) {
        if ((e as Error).name !== 'AbortError') results.replaceChildren(h('p', { class: 'note' }, 'Place search needs an internet connection.'));
      }
    }, 300);
  });

  const save = () => {
    if (!date.value) return app.toasts.show('Please enter a date');
    if (!place) return app.toasts.show('Please search for and choose a place');
    const m = app.moments.add({
      name: name.value.trim() || 'Untitled moment',
      kind: kind.value as Moment['kind'],
      localDate: date.value,
      localTime: time.value || '12:00',
      timeKnown: !unknown.checked,
      place,
      primary: primary.checked,
      note: '',
    });
    if (!m) return app.toasts.show('That date could not be converted — please check it');
    app.toasts.show(`Saved “${m.name}”`);
    done();
  };

  return h(
    'div',
    { class: 'card moment-form' },
    h('div', { class: 'field' }, h('label', {}, 'Name'), name),
    h('div', { class: 'field' }, h('label', {}, 'Kind'), kind),
    h('div', { class: 'field two' }, h('div', {}, h('label', {}, 'Local date'), date), h('div', {}, h('label', {}, 'Local time'), time)),
    h('label', { class: 'check' }, unknown, 'I don’t know the time'),
    h('div', { class: 'field' }, h('label', {}, 'Place'), q, results, chosen),
    h('label', { class: 'check' }, primary, 'This is me — use for personal readings'),
    h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', onclick: save }, 'Save moment'), h('button', { class: 'btn', onclick: done }, 'Cancel')),
  );
}
