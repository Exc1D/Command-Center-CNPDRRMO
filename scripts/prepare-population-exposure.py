"""Privately aggregate population exposure using unsimplified WGS84 hazard polygons.

Run with .private/gis-env/bin/python scripts/prepare-population-exposure.py
    --source-dir /path/to/supplied/files
Use --self-test for the boundary, hole, overlap and unknown-population check.
Raw inputs are never modified; output contains no coordinates or record identifiers.
"""
import argparse
import collections
import hashlib
import json
import math
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from shapely import covers, make_valid, points, prepare
from shapely.geometry import MultiPolygon, Polygon, shape
from storm_surge import STORM_SURGE_ARCHIVE, read_storm_surge

ROOT = Path(__file__).resolve().parents[1]
MAX_SAFE_INTEGER = 2**53 - 1


def polygon_parts(geometry):
    if geometry.geom_type == "Polygon":
        return [geometry]
    return [part for child in getattr(geometry, "geoms", []) for part in polygon_parts(child)]


def memberships(coordinates, hazards):
    """Prepared covers includes polygon boundaries but excludes hole interiors."""
    matches = [set() for _ in coordinates]
    if coordinates:
        population_points = points(coordinates)
        for class_id, geometry in hazards:
            prepare(geometry)
            for index in covers(geometry, population_points).nonzero()[0]:
                matches[index].add(class_id)
    return matches


def aggregate(municipality, features, hazards):
    coordinates = []
    for feature in features:
        geometry = feature.get("geometry", {})
        coordinate = geometry.get("coordinates", [])
        if geometry.get("type") != "Point" or len(coordinate) < 2 or any(
            type(v) not in (int, float) or not math.isfinite(v) for v in coordinate[:2]
        ) or not (-180 <= coordinate[0] <= 180 and -90 <= coordinate[1] <= 90):
            raise ValueError(f"Invalid WGS84 population point in {municipality}")
        coordinates.append(coordinate[:2])
    buckets = collections.defaultdict(lambda: [0, 0, 0, 0])
    for feature, matches in zip(features, memberships(coordinates, hazards)):
        properties = feature["properties"]
        population = properties.get("populationCount")
        if population is not None and (type(population) is not int or not 0 <= population <= MAX_SAFE_INTEGER):
            raise ValueError(f"Invalid population count in {municipality}")
        barangay = properties.get("barangay")
        if barangay is not None and (not isinstance(barangay, str) or not barangay.strip()):
            raise ValueError(f"Invalid barangay in {municipality}")
        duplicate = properties.get("duplicateId", False)
        if not isinstance(duplicate, bool):
            raise ValueError(f"Invalid duplicate flag in {municipality}")
        counts = buckets[(barangay, tuple(sorted(matches)))]
        counts[0] += 1
        counts[1] += population or 0
        counts[2] += population is None
        counts[3] += duplicate
        if any(value > MAX_SAFE_INTEGER for value in counts):
            raise ValueError("Exposure aggregate exceeds JavaScript safe integer range")
    return [{"municipality": municipality, "barangay": barangay, "classes": list(classes),
             "matchedRecords": counts[0], "populationSum": counts[1],
             "missingPopulationRecords": counts[2], "duplicateIdRecords": counts[3]}
            for (barangay, classes), counts in sorted(buckets.items(), key=lambda item: (item[0][0] or "", item[0][1]))]


def self_test():
    outer = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)], holes=[[(1, 1), (3, 1), (3, 3), (1, 3)]])
    overlap = Polygon([(3, 0), (5, 0), (5, 4), (3, 4)])
    features = [{"geometry": {"type": "Point", "coordinates": coordinate},
                 "properties": {"barangay": None, "populationCount": count, "duplicateId": duplicate}}
                for coordinate, count, duplicate in [((0, 2), 2, False), ((2, 2), None, False),
                                                      ((3.5, 2), 3, True), ((5, 2), 0, False)]]
    rows = aggregate("Test", features, [("a", outer), ("a", outer), ("b", overlap)])
    by_classes = {tuple(row["classes"]): row for row in rows}
    assert by_classes[("a",)]["populationSum"] == 2  # Outer boundary is covered.
    assert by_classes[()]["missingPopulationRecords"] == 1  # Hole interior is excluded.
    assert by_classes[("a", "b")]["duplicateIdRecords"] == 1  # Retain and flag source duplicates.
    assert sum(row["matchedRecords"] for row in rows if row["classes"]) == 3  # Union counts once.
    assert sum(row["populationSum"] for row in rows) == 5
    assert by_classes[("b",)]["missingPopulationRecords"] == 0  # Zero differs from unknown.
    assert memberships([(1, 2)], [("a", outer)]) == [{"a"}]  # Hole boundary is covered.
    print("Exposure self-check passed: boundaries, holes, overlap, duplicates, zero and unknown.")


