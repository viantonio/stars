import type { App } from '../app';
import type { PanelView } from './panels';
import type { Settings } from '../core/settings';
import { PRESET_LOCATIONS } from '../core/locations';
import { bortleToZenithMag, limitingMagnitude } from '../astro/skyBrightness';
import { h, icon, type ICONS } from './dom';

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

/** Switches that stay in sync with settings changed elsewhere (e.g. keyboard shortcuts). */
function toggles(app: App, items: [BoolKey, string, keyof typeof ICONS | null, string?][]): HTMLElement {
  const buttons = items.map(([key, label, ic, kbd]) => {
    const b = h('button', { class: 'toggle', onclick: () => app.settings.toggle(key), title: kbd ? `Shortcut: ${kbd}` : undefined }, ic ? icon(ic, 16) : '', label, h('span', { class: 'sw' }));
    return { key, b };
  });
  const sync = () => {
    const s = app.settings.get();
    for (const { key, b } of buttons) {
      b.classList.toggle('on', !!s[key]);
      b.setAttribute('aria-pressed', String(!!s[key]));
    }
  };
  sync();
  const grid = h('div', { class: 'toggle-grid' }, ...buttons.map((x) => x.b));
  // Stay subscribed only while the panel is on screen.
  const off = app.settings.onChange(() => (grid.isConnected ? sync() : off()));
  return grid;
}

function slider(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, onInput: (v: number) => void): HTMLElement {
  const out = h('span', {}, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    out.textContent = fmt(v);
    onInput(v);
  });
  return h('div', { class: 'field' }, h('label', {}, label, out), input);
}

function segmented<T extends string | number>(options: [T, string][], value: T, onChange: (v: T) => void): HTMLElement {
  const buttons = options.map(([val, label]) => h('button', { onclick: () => (onChange(val), mark(val)) }, label));
  const mark = (v: T) => buttons.forEach((b, i) => {
    b.classList.toggle('active', options[i][0] === v);
    b.setAttribute('aria-pressed', String(options[i][0] === v));
  });
  mark(value);
  return h('div', { class: 'seg' }, ...buttons);
}

export function renderLayers(app: App): PanelView {
  const body = h(
    'div',
    {},
    h('div', { class: 'section-title' }, 'Constellations'),
    toggles(app, [
      ['constellationLines', 'Figures', 'star', 'C'],
      ['constellationNames', 'Names', null, 'V'],
      ['constellationBounds', 'Boundaries', null, 'B'],
      ['starNames', 'Star names', null, 'L'],
    ]),
    h('div', { class: 'section-title' }, 'Solar system & beyond'),
    toggles(app, [
      ['planetLabels', 'Planet labels', 'orbit'],
      ['deepSky', 'Deep sky', 'sparkles'],
      ['comets', 'Comets', 'comet'],
      ['asteroids', 'Asteroids', null],
      ['satellites', 'Satellites', 'satellite'],
      ['meteors', 'Meteors', 'meteor'],
      ['trails', 'Motion trails', 'orbit', 'X'],
    ]),
    h('p', { class: 'note' }, 'Motion trails draw the paths of the Sun, Moon and planets against the stars as you move time. Step by sidereal days or spin the time dial to watch a planet loop backwards during retrograde.'),
    h('div', { class: 'section-title' }, 'Sky & scenery'),
    toggles(app, [
      ['milkyWay', 'Milky Way', null, 'M'],
      ['atmosphere', 'Atmosphere', 'atmosphere', 'H'],
      ['showSun', 'The Sun', 'sun'],
      ['ground', 'Landscape', null, 'G'],
      ['cardinals', 'Compass points', 'compass'],
      ['perfectSky', 'Perfect sky', 'sparkles', 'P'],
      ['twinkle', 'Twinkling', null],
    ]),
    h('p', { class: 'note' }, '“Perfect sky” removes light pollution and haze so you can see what your sky would look like with no city lights at all. By day, turn off “Atmosphere” to reveal the stars and planets that are always there behind the sunlight.'),
    h('div', { class: 'section-title' }, 'As Above (tradition)'),
    toggles(app, [
      ['zodiacBand', 'Zodiac band', 'hexagram'],
      ['planetaryHour', 'Planetary hour', null],
    ]),
    h('p', { class: 'note' }, 'The zodiac band marks the twelve astrological signs along the Sun’s path. Compare them with the constellation figures beneath: in the tropical zodiac the signs have drifted about 24° from the stars they were named after. Choose tropical or sidereal in the As Above panel.'),
    h('div', { class: 'section-title' }, 'Guides'),
    toggles(app, [
      ['gridAltAz', 'Alt-az grid', null, 'Z'],
      ['gridEquatorial', 'Equatorial grid', null, 'E'],
      ['ecliptic', 'Ecliptic', null, 'K'],
      ['meridian', 'Meridian', null],
    ]),
  );
  return { title: 'Sky layers', subtitle: 'What to draw on the sky', body };
}

