# Stars Observatory

A real-time, physically based 3D observatory of the sky above **Mariposa** and **Sacramento**, California — and anywhere else on Earth. It shows what is actually overhead right now (or at any moment you travel to): stars, constellations, the Milky Way, the Sun, Moon and planets, comets, asteroids, the ISS and bright satellites, meteor showers and eclipses.

It runs in any modern browser on desktop or phone, installs as an app (PWA), and works offline.

## What you can do

- **Look around the real sky.** Drag to pan, scroll or pinch to zoom from a 110° wide view down to a few arcminutes. Tap anything to identify it.
- **See your sky as it really looks.** Sky brightness is modelled from twilight, moonlight (Krisciunas & Schaefer) and each site's light pollution (Bortle class), so the Milky Way is plain from Mariposa and washed out in Sacramento. Toggle **Perfect sky** (P) to see what the city lights hide.
- **Tonight** panel: sky-quality score, sunset/twilight/dark times, a twilight timeline, Moon phase and rise/set, which planets are up and when, the best deep-sky targets, bright comets, active meteor showers and visible ISS/Tiangong passes.
- **Sky events** calendar for the next 12 months: eclipses (with local visibility and obscuration), full-moon names and supermoons, oppositions, conjunctions and close approaches, greatest elongations, planet parades, equinoxes and solstices, meteor-shower peaks. Tap an event to travel to the best moment to see it.
- **Time travel.** Play time faster or backwards, jump by hours or days, pick any date, or drag the 24-hour day strip.
- **Point your phone at the sky** (📱 button). The view follows your phone's compass and gyroscope and names what's in the crosshair; optionally overlays the live camera.
- **Night vision** (R) turns everything red to protect dark-adapted eyes outside.
- **Solar System** view (O): a 3D orrery of the planets, comets and asteroids at the current simulated time.

### Keyboard

| Keys | Action |
| --- | --- |
| Drag / arrows / WASD | Look around |
| Scroll / pinch / `+` `−` | Zoom toward the pointer |
| `/` or `Ctrl K` | Search |
| `Space` | Pause / play |
| `[` `]` | Slower / faster (and reverse) |
| `N` | Back to now |
| `T` / `Y` | Tonight / Sky events |
| `C` `V` `B` `L` | Constellation figures, names, boundaries, star names |
| `M` `H` `G` | Milky Way, atmosphere, landscape |
| `Z` `E` `K` | Alt-az grid, equatorial grid, ecliptic |
| `P` | Perfect sky |
| `R` | Night vision |
| `O` | Solar System view |
| `U` / `F` | Hide interface / full screen |
| `?` | Help |

## Accuracy

- **Positions**: stars from HYG v4.1 (Hipparcos/Tycho, ~41,500 stars to magnitude 8); Sun, Moon and planets from [Astronomy Engine](https://github.com/cosinekitty/astronomy) (VSOP87/ELP, arcsecond-level), with precession, nutation, aberration, light-time and topocentric parallax; atmospheric refraction near the horizon.
- **Orientation**: the Moon and planets use the IAU rotation models, so the Moon's phase, libration and position angle, Saturn's ring tilt and Jupiter's band orientation are all correct for the moment shown. Jupiter's Galilean moons are placed individually.
- **Comets** from the Minor Planet Center's current orbital elements and **asteroids** from JPL, propagated with a universal-variable Kepler solver (checked against JPL Horizons to a few arcseconds).
- **Satellites** from CelesTrak TLEs with SGP4, including Earth-shadow and brightness estimates.
- **Eclipses**: the Moon darkens and turns coppery inside Earth's computed umbra; the Sun is covered by the Moon's true disc and the daylight dims with obscuration.

Comet elements and satellite TLEs are fetched live when online; bundled snapshots are used offline and refreshed by the weekly deploy.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # astronomy and rendering-math tests
npm run build      # production build in dist/
```

The app is TypeScript + [three.js](https://threejs.org) with no framework. Key directories:

- `src/astro/` — astronomy: coordinate frames, solar-system bodies, sky brightness, comets/asteroids, satellites, meteor showers, events and the nightly summary.
- `src/render/` — WebGL rendering: atmosphere (Rayleigh/Mie/ozone scattering baked to lookup tables), stars, lines, bodies, landscape, comets, meteors, the 2D label overlay and the orrery.
- `src/ui/` — HUD, time bar, toolbar, panels and the info card.
- `scripts/` — data pipeline. `fetch-sources.sh` downloads raw catalogues, `build-data.mjs` builds `public/data`, `build-textures.py` builds `public/tex`, `fetch-live.mjs` refreshes comets and TLEs.

## Deploying

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to `main` and weekly (to refresh the data snapshots). Enable it under **Settings → Pages → Source: GitHub Actions**. HTTPS (which Pages provides) is required for the phone-pointing mode.

## Data sources and credits

- HYG Database v4.1 — David Nash / astronexus (CC BY-SA 4.0)
- Constellation lines, boundaries and deep-sky catalogue — [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn (BSD-3)
- Milky Way — NASA/Goddard Space Flight Center Scientific Visualization Studio, *Deep Star Maps 2020*
- Moon colour and elevation — NASA LRO (LROC WAC, LOLA) via the SVS CGI Moon Kit
- Planet textures — [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0)
- Comet elements — IAU Minor Planet Center; asteroid elements — JPL Small-Body Database
- Satellite elements — CelesTrak
- Meteor shower data — International Meteor Organization
