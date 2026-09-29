import { h } from '../ui/dom';

export interface GlossaryTerm {
  id: string;
  term: string;
  /** Other spellings matched in lesson text (case-insensitive, whole words). */
  aliases?: string[];
  def: string;
}

export const GLOSSARY: GlossaryTerm[] = [
  { id: 'celestial-sphere', term: 'Celestial sphere', def: 'The imaginary dome on which the sky seems painted, centred on you. Real objects lie at wildly different distances, but for finding your way the sphere is a perfect map.' },
  { id: 'horizon', term: 'Horizon', def: 'The great circle where the sky meets the ground (the "mathematical" horizon is perfectly level; the real one has hills). Only the half of the sky above it is visible.' },
  { id: 'altitude', term: 'Altitude', def: 'Height above the horizon in degrees: 0° on the horizon, 90° straight overhead. A fist held at arm’s length covers about 10°.' },
  { id: 'azimuth', term: 'Azimuth', def: 'Compass direction measured clockwise from north in degrees: north 0°, east 90°, south 180°, west 270°.' },
  { id: 'zenith', term: 'Zenith', aliases: ['zenith'], def: 'The point directly overhead (altitude 90°). Its opposite, straight down, is the nadir.' },
  { id: 'meridian', term: 'Meridian', def: 'The line across the sky from due north through the zenith to due south. Every star is highest when it crosses (transits) your meridian.' },
  { id: 'celestial-pole', term: 'Celestial pole', aliases: ['celestial poles', 'north celestial pole'], def: 'The points in the sky directly above Earth’s North and South Poles. The whole sky appears to turn around them; Polaris sits within 1° of the north one.' },
  { id: 'celestial-equator', term: 'Celestial equator', def: 'Earth’s equator projected onto the sky. It divides the sky into northern and southern halves and rises due east and sets due west.' },
  { id: 'declination', term: 'Declination', def: 'The sky’s version of latitude: degrees north (+) or south (−) of the celestial equator. Fixed for a star, unlike altitude.' },
  { id: 'right-ascension', term: 'Right ascension', def: 'The sky’s version of longitude, usually measured in hours (0h–24h) eastward from the March equinox point. With declination it gives a star’s fixed address.' },
  { id: 'ecliptic', term: 'Ecliptic', def: 'The Sun’s apparent yearly path around the sky — really the plane of Earth’s orbit. The Moon and planets always stay near it.' },
  { id: 'zodiac', term: 'Zodiac', def: 'The band of sky about 8° either side of the ecliptic, where the Sun, Moon and planets travel. Traditionally divided into 12 signs of 30° each.' },
  { id: 'equinox', term: 'Equinox', aliases: ['equinoxes'], def: 'The two moments a year (around 20 March and 22 September) when the Sun crosses the celestial equator; day and night are roughly equal everywhere.' },
  { id: 'solstice', term: 'Solstice', aliases: ['solstices'], def: 'The two moments a year (around 21 June and 21 December) when the Sun reaches its farthest north or south, giving the longest and shortest days.' },
  { id: 'precession', term: 'Precession', def: 'The slow wobble of Earth’s axis, like a spinning top, taking about 25,800 years per circle. It drags the equinox points backwards along the zodiac by 1° every ~72 years.' },
  { id: 'tropical', term: 'Tropical zodiac', aliases: ['tropical'], def: 'The zodiac of Western astrology: 12 equal signs counted from the March equinox point (0° Aries), tied to the seasons rather than to the stars.' },
  { id: 'sidereal', term: 'Sidereal', aliases: ['sidereal day', 'sidereal zodiac'], def: 'Measured against the stars. A sidereal day (23 h 56 min) is one turn of Earth relative to the stars; a sidereal zodiac (used in Vedic astrology) keeps its signs aligned with the constellations.' },
  { id: 'ayanamsa', term: 'Ayanamsa', def: 'The angle between the tropical and sidereal zodiacs, caused by precession — currently about 24° (Lahiri value). It grows by ~1° every 72 years.' },
  { id: 'constellation', term: 'Constellation', aliases: ['constellations'], def: 'One of 88 officially defined regions of the sky, each named after the traditional star pattern within it. Every point in the sky belongs to exactly one.' },
  { id: 'asterism', term: 'Asterism', aliases: ['asterisms'], def: 'A recognisable star pattern that is not an official constellation — the Big Dipper (part of Ursa Major) and the Summer Triangle are asterisms.' },
  { id: 'magnitude', term: 'Magnitude', aliases: ['apparent magnitude', 'magnitudes'], def: 'The astronomer’s brightness scale, and it runs backwards: smaller is brighter. Each step is 2.5× in brightness; 5 steps is exactly 100×. Vega is about 0, the faintest naked-eye stars about 6.' },
  { id: 'limiting-magnitude', term: 'Limiting magnitude', def: 'The faintest magnitude you can see from a given place and time. About 6.5 under a truly dark sky, 3–4 in a city.' },
  { id: 'light-year', term: 'Light-year', aliases: ['light-years', 'ly'], def: 'The distance light travels in a year: about 9.46 trillion km. A star 600 light-years away is seen as it was 600 years ago.' },
  { id: 'au', term: 'AU', aliases: ['astronomical unit', 'astronomical units'], def: 'Astronomical unit: the average Earth–Sun distance, about 149.6 million km (8.3 light-minutes).' },
  { id: 'spectral-class', term: 'Spectral class', aliases: ['spectral type'], def: 'A star’s type by its spectrum and temperature: O (hottest, blue) B A F G K M (coolest, red). The Sun is a G star at about 5,800 K.' },
  { id: 'kelvin', term: 'Kelvin', aliases: ['K'], def: 'Temperature scale starting at absolute zero; a step of 1 K equals 1 °C. The Sun’s surface is ~5,800 K.' },
  { id: 'conjunction', term: 'Conjunction', aliases: ['conjunctions'], def: 'When two bodies appear close together in the sky (or share the same ecliptic longitude). A planet “in conjunction with the Sun” is hidden in its glare.' },
  { id: 'opposition', term: 'Opposition', def: 'When a planet is opposite the Sun in our sky: it rises at sunset, is up all night, and is closest and brightest. Only planets beyond Earth’s orbit have oppositions.' },
  { id: 'elongation', term: 'Elongation', def: 'The angle between a planet and the Sun as seen from Earth. Mercury and Venus never stray far; their greatest elongations are the best times to see them.' },
  { id: 'retrograde', term: 'Retrograde', aliases: ['retrograde motion'], def: 'The apparent backward (westward) drift of a planet against the stars, seen when Earth overtakes it (or it overtakes us). The planet never really reverses.' },
  { id: 'synodic-month', term: 'Synodic month', aliases: ['lunar month'], def: 'The 29.5 days from one new Moon to the next — a little longer than the Moon’s 27.3-day orbit, because Earth has moved around the Sun meanwhile.' },
  { id: 'waxing', term: 'Waxing & waning', aliases: ['waxing', 'waning'], def: 'Waxing: the lit part of the Moon growing night by night, from new Moon to full. Waning: shrinking again, from full back to new.' },
  { id: 'terminator', term: 'Terminator', def: 'The line between day and night on the Moon or a planet. Craters near it cast long shadows and look most dramatic.' },
  { id: 'libration', term: 'Libration', def: 'A slow apparent rocking of the Moon, caused by its tilted, elliptical orbit. Over time it lets us see about 59% of the lunar surface rather than 50%.' },
  { id: 'tidal-locking', term: 'Tidal locking', aliases: ['tidally locked'], def: 'When a moon’s spin has been slowed by tides until it turns once per orbit, keeping one face towards its planet.' },
  { id: 'umbra', term: 'Umbra', def: 'The dark inner part of a shadow, where the light source is completely blocked. The Moon inside Earth’s umbra is a total lunar eclipse.' },
  { id: 'penumbra', term: 'Penumbra', def: 'The pale outer part of a shadow, where the light source is only partly blocked. A penumbral lunar eclipse is a barely visible dimming.' },
  { id: 'node', term: 'Node', aliases: ['nodes'], def: 'The two points where the Moon’s tilted orbit crosses the ecliptic. Eclipses only happen when a new or full Moon falls near a node.' },
  { id: 'parallax', term: 'Parallax', def: 'The shift in a nearby object’s position when seen from two places — hold up a finger and blink each eye. Stars shift slightly as Earth orbits, which is how their distances were first measured.' },
  { id: 'rayleigh', term: 'Rayleigh scattering', aliases: ['scattering', 'scattered'], def: 'Scattering of light by air molecules, much stronger for blue than red. It makes the daytime sky blue and bright and sunsets red.' },
  { id: 'twilight', term: 'Twilight', def: 'The glow after sunset and before sunrise. Civil twilight: Sun 0–6° below the horizon (bright enough to read). Nautical: 6–12° (horizon fades, bright stars out). Astronomical: 12–18° (last trace of glow). Below 18° the sky is fully dark.' },
  { id: 'dark-adaptation', term: 'Dark adaptation', aliases: ['dark-adapt', 'dark-adapted'], def: 'Your eyes’ slow switch to night vision: pupils widen in seconds, but the retina’s rod cells need 20–30 minutes of darkness to reach full sensitivity. White light resets it; dim red light mostly does not.' },
  { id: 'averted-vision', term: 'Averted vision', def: 'Looking slightly to one side of a faint object so its light falls on the more sensitive rod cells away from the centre of your retina. Faint galaxies and nebulae can appear twice as bright.' },
  { id: 'light-pollution', term: 'Light pollution', def: 'Artificial light scattered by the atmosphere into a glowing sky, drowning faint stars. It is measured by the Bortle scale.' },
  { id: 'bortle', term: 'Bortle scale', aliases: ['Bortle'], def: 'A 1–9 rating of night-sky darkness by John Bortle (2001). Class 1–2: pristine, the Milky Way casts shadows. Class 4: rural/suburban. Class 8–9: city, only bright stars.' },
  { id: 'milky-way', term: 'Milky Way', def: 'Our galaxy — about 100–200 billion stars in a flat disc ~100,000 light-years across. From inside the disc we see it edge-on as a glowing band around the sky.' },
  { id: 'galaxy', term: 'Galaxy', aliases: ['galaxies'], def: 'A vast gravitationally bound system of stars, gas and dark matter. The Andromeda Galaxy, 2.5 million light-years away, is the farthest thing easily visible to the eye.' },
  { id: 'nebula', term: 'Nebula', aliases: ['nebulae', 'nebulas'], def: 'A cloud of gas and dust in space. Some glow where young stars energise them (the Orion and Lagoon Nebulae); others are dark lanes blocking the light behind.' },
  { id: 'globular-cluster', term: 'Globular cluster', aliases: ['globular clusters'], def: 'A dense ball of hundreds of thousands of very old stars orbiting a galaxy, such as M13 in Hercules.' },
  { id: 'open-cluster', term: 'Open cluster', aliases: ['open clusters'], def: 'A loose family of young stars born together from one cloud, like the Pleiades.' },
  { id: 'transit', term: 'Transit', def: 'A star or planet crossing your meridian (its highest point in the sky) — or a planet crossing the face of the Sun.' },
  { id: 'circumpolar', term: 'Circumpolar', def: 'Close enough to the celestial pole that it never sets. At Mariposa (latitude 37.5°) any star within 37.5° of the north celestial pole is circumpolar.' },
];

