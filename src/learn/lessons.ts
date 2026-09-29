import * as A from 'astronomy-engine';
import type { App } from '../app';
import type { Lesson } from './types';
import type { LessonContext } from './runtime';
import { findStar, bodyPathEqj, localDay, zonedDate } from './runtime';
import { worldToAltAz } from '../astro/frames';
import type { MajorBodyId } from '../astro/solarsystem';

// ------------------------------------------------------------------ helpers

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const PLANETS: MajorBodyId[] = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
const SIDEREAL_DAY = 86164.0905e3;

const frameTime = (app: App) => app.frame?.time ?? new Date();

function observer(app: App): A.Observer {
  const s = app.getSite();
  return new A.Observer(s.lat, s.lon, s.elevation);
}

function starAlt(app: App, name: string): number | null {
  const o = findStar(app, name);
  const d = o && app.view.directionOf(o);
  return d ? worldToAltAz(d).alt : null;
}

function starMeta(app: App, name: string) {
  const o = findStar(app, name);
  return o && o.kind === 'star' ? app.catalogs.stars.meta.get(o.index) : undefined;
}

/** "the light left it around 1530" from a catalogue distance. */
function lightLeft(app: App, name: string, fallbackLy: number): string {
  const ly = starMeta(app, name)?.distLy ?? fallbackLy;
  const year = new Date().getFullYear() - ly;
  const rounded = ly > 60 ? Math.round(year / 10) * 10 : Math.round(year);
  const lyText = ly > 60 ? Math.round(ly / 10) * 10 : ly < 10 ? ly.toFixed(1) : Math.round(ly);
  return `about ${lyText.toLocaleString()} light-years away, so the light entering your eye tonight left it around the year ${rounded}`;
}

/** Local sunset on the local day containing `t`. */
function sunsetOn(app: App, t: Date): Date {
  const tz = app.getSite().timeZone;
  const [y, m, d] = localDay(t.getTime(), tz);
  const start = zonedDate(tz, y, m, d, 11, 0);
  return A.SearchRiseSet(A.Body.Sun, observer(app), -1, start, 1)?.date ?? zonedDate(tz, y, m, d, 18, 30);
}

function sunriseOn(app: App, t: Date): Date {
  const tz = app.getSite().timeZone;
  const [y, m, d] = localDay(t.getTime(), tz);
  const start = zonedDate(tz, y, m, d, 0, 0);
  return A.SearchRiseSet(A.Body.Sun, observer(app), +1, start, 1)?.date ?? zonedDate(tz, y, m, d, 6, 30);
}

/** Next new Moon at least `minDays` from now. */
/** The next new Moon (so the lesson's month lies ahead of today). */
function nextNewMoon(): Date {
  return A.SearchMoonPhase(0, new Date(), 40)?.date ?? new Date();
}

function moonPhaseAfter(phase: number, after: Date): Date {
  return A.SearchMoonPhase(phase, after, 40)?.date ?? new Date(after.getTime() + (phase / 360) * 29.53 * 86400e3);
}

function planetsUp(app: App): { id: MajorBodyId; alt: number; mag: number }[] {
  const out: { id: MajorBodyId; alt: number; mag: number }[] = [];
  for (const id of PLANETS) {
    const d = app.view.directionOf({ kind: 'body', id });
    const st = app.frame?.bodies.get(id);
    if (!d || !st) continue;
    const { alt } = worldToAltAz(d);
    if (alt > 4) out.push({ id, alt, mag: st.mag });
  }
  return out.sort((a, b) => a.mag - b.mag);
}

