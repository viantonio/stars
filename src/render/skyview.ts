import * as A from 'astronomy-engine';
import * as THREE from 'three';
import { DEG, RAD, altAzToWorld, eqjToWorld, raDegDecToVec, raDecToVec, refraction, worldToAltAz } from '../astro/frames';
import { computeAllBodies, galileanMoons, AU_KM, type BodyState, type MajorBodyId } from '../astro/solarsystem';
import { computeSkyBrightness, displayFromFlux, magToFlux, type SkyBrightness } from '../astro/skyBrightness';
import { smallBodyState, brightComets, type SmallBodyElements, type SmallBodyState } from '../astro/smallbodies';
import { satelliteLook, observerInDarkness, type SatelliteEntry, type SatLook } from '../astro/satellites';
import { activeShowers, expectedHourlyRate } from '../astro/meteors';
import type { Catalogs, DeepSkyObject } from '../data/catalog';
import { starDisplayName } from '../data/catalog';
import type { SiteLocation } from '../core/locations';
import type { Settings } from '../core/settings';
import type { SkyObject } from '../core/objects';
import { sameObject } from '../core/objects';
import { LookControls } from '../core/controls';
import { Atmosphere } from './atmosphere';
import { StarField, PointLayer, bvToColor } from './stars';
import { SkyLines, pushArc, latitudeCircle, longitudeLine } from './lines';
import { BodyRenderer } from './bodies';
import { CometTails, type TailSpec } from './comets';
import { MeteorShowerFX, type RadiantSource } from './meteors';
import { Overlay, FONT_STACK } from './overlay';
import { createLandscape, type Landscape } from './landscape';
import { ayanamsaValue } from '../esoteric/ayanamsa';
import { SIGN_GLYPHS, SIGN_NAMES, ELEMENT_COLORS } from '../ui/chartWheel';

export interface FrameInfo {
  time: Date;
  astroTime: A.AstroTime;
  observer: A.Observer;
  site: SiteLocation;
  bodies: Map<MajorBodyId, BodyState>;
  sky: SkyBrightness;
  limitingMag: number;
  sunAlt: number;
  moonAlt: number;
  eqjToWorld: THREE.Matrix4;
  view: { az: number; alt: number; fov: number };
}

interface SmallBodyEntry {
  el: SmallBodyElements;
  state: SmallBodyState;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Direction of the brightest light dome per site (azimuth, deg) and its strength. */
const LIGHT_DOMES: Record<string, { az: number; lobe: number }> = {
  mariposa: { az: 240, lobe: 0.8 }, // Merced & the Central Valley
  sacramento: { az: 215, lobe: 0.4 }, // downtown
  'glacier-point': { az: 250, lobe: 0.5 }, // the valley floor & Fresno haze
};

export class SkyView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: LookControls;
  readonly overlay: Overlay;

  private celestial = new THREE.Group();
  private equatorOfDate = new THREE.Group();
  /** Frame of the true ecliptic of date (for the symbolic zodiac band). */
  private eclipticOfDate = new THREE.Group();
  private zodiacBand: SkyLines;
  private world = new THREE.Group();
  private atmosphere: Atmosphere;
  private stars: StarField;
  private planetPoints: PointLayer;
  private smallBodyPoints: PointLayer;
  private satPoints: PointLayer;
  private moonletPoints: PointLayer;
  private bodyRenderer: BodyRenderer;
  private tails = new CometTails();
  private meteors = new MeteorShowerFX();
  private landscape: Landscape | null = null;
  private landscapeKind = '';
  private constellationLines: SkyLines;
  private constellationBounds: SkyLines;
  private gridAltAz: SkyLines;
  private gridEq: SkyLines;
  private eclipticLine: SkyLines;
  private meridianLine: SkyLines;
  private horizonLine: SkyLines;
  private lineSets: SkyLines[] = [];

  private matrix = new THREE.Matrix4();
  private matrix3 = new THREE.Matrix3();
  private lastFrame = performance.now();
  private lastSimMs = 0;
  private smallBodies: SmallBodyElements[] = [];
  private visibleSmall: SmallBodyEntry[] = [];
  private lastSmallScan = -Infinity;
  private lastSmallScanSim = 0;
  satellites: SatelliteEntry[] = [];
  private satLooks = new Map<number, SatLook>();
  private lastSatUpdate = 0;
  private namedStars: { index: number; name: string; mag: number }[] = [];
  private constellationGenitive = new Map<string, string>();
  private dsoById = new Map<string, DeepSkyObject>();
  private selected: SkyObject | null = null;
  private hovered: SkyObject | null = null;
  private selectionPath: [number, number][] | null = null;
  private selectionPathKey = '';
  /** Recomputes the selection path when the site or time bucket changes. */
  selectionPathProvider: (() => [number, number][] | null) | null = null;
  frame: FrameInfo | null = null;
  /** Motion trails: EQJ positions per body, split into segments at time jumps. */
  private trails = new Map<MajorBodyId, THREE.Vector3[][]>();
  private lastTrailSim = 0;
  private width = 1;
  private height = 1;

  constructor(
    private container: HTMLElement,
    private catalogs: Catalogs,
    textures: Record<string, THREE.Texture>,
    private getSettings: () => Readonly<Settings>,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.domElement.className = 'sky-canvas';
    container.appendChild(this.renderer.domElement);
    this.overlay = new Overlay(container);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.5, 5000);
    this.controls = new LookControls(this.camera, this.renderer.domElement);

    this.celestial.matrixAutoUpdate = false;
    this.equatorOfDate.matrixAutoUpdate = false;
    this.eclipticOfDate.matrixAutoUpdate = false;
    this.scene.add(this.celestial, this.equatorOfDate, this.eclipticOfDate, this.world);

    this.atmosphere = new Atmosphere(textures.milkyway);
    this.scene.add(this.atmosphere.mesh);

    this.stars = new StarField(catalogs.stars);
    this.celestial.add(this.stars.points);
    const u = this.stars.material.uniforms;
    this.planetPoints = new PointLayer(16, u);
    this.smallBodyPoints = new PointLayer(64, u);
    this.moonletPoints = new PointLayer(8, u);
    this.satPoints = new PointLayer(256, u);
    this.celestial.add(this.planetPoints.points, this.smallBodyPoints.points, this.moonletPoints.points);
    this.world.add(this.satPoints.points);

    this.bodyRenderer = new BodyRenderer(textures);
    this.world.add(this.bodyRenderer.group);
    this.world.add(this.tails.mesh, this.meteors.lines);

