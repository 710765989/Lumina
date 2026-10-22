# GeoNames offline city index

Source: [GeoNames Gazetteer](https://www.geonames.org/), downloaded 2026-10-18 from https://download.geonames.org/export/dump/ .

Licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

`cities.json` is derived from `cities15000.zip` and `admin1CodesASCII.txt`: unused columns removed, names selected from provided alternatives, compact JSON serialization. Rebuild with `scripts/build-gazetteer.py`.

The data is provided as is. Nearby city matches are approximations, not administrative boundary determinations. Lumina labels them as nearby places and supports correcting place names. Exact coordinates remain local; the UI displays city-level places.