def main(source_dir):
    started = time.monotonic()
    result = {"version": 1, "generatedAt": datetime.now(timezone.utc).isoformat(),
              "method": "Original, unsimplified WGS84 hazard polygons cover accepted population point coordinates. "
                        "Polygon boundaries are included; hole interiors are excluded. Invalid polygons are repaired "
                        "without simplification. Each source record contributes once to the union of selected classes. "
                        "Source duplicate records are retained and flagged; missing population counts are not imputed.",
              "sources": [], "repairs": [], "municipalities": [], "classes": [], "buckets": []}

    def read(path, name, data=None):
        raw = path.read_bytes()
        result["sources"].append({"file": name, "sha256": hashlib.sha256(raw).hexdigest()})
        if data is None: data = json.loads(raw)
        if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
            raise ValueError(f"Invalid FeatureCollection in {name}")
        if not data["features"]:
            raise ValueError(f"Empty required dataset in {name}; exposure cannot be calculated")
        crs = data.get("crs", {}).get("properties", {}).get("name")
        if crs and crs not in ("urn:ogc:def:crs:OGC:1.3:CRS84", "urn:ogc:def:crs:EPSG::4326", "EPSG:4326"):
            raise ValueError(f"Expected WGS84 source geometry in {name}")
        return data["features"]

    hazards, class_definitions = [], {}
    for layer, path, field in [
        ("flood", ROOT / "CamarinesNorte_FloodPerMunicipality.geojson", "Suscep"),
        ("storm_surge", source_dir / STORM_SURGE_ARCHIVE, "hazardClass"),
        ("landslide", source_dir / "CN_RIL.geojson", "lndslidesu"),
        ("liquefaction", source_dir / "CN_liquefaction.geojson", "Liq_Class"),
        ("tsunami", source_dir / "CN_tsunami.geojson", "Inun_desc"),
    ]:
        source = read_storm_surge(source_dir) if layer == "storm_surge" else None
        for index, feature in enumerate(read(path, path.name, source), 1):
            properties = feature.get("properties", {})
            label = properties.get(field)
            if not isinstance(label, str) or not label.strip():
                raise ValueError(f"Missing hazard class in {path.name}, feature {index}")
            label = label.strip()
            if layer == "tsunami" and label == "Inundation depth":
                depth = properties.get("Inun_depth")
                if not isinstance(depth, str) or not depth.strip():
                    raise ValueError(f"Missing inundation depth in {path.name}, feature {index}")
                label += ": " + depth.strip()
            # Preserve inequality meaning when generating stable tsunami depth IDs.
            class_id = layer + "-" + re.sub(r"[^a-z0-9]+", "-", label.lower().replace("<", "less-than").replace(">", "greater-than")).strip("-")
            definition = {"id": class_id, "layer": layer, "label": label}
            if class_id in class_definitions and class_definitions[class_id] != definition:
                raise ValueError(f"Hazard class ID collision in {path.name}")
            class_definitions[class_id] = definition
            geometry = shape(feature["geometry"])
            if geometry.geom_type not in ("Polygon", "MultiPolygon") or geometry.is_empty:
                raise ValueError(f"Expected nonempty polygon in {path.name}, feature {index}")
            if not all(math.isfinite(value) for value in geometry.bounds) or not (
                -180 <= geometry.bounds[0] <= geometry.bounds[2] <= 180 and
                -90 <= geometry.bounds[1] <= geometry.bounds[3] <= 90
            ):
                raise ValueError(f"Expected WGS84 bounds in {path.name}, feature {index}")
            if not geometry.is_valid:
                geometry = MultiPolygon(polygon_parts(make_valid(geometry)))
                result["repairs"].append({"source": path.name, "feature": index})
            if geometry.is_empty or not geometry.is_valid:
                raise ValueError(f"Polygon repair failed in {path.name}, feature {index}")
            hazards.append((class_id, geometry))
        print(f"Loaded original {layer} polygons", flush=True)

    result["classes"] = sorted(class_definitions.values(), key=lambda item: item["id"])
    for path in sorted((ROOT / ".private/population").glob("*.geojson")):
        features = read(path, path.relative_to(ROOT).as_posix())
        result["municipalities"].append(path.stem)
        result["buckets"].extend(aggregate(path.stem, features, hazards))
        print(f"Aggregated {path.stem}: {len(features):,} accepted records", flush=True)
    if not result["municipalities"]:
        raise ValueError("No private population sources found; run prepare-map-data.py first")

    destination = ROOT / ".private/population-exposure.json"
    temporary = destination.with_suffix(".json.tmp")
    temporary.touch(mode=0o600)
    temporary.chmod(0o600)
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
    temporary.replace(destination)
    print(f"Saved private aggregate: {sum(row['matchedRecords'] for row in result['buckets']):,} records, "
          f"{len(result['buckets']):,} buckets, {len(result['classes'])} classes, "
          f"{len(result['repairs'])} polygon repairs; {time.monotonic() - started:.1f}s.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    elif args.source_dir:
        main(args.source_dir)
    else:
        parser.error("--source-dir is required unless running --self-test")