    // Constellation figures, with small gaps around the stars.
    const cl: number[] = [];
    const gap = 0.55 * DEG;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const c of catalogs.constellations) {
      this.constellationGenitive.set(c.id, c.gen);
      for (const seg of c.lines) {
        for (let i = 0; i < seg.length - 1; i++) {
          raDegDecToVec(seg[i][0], seg[i][1], a);
          raDegDecToVec(seg[i + 1][0], seg[i + 1][1], b);
          const ang = a.angleTo(b);
          if (ang < gap * 2.5) continue;
          const f = gap / ang;
          const a2 = a.clone().lerp(b, f).normalize();
          const b2 = a.clone().lerp(b, 1 - f).normalize();
          pushArc(cl, a2, b2, 3);
        }
      }
    }
    this.constellationLines = new SkyLines(new Float32Array(cl), { color: 0x5b83c9, width: 1.25, opacity: 0.42 });
    this.celestial.add(this.constellationLines.object);

    const bl: number[] = [];
    for (const c of catalogs.constellations)
      for (const poly of c.bounds)
        for (let i = 0; i < poly.length; i++) {
          const p0 = poly[i];
          const p1 = poly[(i + 1) % poly.length];
          pushArc(bl, raDegDecToVec(p0[0], p0[1]), raDegDecToVec(p1[0], p1[1]), 2);
        }
    this.constellationBounds = new SkyLines(new Float32Array(bl), { color: 0x7a5a9e, width: 1, opacity: 0.35, dashed: true });
    this.celestial.add(this.constellationBounds.object);

    // Alt-azimuth grid (world frame, apparent: no refraction).
    const ga: number[] = [];
    for (let alt = -80; alt <= 80; alt += 10) latitudeCircle(ga, alt, 'y', 2);
    for (let az = 0; az < 360; az += 15) longitudeLine(ga, az, 'y', -80, 80, 2);
    this.gridAltAz = new SkyLines(new Float32Array(ga), { color: 0x3fa37a, width: 1, opacity: 0.35, refract: false });
    this.world.add(this.gridAltAz.object);

    // Equatorial grid of date (includes the celestial equator).
    const ge: number[] = [];
    for (let dec = -80; dec <= 80; dec += 10) latitudeCircle(ge, dec, 'z', 2);
    for (let ra = 0; ra < 360; ra += 15) longitudeLine(ge, ra, 'z', -80, 80, 2);
    this.gridEq = new SkyLines(new Float32Array(ge), { color: 0x4a8fd6, width: 1, opacity: 0.32 });
    this.equatorOfDate.add(this.gridEq.object);

    // Ecliptic (J2000 ecliptic plane expressed in EQJ).
    const ecl: number[] = [];
    const eps = 23.4392911 * DEG;
    for (let l = 0; l < 360; l += 1) {
      const p = (lon: number) => new THREE.Vector3(Math.cos(lon), Math.sin(lon) * Math.cos(eps), Math.sin(lon) * Math.sin(eps));
      const p0 = p(l * DEG);
      const p1 = p((l + 1) * DEG);
      ecl.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    }
    this.eclipticLine = new SkyLines(new Float32Array(ecl), { color: 0xd9a441, width: 1.4, opacity: 0.6 });
    this.celestial.add(this.eclipticLine.object);

    // Zodiac band: ±8° about the ecliptic with the twelve 30° divisions.
    const zb: number[] = [];
    latitudeCircle(zb, 8, 'z', 2);
    latitudeCircle(zb, -8, 'z', 2);
    for (let k = 0; k < 12; k++) longitudeLine(zb, k * 30, 'z', -8, 8, 2);
    this.zodiacBand = new SkyLines(new Float32Array(zb), { color: 0xc9a0ff, width: 1.2, opacity: 0.4 });
    this.eclipticOfDate.add(this.zodiacBand.object);

    const mer: number[] = [];
    longitudeLine(mer, 0, 'y', -90, 90, 1);
    longitudeLine(mer, 180, 'y', -90, 90, 1);
    this.meridianLine = new SkyLines(new Float32Array(mer), { color: 0xc25b5b, width: 1.2, opacity: 0.5, refract: false });
    this.world.add(this.meridianLine.object);

    const hor: number[] = [];
    latitudeCircle(hor, 0, 'y', 1);
    this.horizonLine = new SkyLines(new Float32Array(hor), { color: 0x6e8aa8, width: 1.2, opacity: 0.45, refract: false });
    this.world.add(this.horizonLine.object);

    this.lineSets = [this.constellationLines, this.constellationBounds, this.gridAltAz, this.gridEq, this.eclipticLine, this.meridianLine, this.horizonLine, this.zodiacBand];

    this.namedStars = [...catalogs.stars.meta.values()]
      .filter((m) => m.name)
      .map((m) => ({ index: m.index, name: m.name, mag: catalogs.stars.data[m.index * 5 + 3] }))
      .sort((x, y) => x.mag - y.mag);
    for (const d of catalogs.dso) this.dsoById.set(d.id, d);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setSmallBodies(list: SmallBodyElements[]): void {
    this.smallBodies = list;
    this.lastSmallScan = -Infinity;
  }

  setSatellites(list: SatelliteEntry[]): void {
    // Hide station modules that duplicate the ISS / Tiangong positions.
    this.satellites = list.filter((s) => !/POISK|NAUKA|WENTIAN|MENGTIAN|TIANHE|PIRS|ZVEZDA/i.test(s.fullName) || s.featured);
    this.satLooks.clear();
  }

  getSmallBodies(): SmallBodyEntry[] {
    return this.visibleSmall;
  }

  smallBodyById(id: string): SmallBodyElements | undefined {
    return this.smallBodies.find((s) => s.id === id);
  }

  getSatLook(id: number): SatLook | undefined {
    return this.satLooks.get(id);
  }

  select(o: SkyObject | null): void {
    this.selected = o;
    this.selectionPath = null;
    this.selectionPathProvider = null;
  }

  setSelectionPath(provider: (() => [number, number][] | null) | null): void {
    this.selectionPathProvider = provider;
    this.selectionPathKey = '';
    this.selectionPath = null;
  }

  get selection(): SkyObject | null {
    return this.selected;
  }

  setHover(o: SkyObject | null): void {
    this.hovered = o;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.getPixelRatio();
    this.overlay.resize(w, h, dpr);
    for (const l of this.lineSets) l.setResolution(w * dpr, h * dpr);
    this.stars.material.uniforms.uPixelRatio.value = dpr;
  }

  private ensureLandscape(site: SiteLocation): void {
    const key = `${site.id}:${site.horizon}`;
    if (key === this.landscapeKind) return;
    this.landscapeKind = key;
    if (this.landscape) {
      this.world.remove(this.landscape.object);
      this.landscape.dispose();
    }
    this.landscape = createLandscape(site.horizon, site.id === 'custom' ? 7 : site.id.length * 131);
    this.world.add(this.landscape.object);
  }

  /** Horizon silhouette altitude (deg) at an azimuth, or 0 without scenery. */
  horizonAltitude(az: number): number {
    if (!this.landscape || !this.getSettings().ground) return 0;
    const i = ((Math.round(az) % 360) + 360) % 360;
    return this.landscape.horizonProfile[i];
  }

  /** Current world direction for any object, or null. */
  directionOf(o: SkyObject): THREE.Vector3 | null {
    const f = this.frame;
    if (!f) return null;
    const m3 = this.matrix3;
    switch (o.kind) {
      case 'star': {
        const d = this.catalogs.stars.data;
        return this.apparent(new THREE.Vector3(d[o.index * 5], d[o.index * 5 + 1], d[o.index * 5 + 2]).applyMatrix3(m3));
      }
      case 'body':
        return this.bodyRenderer.worldDirs.get(o.id)?.clone() ?? null;
      case 'dso': {
        const d = this.dsoById.get(o.id);
        return d ? this.apparent(raDegDecToVec(d.ra, d.dec).applyMatrix3(m3)) : null;
      }
      case 'constellation': {
        const c = this.catalogs.constellations.find((x) => x.id === o.id);
        return c ? this.apparent(raDegDecToVec(c.label[0], c.label[1]).applyMatrix3(m3)) : null;
      }
      case 'smallbody': {
        const e = this.visibleSmall.find((x) => x.el.id === o.id);
        const st = e?.state ?? (() => {
          const el = this.smallBodyById(o.id);
          return el ? smallBodyState(el, f.astroTime, f.observer) : null;
        })();
        return st ? this.apparent(raDecToVec(st.ra, st.dec).applyMatrix3(m3)) : null;
      }
      case 'satellite': {
        const l = this.satLooks.get(o.noradId);
        return l ? altAzToWorld(l.alt + refraction(l.alt), l.az) : null;
      }
      case 'moonlet': {
        const j = f.bodies.get('Jupiter');
        if (!j) return null;
        const m = galileanMoons(f.astroTime).find((x) => x.name === o.name);
        if (!m) return null;
        const v = j.dirEqj.clone().multiplyScalar(j.distAU).add(m.offset).normalize().applyMatrix3(m3);
        return this.apparent(v);
      }
      case 'radiant': {
        const s = activeShowers(f.time).find((x) => x.shower.id === o.id);
        return s ? this.apparent(raDegDecToVec(s.radiantRa, s.radiantDec).applyMatrix3(m3)) : null;
      }
    }
  }

  private apparent(v: THREE.Vector3): THREE.Vector3 {
    v.normalize();
    if (!this.getSettings().refraction) return v;
    const { alt, az } = worldToAltAz(v);
    return altAzToWorld(alt + refraction(alt), az, v);
  }

  /** Screen position of a world direction (null when behind the camera). */
  project(dir: THREE.Vector3): { x: number; y: number; onScreen: boolean } | null {
    const p = dir.clone().multiplyScalar(1000).project(this.camera);
    if (p.z > 1 || p.z < -1) return null;
    const x = (p.x * 0.5 + 0.5) * this.width;
    const y = (-p.y * 0.5 + 0.5) * this.height;
    return { x, y, onScreen: x >= -20 && x <= this.width + 20 && y >= -20 && y <= this.height + 20 };
  }

  pixelsPerDegree(): number {
    return this.height / this.camera.fov;
  }

  // ================================================================== frame

  update(time: Date, site: SiteLocation, userSettings: Readonly<Settings>): FrameInfo {
    const settings = userSettings.stargaze ? stargazeSettings(userSettings) : userSettings;
    const now = performance.now();
    const dtMs = now - this.lastFrame;
    this.lastFrame = now;
    const simMs = time.getTime();
    const simDt = this.lastSimMs ? (simMs - this.lastSimMs) / 1000 : 0;
    this.lastSimMs = simMs;

    this.controls.update(dtMs);
    this.ensureLandscape(site);

    const astroTime = A.MakeTime(time);
    const observer = new A.Observer(site.lat, site.lon, site.elevation);
    eqjToWorld(astroTime, observer, this.matrix);
    this.matrix3.setFromMatrix4(this.matrix);
    this.celestial.matrix.copy(this.matrix);
    this.celestial.matrixWorldNeedsUpdate = true;
    const r = A.Rotation_EQD_HOR(astroTime, observer).rot;
    this.equatorOfDate.matrix.set(-r[0][1], -r[1][1], -r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, -r[0][0], -r[1][0], -r[2][0], 0, 0, 0, 0, 1);
    this.equatorOfDate.matrixWorldNeedsUpdate = true;
    if (settings.zodiacBand) {
      // ECT (true ecliptic of date) → EQJ → world, rotated back by the ayanamsa for the sidereal zodiac.
      const e = A.Rotation_ECT_EQJ(astroTime).rot;
      const ectToEqj = new THREE.Matrix4().set(e[0][0], e[1][0], e[2][0], 0, e[0][1], e[1][1], e[2][1], 0, e[0][2], e[1][2], e[2][2], 0, 0, 0, 0, 1);
      const shift = settings.zodiac === 'sidereal' ? ayanamsaValue(time, settings.ayanamsa) : 0;
      this.eclipticOfDate.matrix.copy(this.matrix).multiply(ectToEqj).multiply(new THREE.Matrix4().makeRotationZ(shift * DEG));
      this.eclipticOfDate.matrixWorldNeedsUpdate = true;
    }

    const bodies = computeAllBodies(astroTime, observer);
    const sun = bodies.get('Sun')!;
    const moon = bodies.get('Moon')!;
    const sunWorld = sun.dirEqj.clone().applyMatrix3(this.matrix3);
    const moonWorld = moon.dirEqj.clone().applyMatrix3(this.matrix3);
    const sunAlt = Math.asin(sunWorld.y) * RAD;
    const moonAlt = Math.asin(moonWorld.y) * RAD;

    const bortle = settings.bortleOverride ?? site.bortle;
    const sky = computeSkyBrightness({
      sunAlt,
      moonAlt,
      moonPhaseAngle: moon.phaseAngle,
      bortle,
      elevation: site.elevation,
      perfectSky: settings.perfectSky,
    });

    // Lunar eclipse: moonlight fades as the Moon enters Earth's shadow.
    const shadow = this.earthShadow(astroTime, observer);
    let moonDim = 1;
    if (shadow) {
      const sep = moonWorld.angleTo(shadow.dir);
      const mr = moon.angularRadius * DEG;
      const umbra = discOverlap(mr, shadow.umbra, sep);
      const penumbra = discOverlap(mr, shadow.penumbra, sep) - umbra;
      moonDim = Math.max(2e-4, 1 - umbra * 0.9998 - penumbra * 0.4);
    }
    sky.moonFlux *= moonDim;

    // Solar eclipse: dim the daylight by the fraction of the Sun covered.
    const moonSunSep = sunWorld.angleTo(moonWorld) * RAD;
    const obscuration = discOverlap(sun.angularRadius, moon.angularRadius, moonSunSep);
    const sunFlux = sky.sunFlux * Math.max(1 - obscuration, 0.00002);
    // Without an atmosphere nothing scatters: only the faint space background limits the stars.
    const total = settings.atmosphere ? sunFlux + sky.moonFlux + sky.lightPollution + sky.natural : sky.natural;
    const zenithMag = 22 - 2.5 * Math.log10(total);
    const skyLimit = 7.93 - 5 * Math.log10(Math.pow(10, 4.316 - zenithMag / 5) + 1);

    // Telescope-like gain when zoomed in, plus the user's boost.
    const fov = this.controls.fov;
    const zoomGain = THREE.MathUtils.clamp(2.3 * Math.log10(50 / fov), 0, 6.5);
    const limitingMag = Math.min(skyLimit + zoomGain + settings.starBoost, 14);
    // How bright the visible sky is: with the atmosphere off there is no daylight to fade things against.
    const daylight = settings.atmosphere ? THREE.MathUtils.smoothstep(sunFlux, magToFlux(12), magToFlux(6)) : 0;
    const skyDisplay = displayFromFlux(total);

    // ---- Atmosphere & Milky Way
    const dome = LIGHT_DOMES[site.id] ?? { az: 0, lobe: 0 };
    const worldToEqj = this.matrix3.clone().transpose();
    const mwVisible = settings.milkyWay ? 1 : 0;
    this.atmosphere.mesh.visible = true;
    this.atmosphere.update(this.renderer, {
      sunDir: sunWorld,
      moonDir: moonWorld,
      sunFlux: settings.atmosphere ? sunFlux : 0,
      moonFlux: settings.atmosphere ? sky.moonFlux : 0,
      lpFlux: settings.atmosphere ? sky.lightPollution : 0,
      naturalFlux: settings.atmosphere ? sky.natural : 0.3,
      milkyWayFlux: mwVisible * 13 * Math.pow(10, 0.4 * Math.min(settings.starBoost, 2) * 0.5),
      extinction: sky.extinction,
      worldToEqj,
      lpColor: new THREE.Color(1.0, 0.66, 0.4).lerp(new THREE.Color(0.55, 0.62, 0.85), THREE.MathUtils.clamp((6 - bortle) / 5, 0, 0.85)),
      lpAzDeg: dome.az,
      lpLobe: dome.lobe,
      observerKm: site.elevation / 1000,
      turbidity: settings.perfectSky ? 0.6 : 1 + Math.max(0, bortle - 4) * 0.12,
      nightVision: settings.nightVision,
      showGround: settings.ground,
      saturation: 0.8 + 0.45 * THREE.MathUtils.smoothstep(sunFlux / total, 0.25, 0.85) - 0.15 * daylight,
    });

    // ---- Stars & point-like objects share uniforms.
    const su = this.stars.material.uniforms;
    su.uLimitMag.value = limitingMag;
    su.uExtinction.value = settings.atmosphere && !settings.perfectSky ? sky.extinction : 0;
    su.uTime.value = now / 1000;
    su.uTwinkle.value = settings.twinkle && settings.atmosphere && fov > 3 ? 1 : 0;
    su.uSize.value = settings.starSize;
    su.uHideBelow.value = settings.ground ? 1 : 0;
    su.uRefraction.value = settings.refraction ? 1 : 0;
    su.uNightVision.value = settings.nightVision ? 1 : 0;
    su.uSkyDisplay.value = skyDisplay;
    for (const l of this.lineSets) l.setRefraction(settings.refraction);

    // ---- Planets as points (fading out as their discs resolve).
    this.planetPoints.begin();
    for (const [id, s] of bodies) {
      if (id === 'Sun' || id === 'Moon') continue;
      const px = BodyRenderer.pixelDiameter(s.angularRadius, fov, this.height, settings.bodyScale);
      const fade = THREE.MathUtils.smoothstep(px, 3, 9);
      const c = new THREE.Color(s.info.tint).convertSRGBToLinear();
      this.planetPoints.push(s.dirEqj, s.mag + fade * 3, c);
    }
    this.planetPoints.end();

    // ---- Resolved discs.
    this.bodyRenderer.update(
      {
        states: bodies,
        eqjToWorld: this.matrix,
        refraction: settings.refraction,
        daylight,
        scale: settings.bodyScale,
        nightVision: settings.nightVision,
        extinction: sky.extinction,
        eclipseObscuration: obscuration,
        moonDim,
        fov,
        shadow,
      },
      this.camera,
    );
    for (const [id, s] of bodies) {
      if (id === 'Sun' || id === 'Moon') continue;
      const px = BodyRenderer.pixelDiameter(s.angularRadius, fov, this.height, settings.bodyScale);
      this.bodyRenderer.setVisible(id, px > 2.5);
    }
    // The Sun (and in Stargaze, the Moon) can be switched off entirely.
    this.bodyRenderer.setVisible('Sun', settings.showSun);
    this.bodyRenderer.setGlowVisible('Sun', settings.showSun);
    if (settings.stargaze) {
      this.bodyRenderer.setVisible('Moon', false);
      this.bodyRenderer.setGlowVisible('Moon', false);
    }

    // ---- Jupiter's Galilean moons when zoomed in.
    this.moonletPoints.begin();
    const jup = bodies.get('Jupiter')!;
    if (fov < 8) {
      for (const m of galileanMoons(astroTime)) {
        const v = jup.dirEqj.clone().multiplyScalar(jup.distAU).add(m.offset).normalize();
        this.moonletPoints.push(v, 5.3 + 5 * Math.log10(jup.distAU / 4.2), new THREE.Color(1, 0.97, 0.92));
      }
    }
    this.moonletPoints.end();

    // ---- Comets & asteroids.
    this.updateSmallBodies(astroTime, observer, settings, simMs, limitingMag, now);

    // ---- Satellites.
    this.updateSatellites(time, site, settings, now);

    // ---- Meteors.
    if (settings.meteors && sunAlt < -10) {
      const sources: RadiantSource[] = [];
      for (const s of activeShowers(time)) {
        const dir = raDegDecToVec(s.radiantRa, s.radiantDec).applyMatrix3(this.matrix3).normalize();
        const rate = expectedHourlyRate(s.shower, time, site, skyLimit);
        if (rate > 0 && dir.y > 0) sources.push({ dir, hourlyRate: rate, speedKms: s.shower.speedKms });
      }
      const sporadic = 8 * Math.pow(2.5, Math.min(skyLimit, 6.5) - 6.5);
      this.meteors.update(sources, sporadic, Math.max(0, simDt), dtMs / 1000, skyLimit);
      this.meteors.lines.visible = true;
    } else this.meteors.lines.visible = false;
    this.meteors.material.uniforms.uNightVision.value = settings.nightVision ? 1 : 0;
    this.tails.material.uniforms.uNightVision.value = settings.nightVision ? 1 : 0;

    // ---- Landscape.
    if (this.landscape) {
      this.landscape.setVisible(settings.ground);
      const horizonCol = new THREE.Color().setScalar(displayFromFlux(total * 2.5));
      horizonCol.multiply(sunAlt > -8 ? new THREE.Color(0.8, 0.9, 1.1) : new THREE.Color(0.7, 0.8, 1.0));
      if (sky.lightPollution > sky.natural * 2) horizonCol.lerp(new THREE.Color(0.9, 0.7, 0.5).multiplyScalar(displayFromFlux(total * 3)), 0.5);
      this.landscape.update({
        sunDir: sunWorld,
        // With the Sun switched off the land lies in darkness too.
        sunAltDeg: settings.showSun ? sunAlt : -40,
        moonDir: moonWorld,
        moonIllum: moonAlt > 0 && !settings.stargaze ? moon.phase : 0,
        skyColorHorizon: horizonCol,
        nightVision: settings.nightVision,
        lightsOff: settings.stargaze,
        lightPollution: settings.stargaze ? 0 : THREE.MathUtils.clamp((bortle - 1) / 8, 0, 1) * (settings.perfectSky ? 0.2 : 1),
      });
    }

    this.recordTrails(bodies, simMs, settings.trails);

    // ---- Layer visibility.
    this.constellationLines.object.visible = settings.constellationLines;
    this.constellationLines.material.opacity = 0.5 * (1 - daylight * 0.75);
    this.constellationBounds.object.visible = settings.constellationBounds;
    this.gridAltAz.object.visible = settings.gridAltAz;
    this.gridEq.object.visible = settings.gridEquatorial;
    this.eclipticLine.object.visible = settings.ecliptic;
    this.meridianLine.object.visible = settings.meridian;
    this.zodiacBand.object.visible = settings.zodiacBand;
    this.horizonLine.object.visible = !settings.ground || settings.gridAltAz;

    this.frame = {
      time,
      astroTime,
      observer,
      site,
      bodies,
      sky: { ...sky, sunFlux, total, zenithMag, limitingMag: skyLimit },
      limitingMag,
      sunAlt,
      moonAlt,
      eqjToWorld: this.matrix,
      view: { az: this.controls.az, alt: this.controls.alt, fov },
    };

    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(settings, limitingMag, daylight);
    return this.frame;
  }

  /** Remember where the Sun, Moon and planets have been as time runs. */
  private recordTrails(bodies: Map<MajorBodyId, BodyState>, simMs: number, enabled: boolean): void {
    if (!enabled) {
      if (this.trails.size) this.trails.clear();
      return;
    }
    // A big jump (date picker, stepping by years) starts a fresh segment.
    const jump = Math.abs(simMs - this.lastTrailSim) > 45 * 86400e3;
    this.lastTrailSim = simMs;
    for (const [id, st] of bodies) {
      if (id === 'Pluto') continue;
      let segs = this.trails.get(id);
      if (!segs) this.trails.set(id, (segs = [[]]));
      if (jump && segs[segs.length - 1].length) segs.push([]);
      const seg = segs[segs.length - 1];
      const last = seg[seg.length - 1];
      if (!last || last.angleTo(st.dirEqj) > 0.12 * DEG) seg.push(st.dirEqj.clone());
      // Bound memory: ~2000 points per body.
      let total = segs.reduce((n, x) => n + x.length, 0);
      while (total > 2000) {
        segs[0].shift();
        if (!segs[0].length && segs.length > 1) segs.shift();
        total--;
      }
    }
  }

  clearTrails(): void {
    this.trails.clear();
  }

  private earthShadow(time: A.AstroTime, observer: A.Observer): { dir: THREE.Vector3; umbra: number; penumbra: number } | null {
    const moonGeo = A.GeoMoon(time);
    const sunGeo = A.GeoVector(A.Body.Sun, time, true);
    const m = new THREE.Vector3(moonGeo.x, moonGeo.y, moonGeo.z);
    const s = new THREE.Vector3(sunGeo.x, sunGeo.y, sunGeo.z);
    const dMoon = m.length();
    const dSun = s.length();
    const axis = s.clone().normalize().negate();
    // Quick reject: Moon far from the antisolar point.
    if (m.clone().normalize().angleTo(axis) > 2 * DEG) return null;
    const Re = 6378.137 * 1.02;
    const Rs = 695700;
    const x = dMoon * AU_KM;
    const umbraKm = Re - (x * (Rs - Re)) / (dSun * AU_KM);
    const penKm = Re + (x * (Rs + Re)) / (dSun * AU_KM);
    const obs = A.ObserverVector(time, observer, false);
    const center = axis.clone().multiplyScalar(dMoon).sub(new THREE.Vector3(obs.x, obs.y, obs.z));
    const dist = center.length() * AU_KM;
    return {
      dir: center.normalize().applyMatrix3(this.matrix3),
      umbra: Math.atan(umbraKm / dist),
      penumbra: Math.atan(penKm / dist),
    };
  }

  private updateSmallBodies(time: A.AstroTime, observer: A.Observer, settings: Readonly<Settings>, simMs: number, limitingMag: number, now: number): void {
    const show = settings.comets || settings.asteroids;
    if (!show || !this.smallBodies.length) {
      this.smallBodyPoints.begin();
      this.smallBodyPoints.end();
      this.tails.set([]);
      this.visibleSmall = [];
      return;
    }
    // Rescan the whole list occasionally; update the bright subset every frame.
    if (now - this.lastSmallScan > 4000 || Math.abs(simMs - this.lastSmallScanSim) > 86400000 * 2) {
      this.lastSmallScan = now;
      this.lastSmallScanSim = simMs;
      const list = this.smallBodies.filter((e) => (e.kind === 'comet' ? settings.comets : settings.asteroids));
      this.visibleSmall = brightComets(list, time, observer, 13.5)
        .filter((x) => !(x.el.kind === 'comet' && /SOHO|-[A-Z]\)?$|\/\d{4} [A-Z]\d+-[A-Z]/.test(x.el.name) && x.state.mag < 2 && x.state.r < 0.1))
        .slice(0, 40);
    } else {
      for (const e of this.visibleSmall) e.state = smallBodyState(e.el, time, observer);
    }
    this.smallBodyPoints.begin();
    const tails: TailSpec[] = [];
    for (const e of this.visibleSmall) {
      const s = e.state;
      const dir = raDecToVec(s.ra, s.dec);
      const isComet = e.el.kind === 'comet';
      this.smallBodyPoints.push(dir, s.mag + (isComet ? 0.4 : 0), isComet ? new THREE.Color(0.75, 1.0, 0.9) : new THREE.Color(1, 0.95, 0.85));
      if (isComet && s.tailLengthAU > 0.005 && s.mag < limitingMag + 1) {
        const head = dir.clone().applyMatrix3(this.matrix3).normalize();
        const g = new THREE.Vector3(s.geo.x, s.geo.y, s.geo.z);
        const t = new THREE.Vector3(s.tailDir.x, s.tailDir.y, s.tailDir.z);
        const tipIon = g.clone().addScaledVector(t, s.tailLengthAU).normalize().applyMatrix3(this.matrix3).normalize();
        const tipDust = g.clone().addScaledVector(t, s.tailLengthAU * 0.7).normalize().applyMatrix3(this.matrix3).normalize();
        const brightness = THREE.MathUtils.clamp(Math.pow(10, -0.4 * (s.mag - limitingMag)) * 0.03, 0, 0.9);
        if (brightness < 0.01) continue;
        const side = new THREE.Vector3().crossVectors(head, tipDust).cross(head).normalize();
        const lenDeg = head.angleTo(tipIon) * RAD;
        tails.push({ head, tip: tipIon, widthDeg: Math.max(0.05, lenDeg * 0.04), brightness: brightness * 0.8, color: new THREE.Color(0.55, 0.75, 1.0) });
        tails.push({ head, tip: tipDust, widthDeg: Math.max(0.08, lenDeg * 0.1), brightness, color: new THREE.Color(1.0, 0.95, 0.82), curve: side });
      }
    }
    this.smallBodyPoints.end();
    this.tails.set(tails);
  }

  private updateSatellites(time: Date, site: SiteLocation, settings: Readonly<Settings>, now: number): void {
    this.satPoints.begin();
    if (!settings.satellites || !this.satellites.length) {
      this.satPoints.end();
      this.satLooks.clear();
      return;
    }
    // Full refresh ~10×/s is plenty for smooth motion at real time.
    if (now - this.lastSatUpdate > 90) {
      this.lastSatUpdate = now;
      const dark = observerInDarkness(time, site);
      this.satLooks.clear();
      for (const s of this.satellites) {
        if (!s.featured && !dark) continue;
        const l = satelliteLook(s, time, site);
        if (l && l.alt > -5) this.satLooks.set(s.noradId, l);
      }
    }
    for (const s of this.satellites) {
      const l = this.satLooks.get(s.noradId);
      if (!l || !l.sunlit || l.alt < 0) continue;
      this.satPoints.push(altAzToWorld(l.alt, l.az), l.mag, new THREE.Color(1, 0.97, 0.9));
    }
    this.satPoints.end();
  }

  // ================================================================ overlay

  private drawOverlay(settings: Readonly<Settings>, limitingMag: number, daylight: number): void {
    const o = this.overlay;
    o.nightVision = settings.nightVision;
    o.begin();
    const f = this.frame!;
    const m3 = this.matrix3;
    const fov = this.controls.fov;
    const v = new THREE.Vector3();
    const labelAlpha = 1 - daylight * 0.35;
    const aboveGround = (dir: THREE.Vector3) => {
      if (!settings.ground) return true;
      const { alt, az } = worldToAltAz(dir);
      return alt > this.horizonAltitude(az) - 0.2;
    };

    // Cardinal points on the horizon.
    if (settings.cardinals) {
      CARDINALS.forEach((c, i) => {
        const az = i * 45;
        const p = this.project(altAzToWorld(Math.max(0.6, this.horizonAltitude(az) * 0.3), az));
        if (p?.onScreen)
          o.label({
            x: p.x,
            y: p.y,
            text: c,
            color: c === 'N' ? '#ff8a7a' : '#cfd8e6',
            font: `${c.length === 1 ? 700 : 600} ${c.length === 1 ? 17 : 13}px ${FONT_STACK}`,
            align: 'center',
            priority: 100,
            force: true,
            dy: -4,
            alpha: c.length === 1 ? 0.95 : 0.7,
          });
      });
    }

    // Constellation names.
    if (settings.constellationNames) {
      for (const c of this.catalogs.constellations) {
        if (c.rank > (fov < 40 ? 3 : fov < 80 ? 2 : 1) && fov > 25) continue;
        raDegDecToVec(c.label[0], c.label[1], v).applyMatrix3(m3);
        if (!aboveGround(v)) continue;
        const p = this.project(v);
        if (!p?.onScreen) continue;
        o.label({
          x: p.x,
          y: p.y,
          text: c.name.toUpperCase(),
          color: '#7fa3d9',
          font: `500 ${fov < 20 ? 13 : 11}px ${FONT_STACK}`,
          spacing: 2.2,
          align: 'center',
          priority: 10 - c.rank,
          alpha: 0.75 * labelAlpha,
        });
      }
    }

    // Deep-sky objects: fewer and subtler when zoomed out.
    if (settings.deepSky) {
      const magCut = fov > 60 ? 6.2 : fov > 30 ? 7.6 : fov > 10 ? 9.5 : 12;
      const ppd = this.pixelsPerDegree();
      for (const d of this.catalogs.dso) {
        const mag = d.mag ?? 11;
        if (mag > magCut && !(d.messier && fov < 45)) continue;
        if (fov > 40 && !d.messier && mag > 5) continue;
        if (d.type === 'dn' && fov > 15) continue;
        raDegDecToVec(d.ra, d.dec, v).applyMatrix3(m3);
        if (v.y < -0.05 || !aboveGround(v)) continue;
        const p = this.project(v);
        if (!p?.onScreen) continue;
        const size = Math.max(4, Math.min(fov > 30 ? 26 : 90, (d.dim[0] / 60) * ppd * 0.5));
        const kind = dsoSymbol(d.type);
        o.symbol({ x: p.x, y: p.y, kind, size, color: '#b58cff', alpha: 0.42 * labelAlpha, aspect: d.dim[1] && d.dim[0] ? d.dim[1] / d.dim[0] : 0.5 });
        if (d.messier || d.name) {
          const text = d.messier ? (d.name && fov < 60 ? `${d.id.replace(' ', '')} ${d.name}` : d.id.replace(' ', '')) : d.name;
          o.label({ x: p.x, y: p.y, dx: Math.min(size, 26) + 3, dy: 4, text, color: '#c9adff', font: `500 11px ${FONT_STACK}`, priority: 20 - mag, alpha: 0.7 * labelAlpha });
        }
      }
    }

    // Star names.
    if (settings.starNames) {
      const magCut = Math.min(limitingMag - 0.5, fov > 90 ? 1.6 : fov > 50 ? 2.3 : fov > 20 ? 3.4 : fov > 5 ? 5 : 7);
      const d = this.catalogs.stars.data;
      for (const s of this.namedStars) {
        if (s.mag > magCut) break;
        v.set(d[s.index * 5], d[s.index * 5 + 1], d[s.index * 5 + 2]).applyMatrix3(m3);
        if (!aboveGround(v)) continue;
        const pv = this.apparent(v.clone());
        const p = this.project(pv);
        if (!p?.onScreen) continue;
        o.label({ x: p.x, y: p.y, dx: 7, dy: -5, text: s.name, color: '#e6ecf5', font: `500 12px ${FONT_STACK}`, priority: 40 - s.mag, alpha: 0.85 * labelAlpha });
      }
    }

    // Sun, Moon & planets.
    if (settings.planetLabels) {
      for (const [id, s] of f.bodies) {
        if (id === 'Pluto' && fov > 5) continue;
        const dir = this.bodyRenderer.worldDirs.get(id);
        if (!dir) continue;
        const visible = id === 'Sun' || id === 'Moon' || s.mag < limitingMag || settings.labelFaint;
        if (!visible || !aboveGround(dir)) continue;
        const p = this.project(dir);
        if (!p?.onScreen) continue;
        const rpx = (BodyRenderer.pixelDiameter(s.angularRadius, fov, this.height, id === 'Sun' ? 1 : settings.bodyScale) / 2);
        o.label({
          x: p.x,
          y: p.y,
          dx: Math.max(8, rpx + 6),
          dy: -Math.max(6, rpx * 0.6),
          text: s.info.name,
          color: id === 'Sun' ? '#ffd27a' : id === 'Moon' ? '#f4f1e8' : '#ffcf8a',
          font: `600 13px ${FONT_STACK}`,
          priority: 90,
        });
      }
    }

    // Jupiter's moons.
    if (fov < 8) {
      const jup = f.bodies.get('Jupiter')!;
      for (const m of galileanMoons(f.astroTime)) {
        const dir = this.apparent(jup.dirEqj.clone().multiplyScalar(jup.distAU).add(m.offset).normalize().applyMatrix3(m3));
        const p = this.project(dir);
        if (p?.onScreen) o.label({ x: p.x, y: p.y, dx: 6, dy: 14, text: m.name, color: '#d8d2c4', font: `500 11px ${FONT_STACK}`, priority: 60 });
      }
    }

    // Comets & asteroids.
    for (const e of this.visibleSmall) {
      if (e.state.mag > limitingMag + 0.5 && !settings.labelFaint) continue;
      const dir = this.apparent(raDecToVec(e.state.ra, e.state.dec).applyMatrix3(m3));
      if (!aboveGround(dir)) continue;
      const p = this.project(dir);
      if (!p?.onScreen) continue;
      const comet = e.el.kind === 'comet';
      o.label({ x: p.x, y: p.y, dx: 8, dy: 12, text: comet ? shortCometName(e.el.name) : e.el.name, color: comet ? '#8ff0d0' : '#e8d9b8', font: `500 11px ${FONT_STACK}`, priority: comet ? 55 - e.state.mag : 30 - e.state.mag });
    }

    // Satellites: featured ones always labelled when up.
    if (settings.satellites) {
      for (const s of this.satellites) {
        const l = this.satLooks.get(s.noradId);
        if (!l || l.alt < 0) continue;
        if (!s.featured && !(l.sunlit && fov < 40)) continue;
        const p = this.project(altAzToWorld(l.alt + refraction(l.alt), l.az));
        if (!p?.onScreen) continue;
        if (s.featured) o.symbol({ x: p.x, y: p.y, kind: 'diamond', size: 6, color: l.sunlit ? '#7ee0ff' : '#5a7890', alpha: 0.9 });
        o.label({ x: p.x, y: p.y, dx: 9, dy: -6, text: s.featured ? (l.sunlit ? s.name : `${s.name} · in shadow`) : s.name, color: s.featured ? '#8fe6ff' : '#9fb4c8', font: `${s.featured ? 600 : 500} ${s.featured ? 12 : 10}px ${FONT_STACK}`, priority: s.featured ? 85 : 15 });
      }
    }

    // Meteor shower radiants.
    if (settings.meteors) {
      for (const s of activeShowers(f.time)) {
        if (s.zhr < 2) continue;
        raDegDecToVec(s.radiantRa, s.radiantDec, v).applyMatrix3(m3);
        if (!aboveGround(v)) continue;
        const p = this.project(v);
        if (!p?.onScreen) continue;
        o.symbol({ x: p.x, y: p.y, kind: 'radiant', size: 11, color: '#ffb36b', alpha: 0.8 });
        o.label({ x: p.x, y: p.y, dx: 14, dy: 4, text: `${s.shower.name} radiant`, color: '#ffc58f', font: `500 11px ${FONT_STACK}`, priority: 50 });
      }
    }

    // Zodiac sign glyphs along the band (symbolic signs, not the constellations).
    if (settings.zodiacBand) {
      const m = this.eclipticOfDate.matrix;
      for (let k = 0; k < 12; k++) {
        const lon = (k * 30 + 15) * DEG;
        const lat = 4.5 * DEG;
        v.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)).applyMatrix4(m).normalize();
        if (!aboveGround(v)) continue;
        const p = this.project(v);
        if (!p?.onScreen) continue;
        o.label({ x: p.x, y: p.y, text: SIGN_GLYPHS[k], color: ELEMENT_COLORS[k % 4], font: `400 20px ${FONT_STACK}`, align: 'center', priority: 70, alpha: 0.85 * labelAlpha });
        o.label({ x: p.x, y: p.y, dy: 14, text: SIGN_NAMES[k].toUpperCase(), color: '#d9c2ff', font: `600 9px ${FONT_STACK}`, spacing: 1.5, align: 'center', priority: 69, alpha: 0.6 * labelAlpha });
      }
    }

    // Motion trails against the stars.
    if (settings.trails) {
      for (const [id, segs] of this.trails) {
        const tint = f.bodies.get(id)?.info.tint ?? '#ffffff';
        for (const seg of segs) {
          const pts: [number, number][] = [];
          for (const e of seg) {
            const w = v.copy(e).applyMatrix3(m3);
            if (settings.ground && w.y < -0.02) {
              if (pts.length > 1) o.path(pts.splice(0), tint, 1.6, undefined, 0.55);
              pts.length = 0;
              continue;
            }
            const p = this.project(w);
            if (p) pts.push([p.x, p.y]);
          }
          if (pts.length > 1) o.path(pts, tint, 1.6, undefined, 0.55);
        }
      }
    }

    // Selection path (e.g. a satellite's track) and reticle.
    if (this.selectionPathProvider) {
      const key = `${f.site.id}:${f.site.lat}:${f.site.lon}:${Math.floor(f.time.getTime() / 60e3)}`;
      if (key !== this.selectionPathKey) {
        this.selectionPathKey = key;
        this.selectionPath = this.selectionPathProvider();
      }
    }
    if (this.selectionPath) {
      const pts: [number, number][] = [];
      for (const [alt, az] of this.selectionPath) {
        const p = this.project(altAzToWorld(alt, az));
        if (p) pts.push([p.x, p.y]);
      }
      o.path(pts, '#7ee0ff', 1.5, [4, 4], 0.75);
    }
    for (const [obj, hover] of [[this.selected, false], [this.hovered, true]] as const) {
      if (!obj || (hover && sameObject(obj, this.selected))) continue;
      const dir = this.directionOf(obj);
      if (!dir) continue;
      const p = this.project(dir);
      if (!p) continue;
      let r = 14;
      if (obj.kind === 'body') {
        const s = f.bodies.get(obj.id)!;
        r = Math.max(14, BodyRenderer.pixelDiameter(s.angularRadius, fov, this.height, obj.id === 'Sun' ? 1 : settings.bodyScale) / 2 + 8);
      }
      o.symbol({ x: p.x, y: p.y, kind: 'reticle', size: r, color: hover ? '#9fb4c8' : '#ffd479', alpha: hover ? 0.6 : 0.95 });
    }

    o.draw();
  }

  // ================================================================ picking

  /** Find the most relevant object near a screen point. */
  pick(x: number, y: number, radius = 22): SkyObject | null {
    const f = this.frame;
    if (!f) return null;
    const s = this.getSettings();
    const m3 = this.matrix3;
    const lm = f.limitingMag;
    let best: { o: SkyObject; score: number } | null = null;
    const consider = (o: SkyObject, dir: THREE.Vector3 | null, weight: number, extraR = 0) => {
      if (!dir) return;
      const p = this.project(dir);
      if (!p) return;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > radius + extraR) return;
      const score = d - weight - extraR;
      if (!best || score < best.score) best = { o, score };
    };
    for (const [id, st] of f.bodies) {
      const vis = id === 'Sun' || id === 'Moon' || st.mag < lm + 1 || s.labelFaint;
      if (!vis) continue;
      const rpx = BodyRenderer.pixelDiameter(st.angularRadius, this.camera.fov, this.height, id === 'Sun' ? 1 : s.bodyScale) / 2;
      consider({ kind: 'body', id }, this.bodyRenderer.worldDirs.get(id) ?? null, 12, rpx);
    }
    for (const e of this.visibleSmall) {
      if (e.state.mag > lm + 1 && !s.labelFaint) continue;
      consider({ kind: 'smallbody', id: e.el.id }, this.apparent(raDecToVec(e.state.ra, e.state.dec).applyMatrix3(m3)), 8);
    }
    for (const sat of this.satellites) {
      const l = this.satLooks.get(sat.noradId);
      if (!l || l.alt < 0 || (!sat.featured && !l.sunlit)) continue;
      consider({ kind: 'satellite', noradId: sat.noradId }, altAzToWorld(l.alt + refraction(l.alt), l.az), sat.featured ? 10 : 4);
    }
    if (this.camera.fov < 8) {
      for (const m of galileanMoons(f.astroTime)) consider({ kind: 'moonlet', name: m.name }, this.directionOf({ kind: 'moonlet', name: m.name }), 6);
    }
    // Stars: brightest first; only those actually drawn.
    const d = this.catalogs.stars.data;
    const v = new THREE.Vector3();
    const n = this.catalogs.stars.count;
    for (let i = 0; i < n; i++) {
      const mag = d[i * 5 + 3];
      if (mag > lm) break;
      v.set(d[i * 5], d[i * 5 + 1], d[i * 5 + 2]).applyMatrix3(m3);
      if (s.ground && v.y < -0.02) continue;
      const p = v.clone().multiplyScalar(1000).project(this.camera);
      if (p.z > 1) continue;
      const px = (p.x * 0.5 + 0.5) * this.width;
      const py = (-p.y * 0.5 + 0.5) * this.height;
      if (Math.abs(px - x) > radius || Math.abs(py - y) > radius) continue;
      consider({ kind: 'star', index: i }, this.apparent(v.clone()), Math.max(0, (lm - mag) * 1.6));
    }
    if (s.deepSky) {
      for (const dso of this.catalogs.dso) {
        if ((dso.mag ?? 11) > (this.camera.fov > 30 ? 8 : 12) && !dso.messier) continue;
        consider({ kind: 'dso', id: dso.id }, this.apparent(raDegDecToVec(dso.ra, dso.dec).applyMatrix3(m3)), dso.messier ? 5 : 2);
      }
    }
    if (s.meteors) {
      for (const sh of activeShowers(f.time)) consider({ kind: 'radiant', id: sh.shower.id }, this.directionOf({ kind: 'radiant', id: sh.shower.id }), 3);
    }
    if (!best && s.constellationNames) {
      // Fall back to the constellation containing the point.
      const dir = this.controls.screenToWorld(x, y);
      if (dir) {
        const eq = dir.clone().applyMatrix3(m3.clone().transpose());
        const ra = ((Math.atan2(eq.y, eq.x) * RAD) / 15 + 24) % 24;
        const dec = Math.asin(eq.z) * RAD;
        const c = A.Constellation(ra, dec);
        return { kind: 'constellation', id: c.symbol };
      }
    }
    return (best as { o: SkyObject } | null)?.o ?? null;
  }

  starName(index: number): string {
    return starDisplayName(this.catalogs.stars.meta.get(index), (c) => this.constellationGenitive.get(c) ?? c);
  }

  starColor(index: number): THREE.Color {
    return bvToColor(this.catalogs.stars.data[index * 5 + 4]);
  }
}

