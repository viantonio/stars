import * as THREE from 'three';
import { SkyView, type FrameInfo } from './render/skyview';
import { TimeController } from './core/time';
import { SettingsStore } from './core/settings';
import { PRESET_LOCATIONS, customLocation, type SiteLocation } from './core/locations';
import type { SkyObject } from './core/objects';
import { sameObject } from './core/objects';
import type { Catalogs } from './data/catalog';
import { loadJSON, loadText } from './data/catalog';
import { parseCometEls, parseAsteroids, type SmallBodyElements } from './astro/smallbodies';
import { parseTLE, mergeTLE } from './astro/satellites';
import { computeEvents, tonightSummary, type SkyEvent, type Tonight } from './astro/events';
import { satellitePath } from './core/describe';
import { Hud } from './ui/hud';
import { TimeBar } from './ui/timebar';
import { Toolbar } from './ui/toolbar';
import { InfoCard } from './ui/info';
import { PanelHost, type PanelId } from './ui/panels';
import { Toasts } from './ui/toast';
import { showWelcome, showHelp } from './ui/modal';
import { PointingMode } from './ui/pointing';
import { h } from './ui/dom';

/** Top-level controller: owns the clock, settings, sky view and UI. */
export class App {
  readonly time = new TimeController();
  readonly settings = new SettingsStore();
  readonly view: SkyView;
  readonly toasts: Toasts;
  readonly panels: PanelHost;
  readonly info: InfoCard;
  readonly pointing: PointingMode;
  private site: SiteLocation;
  private tonightCache: { key: string; value: Tonight } | null = null;
  private eventsCache: { key: string; value: SkyEvent[] } | null = null;
  private frameListeners = new Set<(f: FrameInfo) => void>();
  private lastUiUpdate = 0;
  frame: FrameInfo | null = null;

