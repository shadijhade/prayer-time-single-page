"""Builds src/cities/ from GeoNames (https://www.geonames.org, CC BY 4.0).

Usage: python scripts/build-cities.py [download-dir]

Writes one file per country (src/cities/EG.json) with every place of 5000+ people, largest
first, and src/cities/index.json with each country's bounding box. The app uses them to find
the user's city centre (and its time zone) without any third-party API. Only needed when the
data should be refreshed; the downloads (~210 MB) are kept in download-dir between runs.
"""

import io
import json
import sys
import tempfile
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

GEONAMES_URL = "https://download.geonames.org/export/dump/"
OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "cities"
# Neighbourhoods and historical, abandoned or destroyed places aren't cities
SKIPPED_FEATURE_CODES = {"PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH"}
# Degrees around a country's outermost cities, so nearby users still get its file
BBOX_PADDING = 0.5


def rows(download_dir, zip_name, member):
    path = Path(download_dir) / zip_name
    if not path.exists():
        print("Downloading", zip_name)
        urllib.request.urlretrieve(GEONAMES_URL + zip_name, path)
    with zipfile.ZipFile(path) as archive, archive.open(member) as file:
        for line in io.TextIOWrapper(file, encoding="utf-8"):
            yield line.rstrip("\n").split("\t")


def bounding_box(cities):
    lats = [c["lat"] for c in cities]
    lons = [c["lon"] for c in cities]
    # Countries across the antimeridian (Fiji, Russia...) get a box in 0..360 longitudes
    shifted = [lon + 360 if lon < 0 else lon for lon in lons]
    if max(shifted) - min(shifted) < max(lons) - min(lons):
        lons = shifted
    return [
        round(min(lats) - BBOX_PADDING, 1),
        round(min(lons) - BBOX_PADDING, 1),
        round(max(lats) + BBOX_PADDING, 1),
        round(max(lons) + BBOX_PADDING, 1),
    ]


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    download_dir = sys.argv[1] if len(sys.argv) > 1 else tempfile.gettempdir()

    cities = {}
    for r in rows(download_dir, "cities5000.zip", "cities5000.txt"):
        if r[7] not in SKIPPED_FEATURE_CODES:
            cities[r[0]] = {
                "name": r[1],
                "lat": float(r[4]),
                "lon": float(r[5]),
                "country": r[8],
                "population": int(r[14] or 0),
                "tz": r[17],
            }

    # Arabic names: a preferred, full name wins; colloquial and historic names are ignored
    arabic = {}
    for r in rows(download_dir, "alternateNamesV2.zip", "alternateNamesV2.txt"):
        geoname_id, language, name = r[1], r[2], r[3]
        if language != "ar" or geoname_id not in cities or "1" in (r[6], r[7]):
            continue
        rank = (r[4] == "1", r[5] != "1")
        if geoname_id not in arabic or rank > arabic[geoname_id][0]:
            arabic[geoname_id] = (rank, name)

    by_country = defaultdict(list)
    for geoname_id, city in cities.items():
        city["ar"] = arabic.get(geoname_id, (None, ""))[1]
        by_country[city["country"]].append(city)

    OUT_DIR.mkdir(exist_ok=True)
    for old_file in OUT_DIR.glob("*.json"):
        old_file.unlink()
    index = {}
    for country, items in sorted(by_country.items()):
        items.sort(key=lambda c: -c["population"])
        time_zones = sorted({c["tz"] for c in items})
        write_json(
            OUT_DIR / f"{country}.json",
            {
                "tz": time_zones,
                # [Arabic name ("" if none), name, latitude, longitude, population, index in tz]
                "cities": [
                    [c["ar"], c["name"], round(c["lat"], 3), round(c["lon"], 3), c["population"], time_zones.index(c["tz"])]
                    for c in items
                ],
            },
        )
        index[country] = bounding_box(items)
    write_json(OUT_DIR / "index.json", index)
    print(f"{len(cities)} cities ({len(arabic)} with Arabic names) in {len(index)} countries -> {OUT_DIR}")


if __name__ == "__main__":
    main()