const BY_ID = new Map(GLOSSARY.map((t) => [t.id, t]));

// One regex over every spelling, longest first so "limiting magnitude" wins over "magnitude".
const SPELLINGS: [string, string][] = GLOSSARY.flatMap((t) => [t.term, ...(t.aliases ?? [])].map((s) => [s, t.id] as [string, string]))
  // Single-letter and two-letter abbreviations are too ambiguous to auto-link except "AU".
  .filter(([s]) => s.length > 2 || s === 'AU')
  .sort((a, b) => b[0].length - a[0].length);
const LOOKUP = new Map(SPELLINGS.map(([s, id]) => [s.toLowerCase(), id]));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERN = new RegExp(`(?<![\\w-])(${SPELLINGS.map(([s]) => esc(s)).join('|')})(?![\\w-])`, 'gi');

let uid = 0;

/**
 * Converts plain text to nodes, turning the first mention of each glossary
 * term (per `seen` set) into a button with an accessible definition.
 * Supports **bold** and *italic* for emphasis.
 */
export function glossify(text: string, seen: Set<string> = new Set()): DocumentFragment {
  const frag = document.createDocumentFragment();
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      frag.append(h('strong', {}, glossify(part.slice(2, -2), seen)));
      continue;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      frag.append(h('em', {}, part.slice(1, -1)));
      continue;
    }
    let last = 0;
    PATTERN.lastIndex = 0;
    for (let m = PATTERN.exec(part); m; m = PATTERN.exec(part)) {
      const word = m[1];
      // "AU" must be upper-case to avoid linking other words.
      const id = word === 'AU' || word.toLowerCase() !== 'au' ? LOOKUP.get(word.toLowerCase()) : undefined;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      frag.append(part.slice(last, m.index), termButton(word, BY_ID.get(id)!));
      last = m.index + word.length;
    }
    frag.append(part.slice(last));
  }
  return frag;
}

