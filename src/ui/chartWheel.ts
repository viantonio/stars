import type { Chart, PointId } from '../esoteric/types';

/**
 * The chart wheel as SVG. From the outside in:
 *   1. the twelve signs (the symbolic zodiac, tropical or sidereal),
 *   2. the constellations the ecliptic physically crosses (13, incl. Ophiuchus),
 *   3. the houses, with the Ascendant on the left as tradition draws it,
 * then the planets and the aspect lines between them.
 */

export const PLANET_GLYPH: Record<PointId, string> = {
  Sun: '☉', Moon: '☽', Mercury: '☿', Venus: '♀', Mars: '♂', Jupiter: '♃', Saturn: '♄',
  Uranus: '♅', Neptune: '♆', Pluto: '♇', NorthNode: '☊', SouthNode: '☋', Ascendant: 'AC', Midheaven: 'MC',
};

export const SIGN_GLYPHS = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'].map((g) => g + '︎');
export const SIGN_NAMES = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
/** Fire, earth, air, water, repeating. */
export const ELEMENT_COLORS = ['#ff8a5c', '#9bd16a', '#ffd479', '#6fb6ff'];

const ASPECT_COLORS: Record<string, string> = {
  conjunction: '#ffd479',
  sextile: '#6fb6ff',
  trine: '#6fe3a1',
  square: '#ff7a7a',
  opposition: '#ff9a6b',
};

export interface WheelOptions {
  size?: number;
  constellations?: { id: string; start: number; end: number }[];
  /** Constellation abbreviation → display name. */
  names?: Record<string, string>;
  onPick?: (id: PointId) => void;
}

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