  constructor(readonly root: HTMLElement, readonly catalogs: Catalogs, textures: Record<string, THREE.Texture>) {
    this.site = this.resolveSite();
    this.view = new SkyView(root, catalogs, textures, () => this.settings.get());
    this.toasts = new Toasts(root);
    new Hud(this);
    new TimeBar(this);
    new Toolbar(this);
    this.info = new InfoCard(this);
    this.panels = new PanelHost(this);
    this.pointing = new PointingMode(this);
    root.append(h('div', { class: 'night-filter' }));

    this.view.controls.onClick = (x, y) => this.select(this.view.pick(x, y));
    this.view.controls.onUserMove = () => this.info.onUserMove();
    this.view.renderer.domElement.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      const o = this.view.pick(e.clientX, e.clientY, 14);
      this.view.setHover(o && o.kind !== 'constellation' ? o : null);
      this.view.renderer.domElement.style.cursor = o && o.kind !== 'constellation' ? 'pointer' : '';
    });

    this.settings.onChange((s, changed) => {
      if (changed.includes('locationId') || changed.includes('custom')) {
        this.site = this.resolveSite();
        this.tonightCache = null;
        this.eventsCache = null;
      }
      document.body.classList.toggle('night-vision', s.nightVision);
    });
    document.body.classList.toggle('night-vision', this.settings.get().nightVision);
    this.time.onChange(() => this.info.refreshSoon());

    this.installShortcuts();
    this.initialView();
    void this.loadDynamicData();
    requestAnimationFrame(this.loop);
    if (!this.settings.get().onboarded) setTimeout(() => showWelcome(this), 900);
  }

  // ------------------------------------------------------------------ site

  private resolveSite(): SiteLocation {
    const s = this.settings.get();
    if (s.locationId === 'custom' && s.custom) return customLocation(s.custom.lat, s.custom.lon, s.custom.elevation, s.custom.name);
    return PRESET_LOCATIONS.find((l) => l.id === s.locationId) ?? PRESET_LOCATIONS[0];
  }

  getSite(): SiteLocation {
    return this.site;
  }

  setLocation(id: string, custom?: { lat: number; lon: number; elevation: number; name: string }): void {
    this.settings.set({ locationId: id, custom: custom ?? this.settings.get().custom });
    this.toasts.show(`Observing from ${this.resolveSite().name}`);
  }

  // ------------------------------------------------------------- data

  private async loadDynamicData(): Promise<void> {
    // Bundled snapshots first, then try fresh data from the source catalogues.
    const small: SmallBodyElements[] = [];
    try {
      const [cometsTxt, asteroids] = await Promise.all([loadText('CometEls.txt'), loadJSON<unknown>('asteroids.json')]);
      small.push(...parseCometEls(cometsTxt), ...parseAsteroids(asteroids));
      this.view.setSmallBodies([...small]);
    } catch (e) {
      console.warn('Small bodies unavailable', e);
    }
    let sats = [] as ReturnType<typeof parseTLE>;
    try {
      sats = parseTLE(await loadText('satellites.tle'));
      this.view.setSatellites(sats);
    } catch (e) {
      console.warn('Satellites unavailable', e);
    }
    if (!navigator.onLine) return;
    const timeout = (ms: number) => AbortSignal.timeout?.(ms);
    try {
      const groups = await Promise.all(
        ['stations', 'visual'].map((g) =>
          fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`, { signal: timeout(12000) }).then((r) => (r.ok ? r.text() : '')),
        ),
      );
      const live = parseTLE(groups.join('\n'));
      if (live.length) {
        this.view.setSatellites(mergeTLE(sats, live));
        this.info.refreshSoon();
      }
    } catch {
      /* offline or blocked: keep the bundled elements */
    }
    try {
      const r = await fetch('https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt', { signal: timeout(15000) });
      if (r.ok) {
        const live = parseCometEls(await r.text());
        if (live.length > 100) this.view.setSmallBodies([...live, ...small.filter((s) => s.kind === 'asteroid')]);
      }
    } catch {
      /* keep bundled comet elements */
    }
  }

  // ------------------------------------------------------------- selection

  select(o: SkyObject | null, opts: { fly?: boolean; fov?: number } = {}): void {
    if (o && sameObject(o, this.view.selection) && !opts.fly) {
      this.info.open(o);
      return;
    }
    this.view.select(o);
    this.view.controls.trackTarget = null;
    if (o) {
      this.info.open(o);
      if (o.kind === 'satellite') this.view.setSelectionPath(satellitePath(this.view, o.noradId));
      if (opts.fly) this.flyTo(o, opts.fov);
    } else this.info.close();
  }

  flyTo(o: SkyObject, fov?: number): void {
    const dir = this.view.directionOf(o);
    if (!dir) return;
    this.view.controls.flyTo(dir, fov);
  }

  track(o: SkyObject | null): void {
    this.view.controls.trackTarget = o ? () => this.view.directionOf(o) : null;
  }

  get tracking(): boolean {
    return !!this.view.controls.trackTarget;
  }

  // ------------------------------------------------------------- caches

  tonight(): Tonight {
    const f = this.frame;
    const t = f?.time ?? new Date();
    // Key on the local calendar day (the summary is for "the coming night").
    const key = `${this.site.id}:${this.site.lat}:${new Date(t.getTime() - 12 * 3600e3).toISOString().slice(0, 10)}`;
    if (!this.tonightCache || this.tonightCache.key !== key) this.tonightCache = { key, value: tonightSummary(this.site, t) };
    return this.tonightCache.value;
  }

  events(): SkyEvent[] {
    const t = this.frame?.time ?? new Date();
    const key = `${this.site.id}:${this.site.lat}:${t.toISOString().slice(0, 7)}`;
    if (!this.eventsCache || this.eventsCache.key !== key) {
      const start = new Date(t.getTime() - 7 * 86400e3);
      const end = new Date(t.getTime() + 380 * 86400e3);
      this.eventsCache = { key, value: computeEvents(this.site, start, end) };
    }
    return this.eventsCache.value;
  }

  onFrame(fn: (f: FrameInfo) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  openPanel(id: PanelId): void {
    this.panels.toggle(id);
  }

  // ------------------------------------------------------------- loop

  private loop = () => {
    requestAnimationFrame(this.loop);
    const settings = this.settings.get();
    const time = this.time.now();
    this.frame = this.view.update(time, this.site, settings);
    this.pointing.update();
    const now = performance.now();
    if (now - this.lastUiUpdate > 200) {
      this.lastUiUpdate = now;
      for (const l of this.frameListeners) l(this.frame);
    }
  };

  private initialView(): void {
    // Start facing south, a third of the way up — where most of the action is.
    this.view.controls.az = 180;
    this.view.controls.alt = 28;
    this.view.controls.fov = window.innerWidth < 760 ? 80 : 72;
  }

  // ------------------------------------------------------------- keyboard

  private installShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select')) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          this.panels.open('search');
        }
        return;
      }
      const s = this.settings;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.time.togglePause();
          break;
        case 'n':
        case 'N':
          this.time.resetToNow();
          this.toasts.show('Back to the present');
          break;
        case ']':
          this.time.stepRate(1);
          break;
        case '[':
          this.time.stepRate(-1);
          break;
        case 'c':
          s.toggle('constellationLines');
          break;
        case 'v':
          s.toggle('constellationNames');
          break;
        case 'b':
          s.toggle('constellationBounds');
          break;
        case 'l':
          s.toggle('starNames');
          break;
        case 'g':
          s.toggle('ground');
          break;
        case 'h':
          s.toggle('atmosphere');
          break;
        case 'm':
          s.toggle('milkyWay');
          break;
        case 'e':
          s.toggle('gridEquatorial');
          break;
        case 'z':
          s.toggle('gridAltAz');
          break;
        case 'k':
          s.toggle('ecliptic');
          break;
        case 'r':
          s.toggle('nightVision');
          break;
        case 'p':
          s.toggle('perfectSky');
          this.toasts.show(s.get().perfectSky ? 'Perfect sky: no light pollution' : `Realistic sky for ${this.site.name}`);
          break;
        case 'u':
          document.body.classList.toggle('hide-ui');
          break;
        case 'f':
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.();
          break;
        case '/':
          e.preventDefault();
          this.panels.open('search');
          break;
        case 't':
          this.panels.toggle('tonight');
          break;
        case 'y':
          this.panels.toggle('events');
          break;
        case '?':
          showHelp(this);
          break;
        case 'Escape':
          if (this.panels.current) this.panels.close();
          else this.select(null);
          break;
      }
    });
  }
}
