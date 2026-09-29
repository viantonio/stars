import type { App } from '../app';
import type { PanelView } from './panels';
import type { SkyObject } from '../core/objects';
import { BODIES } from '../astro/solarsystem';
import { METEOR_SHOWERS } from '../astro/meteors';
import { shortCometName } from '../render/skyview';
import { h, icon } from './dom';

interface Entry {
  name: string;
  keys: string[];
  kind: string;
  extra: string;
  obj: SkyObject;
  rank: number;
  fov: number;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9α-ω]/g, '');

const GREEK_NAMES: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu',
  ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
};

function buildIndex(app: App): Entry[] {
  const out: Entry[] = [];
  for (const b of BODIES) out.push({ name: b.name, keys: [b.name], kind: b.kind === 'star' ? 'Star' : b.kind === 'moon' ? 'Moon' : b.kind === 'dwarf' ? 'Dwarf planet' : 'Planet', extra: '', obj: { kind: 'body', id: b.id }, rank: 0, fov: b.id === 'Sun' || b.id === 'Moon' ? 3 : 1 });
  const gen = new Map(app.catalogs.constellations.map((c) => [c.id, c]));
  for (const c of app.catalogs.constellations)
    out.push({ name: c.name, keys: [c.name, c.id, c.en], kind: 'Constellation', extra: c.en, obj: { kind: 'constellation', id: c.id }, rank: 3, fov: 60 });
  for (const m of app.catalogs.stars.meta.values()) {
    const mag = app.catalogs.stars.data[m.index * 5 + 3];
    if (!m.name && !m.bayer && mag > 5) continue;
    const c = gen.get(m.con);
    const keys: string[] = [];
    if (m.name) keys.push(m.name);
    if (m.bayer && c) {
      const base = m.bayer.replace(/[¹²³⁴⁵⁶⁷⁸⁹]/g, '');
      keys.push(`${m.bayer} ${c.gen}`, `${m.bayer} ${c.id}`, `${GREEK_NAMES[base] ?? base} ${c.gen}`, `${GREEK_NAMES[base] ?? base} ${c.id}`);
    }
    if (m.flamsteed && c) keys.push(`${m.flamsteed} ${c.gen}`, `${m.flamsteed} ${c.id}`);
    if (m.hip) keys.push(`HIP ${m.hip}`);
    if (m.hd) keys.push(`HD ${m.hd}`);
    if (!keys.length) continue;
    out.push({ name: app.view.starName(m.index), keys, kind: 'Star', extra: `mag ${mag.toFixed(1)}${c ? ` · ${c.name}` : ''}`, obj: { kind: 'star', index: m.index }, rank: m.name ? 1 : 4, fov: 10 });
  }
  for (const d of app.catalogs.dso) {
    const keys = [d.id, d.id.replace(' ', ''), d.name, d.desig].filter(Boolean);
    if (d.messier) keys.push(`Messier ${d.id.slice(2)}`);
    out.push({ name: d.messier ? `${d.id.replace(' ', '')}${d.name ? ` ${d.name}` : ''}` : d.name || d.id, keys, kind: 'Deep sky', extra: `${d.typeName}${d.mag != null ? ` · mag ${d.mag}` : ''}`, obj: { kind: 'dso', id: d.id }, rank: d.messier ? 2 : 5, fov: Math.max(1.5, Math.min(30, (d.dim[0] / 60) * 4)) });
  }
  for (const e of app.view.getSmallBodies())
    out.push({ name: e.el.kind === 'comet' ? shortCometName(e.el.name) : e.el.name, keys: [e.el.name], kind: e.el.kind === 'comet' ? 'Comet' : 'Asteroid', extra: `mag ${e.state.mag.toFixed(1)}`, obj: { kind: 'smallbody', id: e.el.id }, rank: 2, fov: 10 });
  for (const s of app.view.satellites.slice(0, 200))
    out.push({ name: s.name, keys: [s.name, s.fullName, String(s.noradId)], kind: 'Satellite', extra: s.featured ? 'Crewed station / observatory' : `NORAD ${s.noradId}`, obj: { kind: 'satellite', noradId: s.noradId }, rank: s.featured ? 1 : 6, fov: 60 });
  for (const m of METEOR_SHOWERS) out.push({ name: m.name, keys: [m.name, m.code], kind: 'Meteors', extra: `ZHR ${m.zhr} · ${m.parent}`, obj: { kind: 'radiant', id: m.id }, rank: 3, fov: 90 });
  return out;
}

function score(e: Entry, q: string): number {
  let best = Infinity;
  for (const k of e.keys) {
    const nk = norm(k);
    if (nk === q) best = Math.min(best, 0);
    else if (nk.startsWith(q)) best = Math.min(best, 1 + (nk.length - q.length) * 0.01);
    else if (nk.includes(q)) best = Math.min(best, 3);
  }
  return best + e.rank * 0.3;
}

export function renderSearch(app: App): PanelView {
  const index = buildIndex(app);
  const input = h('input', { type: 'search', placeholder: 'Planets, stars, constellations, M31, ISS…', 'aria-label': 'Search the sky', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const results = h('div', { role: 'listbox' });
  let items: Entry[] = [];
  let focus = 0;

  const choose = (e: Entry) => {
    const f = app.frame;
    const dir = app.view.directionOf(e.obj);
    app.select(e.obj, { fly: true, fov: e.fov });
    if (dir && dir.y < 0 && f) app.toasts.show(`${e.name} is below the horizon right now`);
    if (window.innerWidth < 760) app.panels.close();
  };

  const render = () => {
    results.replaceChildren(
      ...items.map((e, i) =>
        h(
          'div',
          { class: `result ${i === focus ? 'focus' : ''}`, role: 'option', onclick: () => choose(e) },
          h('span', { class: 'kind' }, e.kind),
          h('span', { class: 'name' }, e.name),
          h('span', { class: 'extra' }, e.extra),
        ),
      ),
    );
    if (!items.length && input.value) results.append(h('p', { class: 'note' }, 'No matches. Try a planet, a star name (Vega), a Messier number (M42) or a constellation.'));
  };

  const suggestions = () => {
    const f = app.frame;
    const names = ['Moon', 'Jupiter', 'Saturn', 'Venus', 'Mars', 'Andromeda', 'M42 Orion Nebula', 'Pleiades', 'Polaris', 'ISS'];
    const picks = names.map((n) => index.find((e) => norm(e.name).startsWith(norm(n)) || e.keys.some((k) => norm(k) === norm(n)))).filter(Boolean) as Entry[];
    return picks.filter((e) => {
      if (!f || e.obj.kind !== 'body') return true;
      return true;
    });
  };

  const update = () => {
    const q = norm(input.value);
    focus = 0;
    if (!q) items = suggestions();
    else
      items = index
        .map((e) => ({ e, s: score(e, q) }))
        .filter((x) => x.s < Infinity)
        .sort((a, b) => a.s - b.s)
        .slice(0, 40)
        .map((x) => x.e);
    render();
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') (focus = Math.min(items.length - 1, focus + 1)), render(), ev.preventDefault();
    else if (ev.key === 'ArrowUp') (focus = Math.max(0, focus - 1)), render(), ev.preventDefault();
    else if (ev.key === 'Enter' && items[focus]) choose(items[focus]);
  });
  update();

  return {
    title: 'Search',
    subtitle: 'Find anything in the sky',
    header: h('label', { class: 'search-box' }, icon('search', 18), input),
    body: h('div', {}, results),
    focus: () => input.focus(),
  };
}