export function chartWheel(chart: Chart, opts: WheelOptions = {}): SVGSVGElement {
  const S = opts.size ?? 360;
  const c = S / 2;
  const R0 = c - 4; // outer edge
  const R1 = R0 - 30; // sign ring inner
  const R2 = R1 - 16; // constellation ring inner
  const R3 = R2 - 30; // planet ring
  const R4 = R3 - 40; // aspect circle
  const asc = chart.points.find((p) => p.id === 'Ascendant')?.longitude ?? chart.cusps[0] ?? 0;
  // Longitude → screen angle: Ascendant at 9 o'clock, increasing counter-clockwise.
  const ang = (lon: number) => ((180 + (lon - asc)) * Math.PI) / 180;
  const at = (lon: number, r: number) => [c + r * Math.cos(ang(lon)), c - r * Math.sin(ang(lon))] as const;

  const svg = el('svg', { viewBox: `0 0 ${S} ${S}`, width: S, height: S, class: 'chart-wheel', role: 'img', 'aria-label': 'Chart wheel' });
  const defs = el('defs', {});
  const grad = el('radialGradient', { id: 'wheel-bg' });
  grad.append(el('stop', { offset: '0%', 'stop-color': '#1a2140' }), el('stop', { offset: '100%', 'stop-color': '#070a15' }));
  defs.append(grad);
  svg.append(defs, el('circle', { cx: c, cy: c, r: R0, fill: 'url(#wheel-bg)', stroke: 'rgba(255,255,255,0.18)' }));

  // 1. Signs.
  for (let i = 0; i < 12; i++) {
    const a = i * 30;
    const [x1, y1] = at(a, R0);
    const [x2, y2] = at(a, R1);
    svg.append(el('line', { x1, y1, x2, y2, stroke: 'rgba(255,255,255,0.18)' }));
    const [gx, gy] = at(a + 15, (R0 + R1) / 2);
    const t = el('text', { x: gx, y: gy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 17, fill: ELEMENT_COLORS[i % 4] }, SIGN_GLYPHS[i]);
    t.append(el('title', {}, SIGN_NAMES[i]));
    svg.append(t);
  }
  svg.append(el('circle', { cx: c, cy: c, r: R1, fill: 'none', stroke: 'rgba(255,255,255,0.18)' }));

  // 2. Real constellations along the ecliptic (tropical longitudes of date → shift for sidereal).
  if (opts.constellations) {
    const shift = chart.zodiac === 'sidereal' ? -chart.ayanamsa : 0;
    opts.constellations.forEach((seg, i) => {
      const s = seg.start + shift;
      let e = seg.end + shift;
      if (e < s) e += 360;
      const [x1, y1] = at(s, R1);
      const [x2, y2] = at(s, R2);
      svg.append(el('line', { x1, y1, x2, y2, stroke: 'rgba(181,140,255,0.5)' }));
      const mid = (s + e) / 2;
      const [tx, ty] = at(mid, (R1 + R2) / 2);
      const deg = -((ang(mid) * 180) / Math.PI) + 90;
      const label = el('text', {
        x: tx, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 7.5, fill: i % 2 ? '#c9adff' : '#a88be0',
        transform: `rotate(${((deg % 360) + 360) % 360 > 90 && ((deg % 360) + 360) % 360 < 270 ? deg + 180 : deg} ${tx} ${ty})`,
        'letter-spacing': 0.5,
      }, seg.id.toUpperCase());
      label.append(el('title', {}, `${opts.names?.[seg.id] ?? seg.id}: the constellation physically behind this stretch of the ecliptic`));
      svg.append(label);
    });
    svg.append(el('circle', { cx: c, cy: c, r: R2, fill: 'none', stroke: 'rgba(181,140,255,0.35)' }));
  }

  // 3. Houses.
  chart.cusps.forEach((cusp, i) => {
    const angle = i === 0 || i === 3 || i === 6 || i === 9;
    const [x1, y1] = at(cusp, R2);
    const [x2, y2] = at(cusp, angle ? 12 : R4);
    svg.append(el('line', { x1, y1, x2, y2, stroke: angle ? 'rgba(255,207,122,0.7)' : 'rgba(255,255,255,0.14)', 'stroke-width': angle ? 1.4 : 1 }));
    const next = chart.cusps[(i + 1) % 12];
    let span = next - cusp;
    if (span < 0) span += 360;
    const [hx, hy] = at(cusp + span / 2, R4 + 10);
    svg.append(el('text', { x: hx, y: hy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 9, fill: 'rgba(255,255,255,0.45)' }, String(i + 1)));
  });
  svg.append(el('circle', { cx: c, cy: c, r: R4, fill: 'none', stroke: 'rgba(255,255,255,0.12)' }));

  // Aspect lines.
  const byId = new Map(chart.points.map((p) => [p.id, p]));
  for (const a of chart.aspects) {
    if (a.type === 'conjunction') continue;
    const pa = byId.get(a.a);
    const pb = byId.get(a.b);
    if (!pa || !pb) continue;
    const [x1, y1] = at(pa.longitude, R4);
    const [x2, y2] = at(pb.longitude, R4);
    svg.append(el('line', { x1, y1, x2, y2, stroke: ASPECT_COLORS[a.type], 'stroke-width': Math.max(0.6, 1.6 - a.orb / 5), opacity: 0.75 }));
  }

  // Planets, spread apart where they crowd together.
  const bodies = chart.points.filter((p) => p.id !== 'Ascendant' && p.id !== 'Midheaven' && p.id !== 'SouthNode').sort((a, b) => a.longitude - b.longitude);
  const placed = bodies.map((p) => ({ p, pos: p.longitude }));
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i];
      const b = placed[(i + 1) % placed.length];
      let d = b.pos - a.pos;
      if (i === placed.length - 1) d += 360;
      if (d < 8) {
        const push = (8 - d) / 2;
        a.pos -= push;
        b.pos += push;
      }
    }
  }
  for (const { p, pos } of placed) {
    const [tx1, ty1] = at(p.longitude, R2);
    const [tx2, ty2] = at(p.longitude, R2 - 5);
    svg.append(el('line', { x1: tx1, y1: ty1, x2: tx2, y2: ty2, stroke: 'rgba(255,255,255,0.7)' }));
    const [gx, gy] = at(pos, R3 + 6);
    const g = el('g', { class: 'wheel-planet', tabindex: 0, role: 'button', 'aria-label': p.id });
    g.append(el('circle', { cx: gx, cy: gy, r: 10, fill: 'rgba(8,11,20,0.85)', stroke: 'rgba(255,255,255,0.12)' }));
    g.append(el('text', { x: gx, y: gy + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': p.id === 'Sun' || p.id === 'Moon' ? 15 : 13, fill: p.retrograde ? '#ff9a9a' : '#f4ecd8' }, PLANET_GLYPH[p.id]));
    g.append(el('title', {}, `${p.id}${p.retrograde ? ' (retrograde)' : ''}`));
    if (opts.onPick) {
      g.addEventListener('click', () => opts.onPick!(p.id));
      g.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && opts.onPick!(p.id));
    }
    svg.append(g);
  }

  // Ascendant / Midheaven labels.
  for (const id of ['Ascendant', 'Midheaven'] as const) {
    const p = byId.get(id);
    if (!p) continue;
    const [x, y] = at(p.longitude, R0 + 0);
    svg.append(el('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 9, 'font-weight': 700, fill: '#ffcf7a', stroke: '#070a15', 'stroke-width': 3, 'paint-order': 'stroke' }, id === 'Ascendant' ? 'AC' : 'MC'));
  }
  return svg;
}
