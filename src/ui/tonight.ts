import * as A from 'astronomy-engine';
import type { App } from '../app';
import type { PanelView } from './panels';
import type { MajorBodyId } from '../astro/solarsystem';
import { BODY_BY_ID } from '../astro/solarsystem';
import { predictPasses } from '../astro/satellites';
import { activeShowers, expectedHourlyRate } from '../astro/meteors';
import { smallBodyState } from '../astro/smallbodies';
import { shortCometName } from '../render/skyview';
import { h, fmtTime, fmtDate, compass16 } from './dom';

/** Draws a moon phase disc (waxing lit on the right as seen from the northern hemisphere). */
export function drawMoonPhase(canvas: HTMLCanvasElement, phaseAngle: number, size = 72): void {
  const dpr = Math.min(2, window.devicePixelRatio);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const r = size / 2 - 3;
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  // Glow.
  const g = ctx.createRadialGradient(c, c, r * 0.8, c, c, r + 3);
  g.addColorStop(0, 'rgba(255,245,220,0.15)');
  g.addColorStop(1, 'rgba(255,245,220,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Dark disc.
  ctx.fillStyle = '#1a1f2c';
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  // Lit part: phaseAngle 0 = new, 180 = full (ecliptic longitude difference).
  const p = ((phaseAngle % 360) + 360) % 360;
  const waxing = p < 180;
  const k = Math.cos((p * Math.PI) / 180); // 1 new … -1 full
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip();
  const lit = ctx.createRadialGradient(c - r * 0.3, c - r * 0.3, r * 0.1, c, c, r * 1.1);
  lit.addColorStop(0, '#fffaf0');
  lit.addColorStop(1, '#d8d2c2');
  ctx.fillStyle = lit;
  ctx.beginPath();
  // Semicircle on the lit side + ellipse for the terminator.
  const side = waxing ? 1 : -1;
  ctx.moveTo(c, c - r);
  ctx.arc(c, c, r, -Math.PI / 2, Math.PI / 2, side < 0);
  ctx.ellipse(c, c, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === (side > 0));
  ctx.fill();
  // Subtle maria.
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(120,115,105,0.28)';
  for (const [x, y, rr] of [[-0.25, -0.2, 0.22], [0.1, -0.3, 0.16], [0.2, 0.05, 0.2], [-0.1, 0.25, 0.14]]) {
    ctx.beginPath();
    ctx.arc(c + x * r, c + y * r, rr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const QUALITY_COLOR: Record<string, string> = {
  Excellent: 'var(--good)',
  Good: '#9be37a',
  Fair: 'var(--warn)',
  Poor: '#ff9a6b',
  'Very poor': 'var(--bad)',
};

export function renderTonight(app: App): PanelView {
  const site = app.getSite();
  const tz = site.timeZone;
  const t = app.tonight();
  const f = app.frame!;
  const body = h('div');
  const tm = (d: Date | null) => fmtTime(d, tz);

  // ---- Sky quality summary.
  const q = t.skyQuality;
  const dark = t.darkWindow;
  const darkText = dark.length
    ? `Moon-free darkness ${dark.map((w) => `${tm(w.start)} – ${tm(w.end)}`).join(', ')}.`
    : 'No moon-free astronomical darkness tonight.';
  body.append(
    h('div', { class: 'section-title' }, `The night of ${fmtDate(t.noon, tz, { weekday: 'long', year: undefined })}`),
    h(
      'div',
      { class: 'card quality' },
      h('div', { class: 'quality-ring', style: `--p:${q.score};--c:${QUALITY_COLOR[q.label] ?? 'var(--good)'}` }, h('span', {}, String(q.score))),
      h(
        'div',
        {},
        h('div', { style: 'font-weight:650;font-size:15px' }, `${q.label} stargazing`),
        h('div', { class: 'muted small', style: 'margin-top:3px;line-height:1.5' }, `${darkText} Bortle ${app.settings.get().bortleOverride ?? site.bortle} skies at ${site.name}.`),
      ),
    ),
  );

  // ---- Twilight timeline.
  const bar = h('canvas');
  const barWrap = h('div', { class: 'twilight-bar' }, bar);
  body.append(
    h('div', { class: 'card' }, barWrap, h(
      'div',
      { class: 'times-grid tabnum', style: 'margin-top:10px' },
      h('div', {}, 'Sunset', h('b', {}, tm(t.sunset))),
      h('div', {}, 'Sunrise', h('b', {}, tm(t.sunrise))),
      h('div', {}, 'Civil dusk', h('b', {}, tm(t.civilDusk))),
      h('div', {}, 'Civil dawn', h('b', {}, tm(t.civilDawn))),
      h('div', {}, 'Nautical dusk', h('b', {}, tm(t.nauticalDusk))),
      h('div', {}, 'Nautical dawn', h('b', {}, tm(t.nauticalDawn))),
      h('div', {}, 'Dark from', h('b', {}, tm(t.astronomicalDusk))),
      h('div', {}, 'Dark until', h('b', {}, tm(t.astronomicalDawn))),
      h('div', {}, 'Moonrise', h('b', {}, tm(t.moon.rise))),
      h('div', {}, 'Moonset', h('b', {}, tm(t.moon.set))),
    )),
  );
  requestAnimationFrame(() => drawTwilight(bar, app));

  // ---- Moon.
  const moonCanvas = h('canvas');
  drawMoonPhase(moonCanvas, t.moon.phaseAngle);
  body.append(
    h('div', { class: 'section-title' }, 'The Moon'),
    h(
      'div',
      { class: 'card clickable moon-hero', onclick: () => app.select({ kind: 'body', id: 'Moon' }, { fly: true, fov: 3 }) },
      moonCanvas,
      h(
        'div',
        {},
        h('div', { class: 'big' }, t.moon.phaseName),
        h(
          'div',
          { class: 'small' },
          `${Math.round(t.moon.illumination * 100)}% illuminated · ${t.moon.ageDays.toFixed(1)} days old`,
          h('br'),
          `Full ${fmtDate(t.moon.nextFullMoon, tz, { weekday: undefined, year: undefined })} · New ${fmtDate(t.moon.nextNewMoon, tz, { weekday: undefined, year: undefined })}`,
        ),
      ),
    ),
  );

  // ---- Planets.
  body.append(h('div', { class: 'section-title' }, 'Planets'));
  const planets = [...t.planets].sort((a, b) => Number(b.visibleTonight) - Number(a.visibleTonight) || a.mag - b.mag);
  for (const p of planets) {
    const info = BODY_BY_ID[p.body as MajorBodyId];
    body.append(
      h(
        'div',
        { class: 'card clickable', onclick: () => app.select({ kind: 'body', id: p.body as MajorBodyId }, { fly: true, fov: 30 }) },
        h(
          'div',
          { class: 'obj-row' },
          h('div', { class: 'obj-dot', style: `background:${info?.tint};color:${info?.tint}` }),
          h(
            'div',
            { class: 'obj-main' },
            h('div', { class: 'obj-name' }, p.body, h('span', { class: `pill ${p.visibleTonight ? '' : 'off'}` }, p.visibleTonight ? 'Visible' : 'Not visible')),
            h('div', { class: 'obj-meta' }, p.note),
          ),
          h('div', { class: 'obj-side tabnum' }, `mag ${p.mag.toFixed(1)}`, h('br'), h('span', { class: 'muted' }, p.bestTime ? `best ${tm(p.bestTime)}` : `rises ${tm(p.rise)}`)),
        ),
      ),
    );
  }

  // ---- Best deep-sky targets during the dark (or darkest) part of the night.
  const mid = dark.length ? new Date((dark[0].start.getTime() + dark[0].end.getTime()) / 2) : t.astronomicalDusk ?? t.sunset ?? f.time;
  const obs = new A.Observer(site.lat, site.lon, site.elevation);
  const lm = f.sky.limitingMag;
  const targets = app.catalogs.dso
    .filter((d) => d.messier || (d.name && (d.mag ?? 99) < 7))
    .map((d) => {
      const hz = A.Horizon(mid, obs, d.ra / 15, d.dec, 'normal');
      return { d, alt: hz.altitude, az: hz.azimuth };
    })
    .filter((x) => x.alt > 25 && (x.d.mag ?? 99) < 8.5)
    .sort((a, b) => (a.d.mag ?? 99) - (b.d.mag ?? 99) - (b.alt - a.alt) * 0.02)
    .slice(0, 7);
  if (targets.length) {
    body.append(h('div', { class: 'section-title' }, `Deep-sky highlights around ${tm(mid)}`));
    for (const { d, alt, az } of targets) {
      const eye = (d.mag ?? 99) < Math.min(lm, 6.5) - 0.5;
      body.append(
        h(
          'div',
          { class: 'card clickable', onclick: () => app.select({ kind: 'dso', id: d.id }, { fly: true, fov: Math.max(2, Math.min(25, (d.dim[0] / 60) * 4)) }) },
          h(
            'div',
            { class: 'obj-row' },
            h('div', { class: 'obj-dot', style: 'background:#b58cff;color:#b58cff' }),
            h(
              'div',
              { class: 'obj-main' },
              h('div', { class: 'obj-name' }, d.messier ? `${d.id.replace(' ', '')} ${d.name}` : d.name, h('span', { class: `pill ${eye ? '' : 'warn'}` }, eye ? 'Naked eye' : 'Binoculars')),
              h('div', { class: 'obj-meta' }, `${d.typeName} · ${Math.round(alt)}° up in the ${compass16(az)}`),
            ),
            h('div', { class: 'obj-side tabnum' }, d.mag != null ? `mag ${d.mag.toFixed(1)}` : ''),
          ),
        ),
      );
    }
  }

  // ---- Comets.
  const comets = app.view
    .getSmallBodies()
    .filter((e) => e.el.kind === 'comet' && e.state.mag < 11)
    .map((e) => ({ e, s: smallBodyState(e.el, mid, obs) }))
    .sort((a, b) => a.s.mag - b.s.mag)
    .slice(0, 4);
  if (comets.length) {
    body.append(h('div', { class: 'section-title' }, 'Comets'));
    for (const { e, s } of comets) {
      const hz = A.Horizon(mid, obs, s.ra, s.dec, 'normal');
      body.append(
        h(
          'div',
          { class: 'card clickable', onclick: () => app.select({ kind: 'smallbody', id: e.el.id }, { fly: true, fov: 12 }) },
          h(
            'div',
            { class: 'obj-row' },
            h('div', { class: 'obj-dot', style: 'background:#8ff0d0;color:#8ff0d0' }),
            h(
              'div',
              { class: 'obj-main' },
              h('div', { class: 'obj-name' }, shortCometName(e.el.name)),
              h('div', { class: 'obj-meta' }, `${s.mag < 6 ? 'Naked eye' : s.mag < 9 ? 'Binoculars' : 'Telescope'} · ${hz.altitude > 0 ? `${Math.round(hz.altitude)}° up at ${tm(mid)}` : `below the horizon at ${tm(mid)}`}`),
            ),
            h('div', { class: 'obj-side tabnum' }, `mag ${s.mag.toFixed(1)}`),
          ),
        ),
      );
    }
  }

  // ---- Meteor showers.
  const showers = activeShowers(mid).filter((s) => s.zhr >= 2);
  if (showers.length) {
    body.append(h('div', { class: 'section-title' }, 'Meteor showers'));
    for (const s of showers) {
      const rate = Math.max(...[0, 2, 4, 6].map((hr) => expectedHourlyRate(s.shower, new Date(mid.getTime() + hr * 3600e3), site, Math.min(lm, 6.5))));
      body.append(
        h(
          'div',
          { class: 'card clickable', onclick: () => app.select({ kind: 'radiant', id: s.shower.id }, { fly: true, fov: 90 }) },
          h('div', { class: 'obj-row' }, h('div', { class: 'obj-dot', style: 'background:#ffb36b;color:#ffb36b' }), h('div', { class: 'obj-main' }, h('div', { class: 'obj-name' }, s.shower.name), h('div', { class: 'obj-meta' }, `ZHR ${s.zhr.toFixed(0)} · up to ~${Math.round(rate)}/hr from here`))),
        ),
      );
    }
  }

  // ---- Space station passes.
  const passesWrap = h('div');
  body.append(h('div', { class: 'section-title' }, 'Space station passes'), passesWrap);
  const fillPasses = () => {
    const featured = app.view.satellites.filter((s) => s.featured && s.noradId !== 20580);
    const all = featured.flatMap((s) => predictPasses(s, site, new Date(t.noon), 1.5, 10).filter((p) => p.visible).map((p) => ({ s, p })));
    all.sort((a, b) => a.p.rise.time.getTime() - b.p.rise.time.getTime());
    passesWrap.replaceChildren(
      ...(all.length
        ? all.slice(0, 6).map(({ s, p }) =>
            h(
              'div',
              {
                class: 'card clickable',
                onclick: () => {
                  app.time.setTime(new Date((p.visibleStart ?? p.rise).time.getTime() - 60e3));
                  app.time.setRate(1);
                  app.select({ kind: 'satellite', noradId: s.noradId });
                  setTimeout(() => app.flyTo({ kind: 'satellite', noradId: s.noradId }, 80), 300);
                },
              },
              h(
                'div',
                { class: 'obj-row' },
                h('div', { class: 'obj-dot', style: 'background:#7ee0ff;color:#7ee0ff' }),
                h(
                  'div',
                  { class: 'obj-main' },
                  h('div', { class: 'obj-name' }, s.name, h('span', { class: 'pill gold' }, `mag ${p.peakMag.toFixed(1)}`)),
                  h('div', { class: 'obj-meta' }, `${tm((p.visibleStart ?? p.rise).time)} ${compass16((p.visibleStart ?? p.rise).az)} → max ${Math.round(p.maxAlt)}° → ${compass16((p.visibleEnd ?? p.set).az)}`),
                ),
                h('div', { class: 'obj-side' }, 'Watch'),
              ),
            ),
          )
        : [h('p', { class: 'note' }, 'No visible ISS or Tiangong passes tonight. They are only visible when sunlit against a dark sky — usually within a couple of hours of dusk or dawn.')]),
    );
  };
  setTimeout(fillPasses, 30);

  return {
    title: 'Tonight',
    subtitle: `${site.name} · ${site.region}`,
    body,
  };
}

/** Night timeline from sunset to sunrise with twilight shading and moon-up band. */
function drawTwilight(canvas: HTMLCanvasElement, app: App): void {
  const t = app.tonight();
  const site = app.getSite();
  const start = (t.sunset ?? t.noon).getTime() - 3600e3;
  const end = (t.sunrise ?? new Date(t.noon.getTime() + 86400e3)).getTime() + 3600e3;
  const W = canvas.clientWidth || 320;
  const H = canvas.clientHeight || 34;
  const dpr = Math.min(2, window.devicePixelRatio);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const obs = new A.Observer(site.lat, site.lon, site.elevation);
  for (let x = 0; x < W; x++) {
    const tm = new Date(start + ((end - start) * x) / W);
    const s = A.Equator(A.Body.Sun, tm, obs, true, true);
    const alt = A.Horizon(tm, obs, s.ra, s.dec).altitude;
    const a = Math.max(-18, Math.min(6, alt));
    const k = (a + 18) / 24;
    ctx.fillStyle = `rgb(${Math.round(8 + 190 * k * k)}, ${Math.round(10 + 120 * k * k)}, ${Math.round(22 + 120 * k)})`;
    ctx.fillRect(x, 0, 1, H);
    const m = A.Equator(A.Body.Moon, tm, obs, true, true);
    if (A.Horizon(tm, obs, m.ra, m.dec).altitude > 0) {
      ctx.fillStyle = 'rgba(230,236,255,0.35)';
      ctx.fillRect(x, H - 5, 1, 5);
    }
  }
  ctx.font = `600 10px ${getComputedStyle(document.body).fontFamily}`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let hr = Math.ceil(start / 3600e3); hr * 3600e3 < end; hr += 2) {
    const x = ((hr * 3600e3 - start) / (end - start)) * W;
    const label = new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: site.timeZone }).format(new Date(hr * 3600e3));
    ctx.fillText(label, x + 2, 12);
    ctx.fillRect(x, 0, 1, 4);
  }
}
