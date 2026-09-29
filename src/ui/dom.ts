/** Tiny DOM helpers and the icon set used across the UI. */

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null> & { class?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function icon(name: keyof typeof ICONS, size = 20): SVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return wrap.firstElementChild as SVGElement;
}

export const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  phone: '<rect x="6.5" y="2" width="11" height="20" rx="2.5"/><path d="M11 18.5h2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  play: '<path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
  forward: '<path d="m13 6 6 6-6 6M5 6l6 6-6 6"/>',
  back: '<path d="m11 18-6-6 6-6M19 18l-6-6 6-6"/>',
  stepBack: '<path d="M6 5v14"/><path d="M19 5 9 12l10 7V5Z" fill="currentColor"/>',
  stepForward: '<path d="M18 5v14"/><path d="M5 5l10 7-10 7V5Z" fill="currentColor"/>',
  hexagram: '<path d="M12 2.5 20.5 17h-17L12 2.5Z"/><path d="M12 21.5 3.5 7h17L12 21.5Z"/>',
  moments: '<circle cx="12" cy="12" r="9"/><path d="m12 7 1.4 3.1 3.3.3-2.5 2.2.8 3.3L12 14.2 9 15.9l.8-3.3-2.5-2.2 3.3-.3L12 7Z"/>',
  constellation: '<circle cx="5" cy="17" r="1.6" fill="currentColor"/><circle cx="10" cy="8" r="1.6" fill="currentColor"/><circle cx="17" cy="11" r="1.6" fill="currentColor"/><circle cx="19" cy="4" r="1.6" fill="currentColor"/><path d="M5 17 10 8l7 3 2-7"/>',
  labels: '<path d="M4 18 9 6l5 12M5.8 14h6.4"/><path d="M15 18v-5.5a2.5 2.5 0 0 1 5 0V18M15 15h5"/>',
  atmosphere: '<path d="M3 15c2.5-2 5.5-2 8 0s5.5 2 8 0"/><path d="M3 19c2.5-2 5.5-2 8 0s5.5 2 8 0"/><path d="M7 10a5 5 0 0 1 10 0"/>',
  mountain: '<path d="m2 20 7-11 4 6 3-4 6 9H2Z"/>',
  galaxy: '<path d="M12 12c3-1 6 0 7 2.5s-2 5-6 5-8-3-8-7 3-8 8-8 7 3 5 5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  now: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  track: '<circle cx="12" cy="12" r="2.5"/><path d="M5.6 5.6a9 9 0 0 1 12.8 0M18.4 18.4a9 9 0 0 1-12.8 0"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>',
  sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.2 2.2M15.5 15.5l2.2 2.2M6.3 17.7l2.2-2.2M15.5 8.5l2.2-2.2"/>',
  satellite: '<path d="m13 7 4 4M4 13l3-3 7 7-3 3-7-7ZM14 4l3-3 6 6-3 3M17 14a3 3 0 0 1-3 3M20 14a6 6 0 0 1-6 6"/>',
  comet: '<circle cx="17" cy="7" r="3"/><path d="M14.8 9.2 3 21M13 7.5 5 15.5M16.5 10 8.5 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
  camera: '<path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z"/><circle cx="12" cy="13" r="3.5"/>',
  locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
  telescope: '<path d="m10 14-6 3 1.5 3 6-3M14.5 4l-7 3.5 2.5 5 7-3.5L14.5 4ZM16.5 3l2.5 5M13 16l3 5M11 16l-3 5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  meteor: '<path d="M4 20 14 10M8 20l9-9M4 16l9-9M18 4l2 2-3 3-2-2 3-3Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.5"/>',
  orbit: '<circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="10" ry="4.5"/><circle cx="20.5" cy="10" r="1.2" fill="currentColor"/>',
  book: '<path d="M12 6.5C9.5 4.8 6 4.3 2.5 5v13.5c3.5-.7 7 0 9.5 1.7 2.5-1.7 6-2.4 9.5-1.7V5c-3.5-.7-7-.2-9.5 1.5Z"/><path d="M12 6.5v13.7"/>',
} as const;

export function fmtTime(d: Date | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz, ...opts }).format(d);
}

export function fmtDate(d: Date, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: tz, ...opts }).format(d);
}

export function fmtDateTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(d);
}

export function fmtRelative(d: Date, now: Date): string {
  const s = (d.getTime() - now.getTime()) / 1000;
  const a = Math.abs(s);
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (a < 60) return fmt.format(Math.round(s), 'second');
  if (a < 3600) return fmt.format(Math.round(s / 60), 'minute');
  if (a < 86400) return fmt.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 45) return fmt.format(Math.round(s / 86400), 'day');
  return fmt.format(Math.round(s / (86400 * 30.44)), 'month');
}

export function fmtRA(hours: number): string {
  const h = Math.floor(hours);
  const mf = (hours - h) * 60;
  const m = Math.floor(mf);
  const s = (mf - m) * 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${s.toFixed(1).padStart(4, '0')}s`;
}

export function fmtDec(deg: number): string {
  const sign = deg < 0 ? '−' : '+';
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const mf = (a - d) * 60;
  const m = Math.floor(mf);
  const s = Math.round((mf - m) * 60);
  return `${sign}${d}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
}

export function fmtAngle(deg: number): string {
  if (deg >= 1) return `${deg.toFixed(deg >= 10 ? 0 : 1)}°`;
  if (deg * 60 >= 1) return `${(deg * 60).toFixed(1)}′`;
  return `${(deg * 3600).toFixed(1)}″`;
}

export function fmtDistanceAU(au: number): string {
  const km = au * 149597870.7;
  if (km < 1e6) return `${Math.round(km).toLocaleString()} km`;
  if (au < 0.1) return `${(km / 1e6).toFixed(2)} million km`;
  const lm = (au * 499.005) / 60;
  return `${au.toFixed(au < 10 ? 3 : 2)} AU · ${lm < 60 ? `${lm.toFixed(1)} light-min` : `${(lm / 60).toFixed(2)} light-hr`}`;
}

export function fmtLy(ly: number): string {
  if (ly >= 1e6) return `${(ly / 1e6).toFixed(ly >= 1e7 ? 0 : 1)} million ly`;
  if (ly >= 1000) return `${Math.round(ly).toLocaleString()} ly`;
  return `${ly.toFixed(ly < 10 ? 2 : 1)} ly`;
}

export function compass16(az: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}