export function renderSettings(app: App): PanelView {
  const s = app.settings.get();
  const site = app.getSite();
  const bortle = s.bortleOverride ?? site.bortle;
  const body = h(
    'div',
    {},
    h('div', { class: 'section-title' }, 'Visibility'),
    slider('Light pollution (Bortle class)', 1, 9, 1, bortle, (v) => `${v}${s.bortleOverride == null && v === site.bortle ? ' · site default' : ''} · limit ${limitingMagnitude(bortleToZenithMag(v)).toFixed(1)}`, (v) =>
      app.settings.set({ bortleOverride: v === site.bortle ? null : v }),
    ),
    slider('Extra faint stars', 0, 3, 0.25, s.starBoost, (v) => (v === 0 ? 'Realistic' : `+${v.toFixed(2)} mag`), (v) => app.settings.set({ starBoost: v })),
    slider('Star size', 0.6, 1.8, 0.05, s.starSize, (v) => `${Math.round(v * 100)}%`, (v) => app.settings.set({ starSize: v })),
    h('div', { class: 'field' }, h('label', {}, 'Moon & planet size'), segmented<number>([[1, 'True size'], [2, '2×'], [4, '4×']], s.bodyScale, (v) => app.settings.set({ bodyScale: v }))),
    h('div', { class: 'section-title' }, 'Realism'),
    toggles(app, [
      ['refraction', 'Refraction', null],
      ['labelFaint', 'Label faint objects', null],
      ['nightVision', 'Red light', 'eye', 'R'],
      ['showHud', 'Show info chips', null],
    ]),
    h('p', { class: 'note' }, 'Refraction lifts objects near the horizon by up to half a degree — the reason the Sun is still visible when it has geometrically set. Red light turns the whole screen red. Take your phone outside at night and your eyes stay dark-adapted (red light barely affects night vision), so you can still see the faint stars when you look up. For the pure starfield on screen, use Stargaze (the eye button, Q).'),
    h('div', { class: 'section-title' }, 'Data'),
    h('p', { class: 'note' }, 'Star positions: HYG v4.1 (Hipparcos, Yale BSC, Gliese). Planets & Moon: Astronomy Engine (VSOP87 / ELP). Comets: Minor Planet Center. Satellites: CelesTrak. Milky Way: NASA/GSFC Deep Star Maps 2020. Textures: NASA LRO, Solar System Scope (CC BY 4.0). Fresh comet orbits and satellite elements are downloaded automatically when online.'),
    h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: () => (app.settings.reset(), app.panels.open('settings'), app.toasts.show('Settings reset')) }, 'Reset all settings')),
  );
  return { title: 'Settings', body };
}

const BORTLE_COLORS = ['#0b1230', '#10204a', '#1b3a6b', '#2f6b4f', '#8a8a2e', '#a8702a', '#b8552a', '#c23a3a', '#e8e8e8'];

export function renderLocation(app: App): PanelView {
  const body = h('div');
  const draw = () => {
    const current = app.getSite();
    const s = app.settings.get();
    const cards = PRESET_LOCATIONS.map((l) =>
      h(
        'div',
        { class: `card clickable location-card ${current.id === l.id ? 'active' : ''}`, onclick: () => (app.setLocation(l.id), draw()) },
        h('div', { class: 'bortle', style: `background:${BORTLE_COLORS[l.bortle - 1]};color:${l.bortle >= 9 ? '#222' : '#fff'}`, title: `Bortle class ${l.bortle}` }, String(l.bortle)),
        h(
          'div',
          { style: 'flex:1' },
          h('div', { class: 'obj-name' }, l.name, current.id === l.id ? h('span', { class: 'pill gold' }, 'Current') : ''),
          h('div', { class: 'obj-meta' }, `${l.region} · ${l.elevation.toLocaleString()} m`),
          h('div', { class: 'muted small', style: 'margin-top:6px;line-height:1.5' }, l.blurb),
        ),
      ),
    );
    const lat = h('input', { type: 'number', step: '0.0001', placeholder: 'Latitude', value: s.custom?.lat ?? '', style: 'flex:1;min-width:0' }) as HTMLInputElement;
    const lon = h('input', { type: 'number', step: '0.0001', placeholder: 'Longitude', value: s.custom?.lon ?? '', style: 'flex:1;min-width:0' }) as HTMLInputElement;
    for (const i of [lat, lon]) i.className = 'btn';
    body.replaceChildren(
      h('div', { class: 'section-title' }, 'Your observing sites'),
      ...cards,
      h('div', { class: 'section-title' }, 'Somewhere else'),
      h(
        'div',
        { class: `card ${current.id === 'custom' ? 'location-card active' : ''}` },
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => locate() }, icon('locate', 16), 'Use my GPS location')),
        h('div', { class: 'btn-row', style: 'margin-top:10px' }, lat, lon, h('button', {
          class: 'btn',
          onclick: () => {
            const la = parseFloat(lat.value);
            const lo = parseFloat(lon.value);
            if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
              app.setLocation('custom', { lat: la, lon: lo, elevation: 0, name: 'Custom site' });
              draw();
            } else app.toasts.show('Enter a latitude (−90…90) and longitude (−180…180)');
          },
        }, 'Go')),
        current.id === 'custom' ? h('p', { class: 'note' }, `${current.name}: ${current.region}. Light pollution defaults to Bortle 5 — adjust it in Settings.`) : '',
      ),
      h('p', { class: 'note' }, 'The sky is computed for the exact latitude, longitude and elevation of the site, including its light pollution and the shape of its horizon.'),
    );
  };
  const locate = () => {
    if (!navigator.geolocation) return app.toasts.show('Geolocation is not available on this device');
    app.toasts.show('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        app.setLocation('custom', { lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), elevation: Math.max(0, p.coords.altitude ?? 0), name: 'My location', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        draw();
      },
      () => app.toasts.show('Could not get your location'),
      { enableHighAccuracy: false, timeout: 15000 },
    );
  };
  draw();
  return { title: 'Location', subtitle: 'Where are you observing from?', body };
}
