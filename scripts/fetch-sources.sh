#!/usr/bin/env bash
# Downloads the raw catalogues and imagery used by scripts/build-data.mjs into
# .cache-data/. Only needed to rebuild public/data and public/tex from scratch.
set -euo pipefail
mkdir -p .cache-data && cd .cache-data
D3=https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data
curl -sSfO https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv
for f in constellations.lines.json constellations.json constellations.bounds.json mw.json messier.json dsos.14.json dsonames.json; do
  curl -sSfO "$D3/$f"
done
curl -sSfO https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt
curl -sSf -o stations.tle "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle"
curl -sSf -o visual.tle "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle"
# Imagery (converted to public/tex by hand; see README "Data sources").
curl -sSfO https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_8k.exr
curl -sSfO https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_2k.tif
curl -sSfO https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_3_8bit.jpg