/** An inline term: hover, focus or tap shows its definition. */
export function termButton(label: string, t: GlossaryTerm): HTMLElement {
  const id = `gloss-def-${++uid}`;
  const btn = h('button', { type: 'button', class: 'gloss-term', 'aria-describedby': id, 'aria-expanded': 'false' }, label);
  const def = h('span', { id, class: 'sr-only' }, `${t.term}: ${t.def}`);
  const wrap = h('span', { class: 'gloss-wrap' }, btn, def);
  btn.addEventListener('mouseenter', () => showPop(btn, t));
  btn.addEventListener('mouseleave', () => hidePopSoon());
  btn.addEventListener('focus', () => showPop(btn, t));
  btn.addEventListener('blur', () => hidePop());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    // A tap focuses (showing the popover) and then clicks: don't let the click undo it.
    if (current === btn && performance.now() - shownAt > 400) hidePop();
    else showPop(btn, t);
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current === btn) {
      e.stopPropagation();
      hidePop();
    }
  });
  return wrap;
}

// ---------------------------------------------------------------- shared popover

let pop: HTMLElement | null = null;
let current: HTMLElement | null = null;
let hideTimer = 0;
let shownAt = 0;

function popEl(): HTMLElement {
  if (pop) return pop;
  // Lives on <body>: a backdrop-filter ancestor would trap position:fixed.
  pop = h('div', { class: 'gloss-pop', 'aria-hidden': 'true' });
  pop.addEventListener('mouseenter', () => window.clearTimeout(hideTimer));
  pop.addEventListener('mouseleave', () => hidePopSoon());
  document.body.append(pop);
  document.addEventListener('pointerdown', (e) => {
    if (current && !(e.target as HTMLElement).closest('.gloss-term, .gloss-pop')) hidePop();
  });
  window.addEventListener('resize', () => hidePop());
  return pop;
}

function showPop(btn: HTMLElement, t: GlossaryTerm): void {
  window.clearTimeout(hideTimer);
  const el = popEl();
  if (current !== btn) shownAt = performance.now();
  current?.setAttribute('aria-expanded', 'false');
  current = btn;
  btn.setAttribute('aria-expanded', 'true');
  el.replaceChildren(h('div', { class: 'gloss-pop-term' }, t.term), h('div', { class: 'gloss-pop-def' }, t.def));
  el.classList.add('show');
  const r = btn.getBoundingClientRect();
  const w = Math.min(300, window.innerWidth - 24);
  el.style.width = `${w}px`;
  const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
  el.style.left = `${left}px`;
  const ph = el.offsetHeight;
  const above = r.top - ph - 10;
  el.style.top = `${above > 8 ? above : r.bottom + 10}px`;
}

function hidePopSoon(): void {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hidePop, 180);
}

export function hidePop(): void {
  window.clearTimeout(hideTimer);
  pop?.classList.remove('show');
  current?.setAttribute('aria-expanded', 'false');
  current = null;
}