function listWords(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function sunConstellation(t: Date): string {
  const v = A.GeoVector(A.Body.Sun, t, true);
  const eq = A.EquatorFromVector(v);
  return A.Constellation(eq.ra, eq.dec).name;
}

function tropicalSign(t: Date): { sign: string; deg: number } {
  const lon = A.SunPosition(t).elon;
  return { sign: SIGNS[Math.floor(lon / 30) % 12], deg: Math.floor(lon % 30) };
}

async function animate(ctx: LessonContext, start: number, end: number, stepMs: number, tickMs: number, pauseAtEndMs = 1500): Promise<void> {
  await ctx.setTime(start);
  let t = start;
  let hold = 0;
  ctx.every(tickMs, () => {
    if (hold > 0) {
      hold -= tickMs;
      if (hold <= 0) t = start - stepMs;
      else return;
    }
    t += stepMs;
    if (t > end) {
      t = end;
      hold = pauseAtEndMs;
    }
    ctx.app.time.setTime(t);
  });
}

// Fixed moments used by several lessons (local wall-clock at the observing site).
const SUMMER_NIGHT = (ctx: LessonContext) => ctx.local(2027, 7, 3, 23, 30); // new Moon, galactic centre on the meridian
const WINTER_NIGHT = (ctx: LessonContext) => ctx.local(2027, 1, 8, 21, 0); // new Moon, Orion high
const SPRING_NIGHT = (ctx: LessonContext) => ctx.local(2027, 5, 6, 21, 45); // new Moon, Big Dipper overhead
const ECLIPSE_PEAK = Date.UTC(2026, 2, 3, 11, 33, 40); // total lunar eclipse, 3 March 2026
const MARS_OPPOSITION_NIGHT = (ctx: LessonContext) => ctx.local(2027, 2, 19, 23, 30); // Mars at opposition, high in the south

// ------------------------------------------------------------------ lessons

export const LESSONS: Lesson[] = [
  // 1 -------------------------------------------------------------------
  {
    id: 'sphere',
    title: 'The sky around you',
    blurb: 'Horizon, altitude and azimuth, the zenith, the meridian — and why Polaris tells you your latitude.',
    minutes: 5,
    icon: 'sphere',
    steps: [
      {
        title: 'You stand at the centre',
        settings: { atmosphere: true, ground: true, cardinals: true, gridAltAz: false, meridian: false, constellationLines: true, constellationNames: true },
        text: [
          'Look around: the sky behaves like a great dome — the **celestial sphere** — with you at its exact centre. The stars really lie at hugely different distances, but for finding your way the dome is a perfect map.',
          'The ground hides the lower half of that sphere. The line where sky meets land is your **horizon**, and the letters N, E, S and W along it mark the compass points.',
        ],
        reflection: 'An old Hermetic saying calls the divine “a sphere whose centre is everywhere and whose circumference is nowhere.” Every observer stands at the centre of their own sky.',
        action: async (ctx) => {
          await ctx.setTime(ctx.tonight(22));
          ctx.look(16, 180, 95);
        },
      },
      {
        title: 'Altitude and azimuth',
        settings: { gridAltAz: true },
        text: [
          'Two numbers pin down any point on your sky. **Altitude** is height above the horizon: 0° on the horizon, 90° straight up. **Azimuth** is the compass direction, counted clockwise from north: east is 90°, south 180°, west 270°.',
          'The grid now drawn on the sky shows both. A handy ruler: your fist held at arm’s length covers about 10°, a finger about 1°.',
        ],
        action: async (ctx) => {
          await ctx.setTime(ctx.tonight(22));
          ctx.look(30, 135, 100);
        },
      },
      {
        title: 'Zenith and meridian',
        settings: { gridAltAz: true, meridian: true },
        text: [
          'The point directly overhead is the **zenith**. The line running from due north, through the zenith, down to due south is your **meridian**.',
          'Every star, and the Sun and Moon, climbs highest exactly when it crosses the meridian — astronomers call this its **transit**. The Sun’s transit is true local noon.',
        ],
        action: async (ctx) => {
          await ctx.setTime(ctx.tonight(22));
          ctx.look(62, 180, 110);
        },
      },
      {
        title: 'Polaris gives your latitude',
        settings: { gridAltAz: true, meridian: false },
        text: (app) => {
          const alt = starAlt(app, 'Polaris');
          const site = app.getSite();
          return [
            'Face north. Polaris, the North Star, sits within 1° of the **celestial pole** — the point in the sky directly above Earth’s North Pole — so it barely moves while everything else turns around it.',
            `Here is a beautiful fact: the altitude of the pole equals your latitude. At ${site.name}, latitude ${site.lat.toFixed(1)}°, Polaris stands ${alt != null ? `${alt.toFixed(1)}°` : 'about as many degrees'} above the horizon. Sailors used exactly this to find their way.`,
          ];
        },
        reflection: 'The whole sky wheels around one still point. The ancients saw in it an image of the unmoving centre within — the quiet around which the busy mind turns.',
        action: async (ctx) => {
          await ctx.setTime(ctx.tonight(22));
          const p = ctx.star('Polaris');
          if (p) ctx.flyTo(p, 70);
        },
      },
      {
        title: 'Your turn',
        settings: { gridAltAz: false },
        text: [
          'Drag the sky to look around, and scroll or pinch to zoom. Tap any star or planet to see what it is, how far away it is and when it rises and sets.',
          'The grid, meridian and other guides live in the Sky layers panel — or press Z for the altitude/azimuth grid at any time.',
        ],
        action: async (ctx) => {
          await ctx.setTime(ctx.tonight(22));
          ctx.look(30, 200, 90);
        },
      },
    ],
  },

  // 2 -------------------------------------------------------------------
  {
    id: 'daystars',
    title: 'Why the stars vanish by day',
    blurb: 'Switch off the air at noon and see the stars and planets that are hidden behind the sunlight.',
    minutes: 4,
    icon: 'sun',
    steps: [
      {
        title: 'Midday',
        settings: { atmosphere: true, ground: true, constellationLines: true, constellationNames: true },
        text: [
          'It is just after noon today. The sky is a bright, even blue and not a single star is visible.',
          'Yet the stars have not gone anywhere. They are above you right now, in exactly the places the sky map predicts. So where are they?',
        ],
        action: async (ctx) => {
          await ctx.setTime(ctx.today(12, 30));
          ctx.mark(null);
          ctx.look(38, 180, 100);
        },
      },
      {
        title: 'The sky is lit-up air',
        text: [
          'Sunlight passing through the atmosphere bumps into air molecules and is **scattered** in every direction — blue light far more than red (**Rayleigh scattering**). The whole dome of air glows, and that glow *is* the blue sky.',
          'That glowing air is roughly ten million times brighter than the dark night sky between the stars. A star’s tiny point of light has nothing left to stand out against.',
        ],
        action: async (ctx) => {
          await ctx.setTime(ctx.today(12, 30));
          ctx.look(30, 150, 100);
        },
      },
      {
        title: 'Switch off the atmosphere',
        settings: { atmosphere: false },
        text: (app) => {
          const up = planetsUp(app).map((p) => p.id);
          const con = sunConstellation(frameTime(app));
          return [
            'We have removed Earth’s air — the view you would have standing on the Moon, where the sky is black even at noon. Same moment, same place: only the scattered light is gone.',
            `Now the daytime stars appear, right around the Sun. The Sun itself sits in front of the constellation ${con}.${up.length ? ` ${listWords(up)} ${up.length > 1 ? 'are' : 'is'} above the horizon too, invisible in daylight.` : ''}`,
          ];
        },
        reflection: 'The stars never leave; they are only outshone. So too the inner light — not absent in the glare of the day’s business, simply unseen until the outer brilliance is quieted.',
        action: async (ctx) => {
          await ctx.setTime(ctx.today(12, 30));
          const sun = ctx.body('Sun');
          ctx.flyTo(sun, 95, { mark: false });
        },
      },
      {
        title: 'The stars come out',
        settings: { atmosphere: true },
        text: [
          'The air is back. Now we have jumped to about 50 minutes after sunset: the Sun is below the horizon, the air above you is no longer sunlit, and the brightest stars and planets reappear first, then fainter ones as twilight deepens.',
          'We say the stars “come out” — but they were there all day. It is the sunlit air that goes away.',
        ],
        reflection: 'Night is not the arrival of the stars but the withdrawal of the Sun. Stillness does not create the inner light; it reveals what was always shining.',
        action: async (ctx) => {
          const set = sunsetOn(ctx.app, ctx.today(12));
          await ctx.setTime(set.getTime() + 50 * 60e3);
          ctx.look(20, 250, 100);
        },
      },
    ],
  },

  // 3 -------------------------------------------------------------------
  {
    id: 'rotation',
    title: 'Earth turns: the daily wheel',
    blurb: 'Speed up time and watch the whole sky circle Polaris — then learn why the stars shift with the seasons.',
    minutes: 4,
    icon: 'spin',
    steps: [
      {
        title: 'Rising in the east',
        settings: { atmosphere: true, ground: true, constellationLines: true },
        text: [
          'Earth spins from west to east once a day. Standing on it we don’t feel the motion — instead the whole sky seems to turn the other way. The Sun, Moon and stars rise in the east and set in the west.',
          'Time is running at 10 minutes per second: watch stars climb out of the eastern horizon.',
        ],
        action: async (ctx) => {
          await ctx.setTime(ctx.tonight(21), 600);
          ctx.mark(null);
          ctx.look(18, 90, 95);
        },
      },
      {
        title: 'The wheel around Polaris',
        settings: { atmosphere: false, gridEquatorial: false },
        text: [
          'Now face north. We have switched off the daylight so you can watch a whole turn, at one hour per second. Every star circles Polaris — anticlockwise as you face north — because Polaris sits almost exactly on Earth’s spin axis.',
          'Stars close to Polaris never dip below the horizon: they are **circumpolar**, visible every clear night of the year.',
        ],
        reflection: 'Earth turns, and we say the heavens move. Much of what seems to change “out there” is the motion of the one who watches.',
        action: async (ctx) => {
          await ctx.setTime(ctx.tonight(21), 3600);
          const p = ctx.star('Polaris');
          if (p) ctx.flyTo(p, 105, { mark: true });
        },
      },
      {
        title: 'Four minutes a day',
        settings: { atmosphere: false },
        text: [
          'Earth spins once relative to the stars every 23 h 56 min — a **sidereal** day. Our 24-hour day is a little longer because Earth also moves along its orbit, so it must turn a bit extra to bring the Sun back.',
          'So each star rises about four minutes earlier every night: two hours a month, a full circle in a year. Here the clock stays at 9 pm while the dates race by — watch the constellations march westward through the seasons.',
        ],
        action: async (ctx) => {
          const start = ctx.tonight(21).getTime();
          await animate(ctx, start, start + 365 * 86400e3, 2 * 86400e3, 140);
          ctx.mark(null);
          ctx.look(35, 180, 105);
        },
      },
      {
        title: 'Drive time yourself',
        settings: { atmosphere: true },
        spotlight: '.timebar',
        text: [
          'The time bar is your time machine. ▶ plays and pauses; the arrows run time faster, slower or backwards (keys [ and ]); the step buttons jump by an hour, a day, a sidereal day, a lunar month or more. The Now button (N) always brings you home.',
          'Try stepping by one sidereal day: the stars stay put while the Moon and planets move.',
        ],
        action: async (ctx) => {
          await ctx.setTime(ctx.tonight(22), 0);
        },
      },
    ],
  },

  // 4 -------------------------------------------------------------------
  {
    id: 'zodiac',
    title: 'The ecliptic & the zodiac',
    blurb: 'The Sun’s yearly road, the 13 constellations it crosses, and why signs and constellations no longer match.',
    minutes: 6,
    icon: 'zodiac',
    steps: [
      {
        title: 'The Sun’s yearly road',
        settings: { atmosphere: false, ecliptic: true, constellationLines: true, constellationNames: true, constellationBounds: false },
        text: (app) => [
          'As Earth orbits the Sun, we see the Sun from a slowly changing angle, so it creeps eastward against the background stars — about 1° (two Sun-widths) a day, a full circle a year. Its path is the **ecliptic**, the gold line.',
          `We have switched off the daylight again. Today the Sun stands in front of the stars of ${sunConstellation(frameTime(app))}.`,
        ],
        action: async (ctx) => {
          await ctx.setTime(ctx.today(12));
          ctx.flyTo(ctx.body('Sun'), 90, { mark: true });
        },
      },
      {
        title: 'Thirteen constellations',
        settings: { atmosphere: false, ecliptic: true, constellationBounds: true },
        text: [
          'Follow the Sun for a few months (one day every tick; the camera follows it). The dotted outlines are the official **constellation** borders, set by astronomers in 1930.',
          'The ecliptic crosses 13 of them: Pisces, Aries, Taurus, Gemini, Cancer, Leo, Virgo, Libra, Scorpius, **Ophiuchus**, Sagittarius, Capricornus and Aquarius. They are very unequal: the Sun spends about 45 days in Virgo but only about a week in Scorpius.',
        ],
        action: async (ctx) => {
          const start = ctx.today(12).getTime();
          await animate(ctx, start, start + 120 * 86400e3, 86400e3, 160, 2500);
          ctx.track(ctx.body('Sun'));
          ctx.flyTo(ctx.body('Sun'), 80, { mark: true });
        },
      },
      {
        title: 'Signs and constellations',
        settings: { atmosphere: false, ecliptic: true, constellationBounds: true },
        text: (app) => {
          const t = frameTime(app);
          const s = tropicalSign(t);
          return [
            'Western astrology uses the **tropical zodiac**: twelve equal 30° signs counted from the March **equinox** — the point where the Sun crosses the celestial equator heading north. It follows the seasons, not the stars.',
            `Today the Sun is at ${s.deg}° ${s.sign} in the tropical zodiac, but the constellation behind it is ${sunConstellation(t)}. When the system was set down, about 2,000 years ago, signs and constellations roughly matched. Since then they have slipped apart by about 24° — the **ayanamsa**, which sidereal (Vedic) astrology corrects for.`,
          ];
        },
        action: async (ctx) => {
          await ctx.setTime(ctx.today(12));
          ctx.flyTo(ctx.body('Sun'), 70, { mark: true });
        },
      },
      {
        title: 'Precession: the Great Year',
        settings: { atmosphere: true, ecliptic: false, constellationBounds: false, gridEquatorial: true },
        text: [
          'Why the slip? Earth’s axis wobbles like a spinning top, tracing a circle every ~25,800 years. This **precession** slides the equinox points backwards along the zodiac by 1° every 72 years.',
          'It also moves the pole. Polaris is the pole star only for now: when the pyramids were built the pole lay near Thuban in Draco, and around the year 14,000 bright Vega will be close to it. The blue grid shows today’s celestial equator and pole.',
        ],
        reflection: 'Plato called the full cycle the Great Year. Even the “fixed” stars are in motion — the heavens keep a patience measured in millennia.',
        action: async (ctx) => {
          await ctx.setTime(ctx.tonight(22));
          const p = ctx.star('Polaris');
          if (p) ctx.flyTo(p, 90, { mark: true });
        },
      },
      {
        title: 'Ophiuchus, the thirteenth',
        settings: { atmosphere: false, ecliptic: true, constellationBounds: true, gridEquatorial: false },
        text: (app) => [
          `We have jumped to ${new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', timeZone: app.getSite().timeZone }).format(frameTime(app))}. The Sun is now in ${sunConstellation(frameTime(app))} — the Serpent Bearer, which the ecliptic crosses from about 29 November to 17 December.`,
          'Ophiuchus was never one of the twelve signs, because the signs were made equal slices of 30° rather than following the constellation borders. It is not a “new” sign; it simply shows that the signs and the star patterns are two different systems.',
        ],
        reflection: 'The Serpent Bearer is Asclepius, the healer, holding the serpent — the thirteenth figure standing quietly on the path between the signs.',
        action: async (ctx) => {
          const [y] = localDay(Date.now(), ctx.tz);
          await ctx.setTime(ctx.local(y, 12, 8, 12, 0));
          ctx.flyTo(ctx.body('Sun'), 60, { mark: true });
        },
      },
    ],
  },

  // 5 -------------------------------------------------------------------
  {
    id: 'moon',
    title: 'The Moon’s phases',
    blurb: 'Follow a lunar month from thin crescent to full and back — and see why we always see the same face.',
    minutes: 6,
    icon: 'moon',
    steps: [
      {
        title: 'A ball in sunlight',
        settings: { atmosphere: true, ground: true, planetLabels: true },
        text: [
          'The Moon makes no light of its own. The Sun always lights exactly half of it; the **phases** are simply how much of that sunlit half faces us as the Moon circles Earth.',
          'Here is the evening sky three days after new Moon: a thin crescent low in the west after sunset, its lit side pointing down toward the Sun that has just set.',
        ],
        action: async (ctx) => {
          const nm = nextNewMoon();
          const day = new Date(nm.getTime() + 3 * 86400e3);
          await ctx.setTime(sunsetOn(ctx.app, day).getTime() + 40 * 60e3);
          ctx.flyTo(ctx.body('Moon'), 14, { mark: false });
        },
      },
      {
        title: 'First quarter',
        text: [
          'A week after new Moon the Moon is a quarter of the way around its orbit, 90° from the Sun. We see half the disc lit — confusingly called “first quarter”. At sunset it is high in the south.',
          'Look along the **terminator**, the line between lunar day and night: there the shadows are longest and craters stand out best in binoculars.',
        ],
        action: async (ctx) => {
          const fq = moonPhaseAfter(90, nextNewMoon());
          await ctx.setTime(sunsetOn(ctx.app, fq).getTime() + 30 * 60e3);
          ctx.flyTo(ctx.body('Moon'), 4, { mark: false });
        },
      },
      {
        title: 'Full Moon',
        text: [
          'Two weeks in, the Moon is on the far side of Earth from the Sun, so we see its whole sunlit face. A full Moon rises in the east as the Sun sets in the west, and is up all night.',
          'Each day the Moon moves about 13° east against the stars, so it rises roughly 50 minutes later every day.',
        ],
        reflection: 'The Moon has no light of its own; it only reflects. In Hermetic imagery it is the soul, waxing and waning as it turns toward or away from the Sun — while the source itself never dims.',
        action: async (ctx) => {
          const fm = moonPhaseAfter(180, nextNewMoon());
          await ctx.setTime(sunsetOn(ctx.app, fm).getTime() + 25 * 60e3);
          ctx.flyTo(ctx.body('Moon'), 30, { mark: false });
        },
      },
      {
        title: 'Waning',
        text: [
          'After full, the lit part shrinks from the other side — the Moon is **waning**. A last-quarter Moon rises around midnight and is high in the south at sunrise, often visible in the morning blue sky.',
          'Then a thinning crescent in the dawn, a day or two lost in the Sun’s glare at new Moon, and the cycle starts again: 29.5 days, the **synodic month**.',
        ],
        action: async (ctx) => {
          const lq = moonPhaseAfter(270, nextNewMoon());
          await ctx.setTime(sunriseOn(ctx.app, lq).getTime() - 20 * 60e3);
          ctx.flyTo(ctx.body('Moon'), 5, { mark: false });
        },
      },
      {
        title: 'A month in half a minute',
        settings: { atmosphere: false, ground: false },
        text: [
          'Now the camera is locked on the Moon (ground and air removed) while four hours pass every tick. Watch the phases roll by — and notice the craters and dark “seas” always face us.',
          'That is **tidal locking**: Earth’s tides long ago slowed the Moon’s spin until it turned exactly once per orbit. The slight rocking you may notice is **libration**, which over a month lets us peek at about 59% of the surface.',
        ],
        action: async (ctx) => {
          const nm = nextNewMoon();
          const start = nm.getTime() + 1.5 * 86400e3;
          await animate(ctx, start, start + 28 * 86400e3, 4 * 3600e3, 150, 1500);
          ctx.flyTo(ctx.body('Moon'), 1.3, { mark: false });
          ctx.track(ctx.body('Moon'));
        },
      },
    ],
  },

  // 6 -------------------------------------------------------------------
  {
    id: 'planets',
    title: 'Planets & retrograde loops',
    blurb: 'The “wandering stars”, why they hug the ecliptic, and Mars looping backwards through Leo in 2027.',
    minutes: 6,
    icon: 'planet',
    steps: [
      {
        title: 'The wanderers',
        settings: { atmosphere: true, ground: true, planetLabels: true, ecliptic: false },
        text: (app) => {
          const up = planetsUp(app);
          const names = up.map((p) => p.id);
          return [
            'The Greeks noticed five “stars” that didn’t keep their places but wandered among the others: *planētēs*, wanderers. They are Mercury, Venus, Mars, Jupiter and Saturn — worlds of our own solar system, shining by reflected sunlight.',
            names.length
              ? `Tonight at 9:30 pm, ${listWords(names)} ${names.length > 1 ? 'are' : 'is'} above the horizon${up[0] ? `; we are looking at ${up[0].id}` : ''}. Planets usually shine steadily while stars twinkle, because a planet is a tiny disc rather than a point.`
              : 'None of the bright planets is well placed at 9:30 pm tonight — they are near the Sun in the daytime sky. Planets usually shine steadily while stars twinkle, because a planet is a tiny disc rather than a point.',
          ];
        },
        action: async (ctx) => {
          await ctx.setTime(ctx.tonight(21, 30));
          const up = planetsUp(ctx.app);
          if (up[0]) ctx.flyTo(ctx.body(up[0].id), 40, { mark: true });
          else ctx.look(25, 230, 90);
        },
      },
      {
        title: 'A flat solar system',
        settings: { ecliptic: true },
        text: [
          'The planets all orbit the Sun in nearly the same plane, so from Earth they — and the Moon — always appear close to the **ecliptic**, the gold line. When you see a bright “star” near that line that isn’t on your chart, it is probably a planet.',
        ],
        action: async (ctx) => {
          await ctx.setTime(ctx.tonight(21, 30));
          const up = planetsUp(ctx.app);
          if (up[0]) ctx.flyTo(ctx.body(up[0].id), 100, { mark: true });
          else ctx.look(25, 230, 100);
        },
      },
      {
        title: 'Mars goes backwards',
        settings: { atmosphere: false, ecliptic: true, constellationLines: true, constellationNames: true },
        text: [
          'Watch Mars (circled) from December 2026 to June 2027. Each tick advances one sidereal day, so the stars stay fixed and only the planets move. The dashed line is Mars’s path.',
          'Normally Mars drifts eastward (left) through the stars. But from 12 January to 3 April 2027 it stops, runs backwards through Leo past the bright star Regulus, stops again and resumes. This is **retrograde** motion.',
        ],
        action: async (ctx) => {
          const t0 = MARS_OPPOSITION_NIGHT(ctx).getTime();
          await ctx.setTime(t0);
          ctx.flyTo(ctx.body('Mars'), 55, { mark: true });
          ctx.guide(bodyPathEqj(A.Body.Mars, new Date(Date.UTC(2026, 10, 20)), new Date(Date.UTC(2027, 5, 10))));
          await ctx.wait(1800);
          if (ctx.cancelled) return;
          await animate(ctx, t0 - 80 * SIDEREAL_DAY, t0 + 105 * SIDEREAL_DAY, SIDEREAL_DAY, 150, 2500);
        },
      },
      {
        title: 'Why the loop?',
        settings: { atmosphere: false, ecliptic: true },
        text: [
          'Mars never actually reverses. Earth, on its faster inside track, overtakes Mars — just as a slow car seems to slip backwards against the distant hills as you pass it on the highway. The Solar System view (O) shows the two orbits.',
          'The overtaking happens at **opposition**, when Mars is opposite the Sun: on 19 February 2027 it rises at sunset, is up all night and is at its brightest — though this is a distant opposition, about 101 million km (0.68 **AU**) away.',
        ],
        reflection: 'Retrograde is a trick of perspective: nothing reverses — the watcher is simply moving faster. What looks like a setback may be the view from a passing orbit.',
        action: async (ctx) => {
          await ctx.setTime(MARS_OPPOSITION_NIGHT(ctx));
          ctx.flyTo(ctx.body('Mars'), 30, { mark: true });
          ctx.guide(bodyPathEqj(A.Body.Mars, new Date(Date.UTC(2026, 10, 20)), new Date(Date.UTC(2027, 5, 10))));
        },
      },
    ],
  },

  // 7 -------------------------------------------------------------------
  {
    id: 'darksky',
    title: 'Light pollution & dark skies',
    blurb: 'Mariposa, Sacramento and Glacier Point on the same moonless night — plus how to protect your night vision.',
    minutes: 5,
    icon: 'city',
    steps: [
      {
        title: 'A rural sky: Mariposa',
        location: 'mariposa',
        settings: { atmosphere: true, ground: true, milkyWay: true, perfectSky: false, bortleOverride: null, nightVision: false },
        text: (app) => [
          'A moonless July night, 11:30 pm, looking south toward the heart of the Milky Way. Mariposa is class 3 on the **Bortle scale** (1 = pristine, 9 = inner city): the Milky Way is obvious, with a glow of the Central Valley low in the southwest.',
          `The faintest stars visible here now are about magnitude ${(app.frame?.limitingMag ?? 6.3).toFixed(1)} — thousands of stars across the sky.`,
        ],
        action: async (ctx) => {
          await ctx.setTime(SUMMER_NIGHT(ctx));
          ctx.mark(null);
          ctx.look(28, 170, 95);
        },
      },
      {
        title: 'A city sky: Sacramento',
        location: 'sacramento',
        text: (app) => [
          'Same night, same direction, about 180 km away. Streetlights and buildings send light upward, where the air scatters it back down as a dull orange glow — **light pollution**. Sacramento is about Bortle 8.',
          `The **limiting magnitude** drops to about ${(app.frame?.limitingMag ?? 4).toFixed(1)}: only the bright stars and planets survive, and the Milky Way is gone. Nearly 80% of North Americans can no longer see it from home.`,
        ],
        action: async (ctx) => {
          await ctx.setTime(SUMMER_NIGHT(ctx));
          ctx.look(28, 170, 95);
          await ctx.wait(300);
          await ctx.waitFrame();
        },
      },
      {
        title: 'A high, dark sky: Glacier Point',
        location: 'glacier-point',
        text: (app) => [
          'Now 2,199 m up above Yosemite Valley, about an hour from Mariposa. Class 2 darkness, and a quarter of the atmosphere is below you, so stars near the horizon dim less.',
          `Limiting magnitude about ${(app.frame?.limitingMag ?? 6.8).toFixed(1)}. On nights like this the Milky Way shows dark dust lanes and even casts a faint glow on the ground.`,
        ],
        action: async (ctx) => {
          await ctx.setTime(SUMMER_NIGHT(ctx));
          ctx.look(28, 170, 95);
          await ctx.wait(300);
          await ctx.waitFrame();
        },
      },
      {
        title: 'The perfect sky',
        location: 'glacier-point',
        settings: { perfectSky: true },
        text: [
          'Perfect sky (key P) removes all artificial light and the dimming of the air: the sky every human saw until about 150 years ago.',
          'You can help bring it back: shielded, downward-pointing, warm-coloured outdoor lights, switched off when not needed. DarkSky International certifies dark-sky parks and communities.',
        ],
        action: async (ctx) => {
          await ctx.setTime(SUMMER_NIGHT(ctx));
          ctx.look(28, 170, 95);
        },
      },
      {
        title: 'Protect your night eyes',
        location: 'mariposa',
        settings: { perfectSky: false, nightVision: true },
        text: [
          'Your pupils open in seconds, but the retina’s rod cells need 20–30 minutes of darkness to reach full sensitivity — **dark adaptation**. One glance at a white phone screen undoes much of it.',
          'Night vision mode (R) turns this app red, which rods barely respond to. Outside, try **averted vision**: look slightly to one side of a faint object and it appears brighter, because the rods are concentrated away from the centre of your gaze.',
        ],
        reflection: 'Seeing in the dark cannot be hurried; the eye must first forget the glare. The contemplative traditions describe the same patience — the inner light becomes visible as the outer lights are dimmed, one by one.',
        action: async (ctx) => {
          await ctx.setTime(SUMMER_NIGHT(ctx));
          ctx.look(28, 170, 95);
        },
      },
    ],
  },

  // 8 -------------------------------------------------------------------
  {
    id: 'starlight',
    title: 'Star colours, brightness & distance',
    blurb: 'Red Betelgeuse and blue Rigel, the backwards magnitude scale, and light that left before you were born.',
    minutes: 6,
    icon: 'star',
    steps: [
      {
        title: 'Orion’s two giants',
        settings: { atmosphere: true, ground: true, constellationLines: true, constellationNames: true, starNames: true },
        text: [
          'A January evening, facing Orion. Look at his shoulder, Betelgeuse (top left), and his knee, Rigel (bottom right). One is orange-red, the other blue-white.',
          'Star colour is temperature. Like metal in a forge, a cooler star glows red and a hotter one white or blue. Astronomers sort stars by **spectral class**: O, B, A, F, G, K, M, from hottest to coolest.',
        ],
        action: async (ctx) => {
          await ctx.setTime(WINTER_NIGHT(ctx));
          ctx.flyTo(ctx.constellation('Ori'), 38, { mark: false });
        },
      },
      {
        title: 'Betelgeuse, the red supergiant',
        text: (app) => [
          `Betelgeuse is a class M red supergiant with a surface of about 3,600 **kelvin** — cooler than the Sun’s 5,800 K. It is so swollen that, put in place of the Sun, it would swallow the orbits of Mercury, Venus, Earth and Mars.`,
          `It is ${lightLeft(app, 'Betelgeuse', 550)}. (Its distance is uncertain; estimates range from about 400 to 700 light-years.)`,
        ],
        action: async (ctx) => {
          await ctx.setTime(WINTER_NIGHT(ctx));
          const s = ctx.star('Betelgeuse');
          if (s) ctx.flyTo(s, 8);
        },
      },
      {
        title: 'Rigel, the blue supergiant',
        text: (app) => [
          'Rigel is a class B supergiant at about 12,000 K — more than twice as hot as the Sun at its surface, and tens of thousands of times more luminous.',
          `It is ${lightLeft(app, 'Rigel', 860)}.`,
        ],
        action: async (ctx) => {
          await ctx.setTime(WINTER_NIGHT(ctx));
          const s = ctx.star('Rigel');
          if (s) ctx.flyTo(s, 8);
        },
      },
      {
        title: 'Magnitude: a backwards scale',
        text: (app) => [
          'Astronomers measure brightness in **magnitudes**, an ancient scale that runs backwards: smaller numbers are brighter. Each step is 2.5× brighter, and five steps are exactly 100×. Vega was long the zero point; the faintest stars you can see are around 6.',
          `Sirius, below Orion, is the brightest star in the night sky at magnitude −1.5, and one of the nearest: ${lightLeft(app, 'Sirius', 8.6)}.`,
        ],
        action: async (ctx) => {
          await ctx.setTime(WINTER_NIGHT(ctx));
          const s = ctx.star('Sirius');
          if (s) ctx.flyTo(s, 30);
        },
      },
      {
        title: 'You are seeing the past',
        text: [
          'A **light-year** is the distance light travels in a year — about 9.5 trillion km. So every glance up is a glance back in time: the Moon as it was 1.3 seconds ago, the Sun 8 minutes ago.',
          'The fuzzy patch we have flown to is the Andromeda Galaxy, a **galaxy** of a trillion stars. Its light set out about 2.5 million years ago, before our species existed.',
        ],
        reflection: 'Every star you see is a message sent long ago, arriving only now. What reaches you today began its journey before you knew to look up.',
        action: async (ctx) => {
          await ctx.setTime(WINTER_NIGHT(ctx));
          ctx.flyTo({ kind: 'dso', id: 'M 31' }, 12);
        },
      },
    ],
  },

  // 9 -------------------------------------------------------------------
  {
    id: 'milkyway',
    title: 'The Milky Way',
    blurb: 'Our galaxy seen from inside: the glowing band, the hidden centre in Sagittarius, and star nurseries.',
    minutes: 5,
    icon: 'galaxy',
    steps: [
      {
        title: 'A river of light',
        location: 'mariposa',
        settings: { atmosphere: true, ground: true, milkyWay: true, perfectSky: false, constellationLines: false, constellationNames: true },
        text: [
          'A moonless summer night from Mariposa. The soft band arching up from the south is the **Milky Way**: our own galaxy, a flat disc of a few hundred billion stars about 100,000 light-years across.',
          'We live inside the disc, about 26,000 light-years from the centre, so we see it edge-on — a ring of countless distant stars too faint to see one by one, blending into a glow all around the sky.',
        ],
        reflection: 'To see our home galaxy we must look along it, from within. There is no outside vantage point — only the view from where we stand.',
        action: async (ctx) => {
          await ctx.setTime(SUMMER_NIGHT(ctx));
          ctx.mark(null);
          ctx.look(35, 160, 105);
        },
      },
      {
        title: 'Toward the centre',
        settings: { constellationLines: true },
        text: [
          'The brightest, thickest part of the band lies in Sagittarius — its main stars form a “teapot”, and the Milky Way rises from its spout like steam. The centre of the galaxy is right there, 26,000 light-years away.',
          'We cannot see the centre itself: dark clouds of dust block its light, and form the dark rift that splits the band. At the core lies Sagittarius A*, a black hole of about four million Suns, detected by the orbits of stars around it.',
        ],
        action: async (ctx) => {
          await ctx.setTime(SUMMER_NIGHT(ctx));
          ctx.flyTo(ctx.constellation('Sgr'), 42, { mark: false });
        },
      },
      {
        title: 'Star nurseries and old clusters',
        text: [
          'Zoom in near the spout: the Lagoon Nebula (M8), a **nebula** of glowing hydrogen about 4,000 light-years away where new stars are being born. On a dark night it is just visible to the eye.',
          'Nearby is M22, a **globular cluster** — a ball of hundreds of thousands of ancient stars, older than the Sun by billions of years.',
        ],
        action: async (ctx) => {
          await ctx.setTime(SUMMER_NIGHT(ctx));
          ctx.flyTo({ kind: 'dso', id: 'M 8' }, 9);
        },
      },
      {
        title: 'The Summer Triangle',
        text: [
          'Look high overhead for three bright stars: Vega, Deneb and Altair. They form the Summer Triangle, an **asterism** — a pattern that isn’t an official constellation. The Milky Way flows right through it.',
          'Their distances differ enormously: Altair is 17 light-years away, Vega 25, and Deneb somewhere between 1,400 and 2,600 — it only looks as bright because it is one of the most luminous stars known.',
        ],
        action: async (ctx) => {
          await ctx.setTime(SUMMER_NIGHT(ctx));
          const v = ctx.star('Vega');
          const d = ctx.star('Deneb');
          const a = ctx.star('Altair');
          ctx.guideThrough([v, d, a, v]);
          ctx.flyToGroup([v, d, a], 85);
        },
      },
    ],
  },

  // 10 ------------------------------------------------------------------
  {
    id: 'eclipses',
    title: 'Eclipses',
    blurb: 'Why they happen, why not every month — and the total lunar eclipse of 3 March 2026 from California.',
    minutes: 5,
    icon: 'eclipse',
    steps: [
      {
        title: 'Shadows in a line',
        settings: { atmosphere: true, ground: true, ecliptic: false },
        text: [
          'An eclipse is a shadow. When the Moon passes between the Sun and Earth, its shadow falls on us: a solar eclipse, always at new Moon. When Earth passes between the Sun and Moon, our shadow falls on the Moon: a lunar eclipse, always at full Moon.',
          'By coincidence the Sun is about 400 times wider than the Moon and about 400 times farther away, so the two look the same size — which is why the Moon can cover the Sun so exactly.',
        ],
        action: async (ctx) => {
          await ctx.setTime(ECLIPSE_PEAK - 150 * 60e3);
          ctx.flyTo(ctx.body('Moon'), 20, { mark: false });
        },
      },
      {
        title: 'Why not every month?',
        settings: { ecliptic: true },
        text: [
          'The Moon’s orbit is tilted about 5° to the **ecliptic**, so most full Moons pass just above or below Earth’s shadow. An eclipse needs a new or full Moon near one of the two **nodes**, where the orbit crosses the ecliptic.',
          'That lines up only about twice a year, in “eclipse seasons”. Here the full Moon sits almost exactly on the ecliptic — a sign that an eclipse is coming.',
        ],
        action: async (ctx) => {
          await ctx.setTime(ECLIPSE_PEAK - 150 * 60e3);
          ctx.flyTo(ctx.body('Moon'), 40, { mark: false });
        },
      },
      {
        title: 'Into the shadow',
        settings: { ecliptic: false },
        text: [
          '2:18 am on 3 March 2026 in California. Earth’s shadow has two parts: the faint outer **penumbra**, where only part of the Sun is hidden, and the dark core, the **umbra**. The Moon began entering the umbra at 1:50 am, and a dark bite is spreading across it.',
          'Notice the curved edge of the shadow. Aristotle used exactly this — Earth’s shadow is always round — as evidence that Earth is a sphere.',
        ],
        action: async (ctx) => {
          await ctx.setTime(ECLIPSE_PEAK - 75 * 60e3);
          ctx.flyTo(ctx.body('Moon'), 2.2, { mark: false });
        },
      },
      {
        title: 'Totality: a red Moon',
        text: [
          'Mid-eclipse, 3:34 am. The Moon is fully inside the umbra yet not black: it glows copper-red. Sunlight is bent through Earth’s atmosphere into the shadow, and the air filters out the blue — the same reason sunsets are red.',
          'Totality lasted about an hour, from 3:04 to 4:03 am. Unlike a solar eclipse, a lunar eclipse is safe to watch and visible from the whole night side of Earth.',
        ],
        reflection: 'At totality the Moon is lit only by light that has passed through Earth’s own air — every sunrise and sunset on the planet at once. Even in the deepest shadow, light finds its way around.',
        action: async (ctx) => {
          await ctx.setTime(ECLIPSE_PEAK);
          ctx.flyTo(ctx.body('Moon'), 2.2, { mark: false });
        },
      },
      {
        title: 'The whole eclipse',
        text: [
          'Here is the eclipse from start to finish at 2 minutes per second, with the camera following the Moon.',
          'Next chances from California: a partial lunar eclipse on the evening of 11 January 2028, and — mark the date — a total solar eclipse crossing northern California on 12 August 2045. The Sky events panel (Y) lists every eclipse ahead.',
        ],
        action: async (ctx) => {
          await ctx.setTime(ECLIPSE_PEAK - 110 * 60e3, 120);
          ctx.flyTo(ctx.body('Moon'), 3, { mark: false });
          ctx.track(ctx.body('Moon'));
          ctx.every(500, () => {
            if (ctx.app.time.nowMs() > ECLIPSE_PEAK + 110 * 60e3) ctx.app.time.setTime(ECLIPSE_PEAK - 110 * 60e3);
          });
        },
      },
    ],
  },

  // 11 ------------------------------------------------------------------
  {
    id: 'timetravel',
    title: 'Time travel & your birth sky',
    blurb: 'Set any date, time and place — including the sky you were born under.',
    minutes: 4,
    icon: 'clock',
    steps: [
      {
        title: 'The time bar',
        settings: { atmosphere: true, ground: true },
        spotlight: '.timebar',
        text: [
          'Everything in this sky is computed for one moment, shown top-left. The time bar lets you change it: play, pause or reverse; run faster; step by an hour, a day, a lunar month or a year; or, on a larger screen, type a date and time.',
          'The coloured strip is the day at a glance — blue daylight, orange and violet twilight, dark night. Drag along it to scrub through the hours. Now (N) returns to the live sky.',
        ],
        action: async (ctx) => {
          await ctx.setTime(ctx.tonight(22));
          ctx.look(30, 180, 90);
        },
      },
      {
        title: 'Change where you stand',
        spotlight: '.toolbar .tool[aria-label="Location"]',
        text: [
          'The Location panel (or a tap on the clock card) switches between Mariposa, Sacramento and Glacier Point, or any place on Earth by coordinates. Latitude changes which stars you can see: from Australia, Polaris is below the horizon and the Southern Cross rides high.',
        ],
      },
      {
        title: 'A century ago tonight',
        text: (app) => [
          `We have jumped to this same night in ${frameTime(app).getUTCFullYear()}. The constellations look identical — stars drift so slowly that a lifetime changes nothing you could see by eye. But the Moon and planets are somewhere else entirely.`,
          'This is how you can see the sky of any moment in history, from a battle to the night a friend was born.',
        ],
        action: async (ctx) => {
          const t = ctx.tonight(22);
          t.setUTCFullYear(t.getUTCFullYear() - 100);
          await ctx.setTime(t);
          ctx.look(35, 180, 100);
        },
      },
      {
        title: 'The sky you were born under',
        spotlight: '.toolbar .tool[aria-label="Moments"]',
        text: [
          'The As Above “Moments” panel in the toolbar lets you save meaningful instants — your birth, a wedding, a loved one’s passing — with their date, time and place, and return to their sky with a tap.',
          'Enter your birth time as precisely as you know it: the sky turns 1° every four minutes, so the time decides which stars were rising in the east and which planets stood overhead.',
        ],
        reflection: '“As above, so below.” A birth sky is a snapshot of the heavens at the moment you arrived. Whatever meaning you draw from it, the sky itself is exact: this is precisely what was overhead.',
      },
    ],
  },

  // 12 ------------------------------------------------------------------
  {
    id: 'starhop',
    title: 'Star-hopping from the Big Dipper',
    blurb: 'Use the Dipper as a signpost: pointers to Polaris, arc to Arcturus, spike to Spica.',
    minutes: 5,
    icon: 'dipper',
    steps: [
      {
        title: 'Find the Big Dipper',
        settings: { atmosphere: true, ground: true, constellationLines: true, constellationNames: false, starNames: true },
        text: [
          'A May evening, facing north and looking high. The seven bright stars of the Big Dipper (the Plough in Britain) form a ladle: four in the bowl, three in the handle.',
          'It is an **asterism**, the brightest part of the constellation Ursa Major, the Great Bear. From Mariposa it is **circumpolar** — it never sets — and in spring evenings it rides high overhead.',
        ],
        action: async (ctx) => {
          await ctx.setTime(SPRING_NIGHT(ctx));
          const m = ctx.star('Megrez');
          if (m) ctx.flyTo(m, 55, { mark: false });
        },
      },
      {
        title: 'The pointers to Polaris',
        text: [
          'The two stars at the end of the bowl, Merak and Dubhe, are “the pointers”. Draw a line from Merak through Dubhe and carry on about five times their separation: you reach Polaris.',
          'Polaris is not the brightest star in the sky, as people often assume — it is only about the 48th brightest. Its fame comes from its place, not its light.',
        ],
        action: async (ctx) => {
          await ctx.setTime(SPRING_NIGHT(ctx));
          const merak = ctx.star('Merak');
          const dubhe = ctx.star('Dubhe');
          const polaris = ctx.star('Polaris');
          ctx.guideThrough([merak, dubhe, polaris]);
          ctx.flyToGroup([dubhe, polaris], 75);
          if (polaris) ctx.mark(polaris);
        },
      },
      {
        title: 'Arc to Arcturus',
        text: [
          'Now follow the gentle curve of the handle away from the bowl and keep going along the same arc. The first bright star you meet is orange Arcturus in Boötes — the brightest star in the northern half of the sky, 37 light-years away.',
          'Astronomers’ rhyme: “arc to Arcturus”.',
        ],
        action: async (ctx) => {
          await ctx.setTime(SPRING_NIGHT(ctx));
          const arc = ['Alioth', 'Mizar', 'Alkaid', 'Arcturus'].map((n) => ctx.star(n));
          ctx.guideThrough(arc);
          ctx.flyToGroup([arc[2], arc[3]], 90);
          if (arc[3]) ctx.mark(arc[3]);
        },
      },
      {
        title: 'Spike to Spica',
        text: [
          '“…then speed on to Spica.” Continue the arc past Arcturus about the same distance again, and you reach blue-white Spica in Virgo, low in the south-east.',
          'Spica is really two hot stars orbiting each other every four days, too close to separate in any telescope.',
        ],
        reflection: 'Star-hopping teaches that the far is found through the near: from what you already know, a line leads to what you do not yet know.',
        action: async (ctx) => {
          await ctx.setTime(SPRING_NIGHT(ctx));
          const arc = ['Alioth', 'Mizar', 'Alkaid', 'Arcturus', 'Spica'].map((n) => ctx.star(n));
          ctx.guideThrough(arc);
          ctx.flyToGroup([arc[3], arc[4]], 100);
          if (arc[4]) ctx.mark(arc[4]);
        },
      },
      {
        title: 'Keep hopping',
        text: [
          'One more: a line from Megrez through Phecda, the two bowl stars nearest the handle, leads down (“a hole in the bowl drips onto Leo”) to Regulus, the heart of the Lion.',
          'Outside, the same patterns are there — just smaller and fainter than on screen. Try it tonight: find the Dipper, then Polaris. You will never lose north again.',
        ],
        action: async (ctx) => {
          await ctx.setTime(SPRING_NIGHT(ctx));
          const line = ['Megrez', 'Phecda', 'Regulus'].map((n) => ctx.star(n));
          ctx.guideThrough(line);
          ctx.flyToGroup([line[1], line[2]], 100);
          if (line[2]) ctx.mark(line[2]);
        },
      },
    ],
  },
];

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}