function discOverlap(r1: number, r2: number, d: number): number {
  // Fraction of disc 1 (radius r1) covered by disc 2, all in the same units.
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r2 - r1)) return r2 >= r1 ? 1 : (r2 * r2) / (r1 * r1);
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return (a + b - c) / (Math.PI * r1 * r1);
}

function dsoSymbol(type: string): 'circle' | 'dashed-circle' | 'ellipse' | 'square' | 'plus' {
  switch (type) {
    case 'gc':
      return 'plus';
    case 'oc':
    case 'pos':
      return 'dashed-circle';
    case 's':
    case 's0':
    case 'e':
    case 'i':
    case 'g':
    case 'gg':
      return 'ellipse';
    case 'pn':
      return 'circle';
    default:
      return 'square';
  }
}

export function shortCometName(name: string): string {
  // "C/2025 R2 (SWAN)" → "C/2025 R2 SWAN"; "12P/Pons-Brooks" stays.
  return name.replace(/\s*\(([^)]+)\)/, ' $1');
}

/**
 * Stargaze: every source of light removed — no sunlight, moonlight or city
 * glow, no labels or guides — so the stars shine as they would from the
 * darkest place on Earth. Constellation figures and names remain the
 * user's choice.
 */
function stargazeSettings(s: Readonly<Settings>): Settings {
  // Constellation figures and names stay as the user sets them (quick toggles).
  return {
    ...s,
    atmosphere: false,
    perfectSky: true,
    showSun: false,
    milkyWay: true,
    twinkle: true,
    starBoost: Math.max(s.starBoost, 0.8),
    starNames: false,
    planetLabels: false,
    deepSky: false,
    cardinals: false,
    zodiacBand: false,
    trails: false,
    gridAltAz: false,
    gridEquatorial: false,
    ecliptic: false,
    meridian: false,
    satellites: false,
    nightVision: false,
  };
}
