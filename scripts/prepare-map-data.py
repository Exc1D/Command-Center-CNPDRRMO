"""Build display-only map derivatives. pip install shapely pyproj openpyxl.
Run: python scripts/prepare-map-data.py --source-dir /path/to/supplied/files
Raw inputs are never modified. Population output must NOT be served statically.
"""
import argparse, collections, hashlib, json, re, zipfile
from pathlib import Path
import openpyxl
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform
from shapely import make_valid, get_num_coordinates

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source-dir", type=Path, required=True)
args = parser.parse_args()
out = root / "public/reference"
private = root / ".private/population"
out.mkdir(parents=True, exist_ok=True)
private.mkdir(parents=True, exist_ok=True)
locations = json.loads((root / "src/lib/barangays.json").read_text())
def norm(v):
    return re.sub(r"[^a-z0-9]", "", re.split(r"[,()]", str(v))[0].lower().replace("ñ", "n")).replace("poblacionn", "poblacion").replace("staelena", "santaelena")
mun_lookup = {norm(m): m for m in locations}
def muni(v): return mun_lookup[norm(v)]
def brgy(m, v):
    return next(b["name"].strip() for b in locations[m]["barangays"] if norm(b["name"]) == norm(v))
def write(p, data):
    p.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
def fc(features): return {"type": "FeatureCollection", "features": features}
manifest = {"note": "Display derivatives only; not suitable for parcel-level exposure analysis.", "layers": {}, "issues": []}
def issue(source, index, reason):
    manifest["issues"].append({"source": source, "record": index, "reason": reason})
to_m = Transformer.from_crs(4326, 32651, always_xy=True).transform
to_ll = Transformer.from_crs(32651, 4326, always_xy=True).transform
river_ll = Transformer.from_crs("ESRI:102457", 4326, always_xy=True, allow_ballpark=False)
print("River transform:", river_ll.description, flush=True)
def derivative(key, filename, tolerance=2, fields=None, project=False):
    raw = (args.source_dir / filename).read_bytes()
    data = json.loads(raw)
    features, before, after, repairs = [], 0, 0, 0
    max_area_change = 0
    for i, f in enumerate(data["features"], 1):
        g = shape(f["geometry"])
        if g.is_empty:
            issue(filename, i, 'Empty source geometry; no drawable feature')
            continue
        if project: g = transform(river_ll.transform, g)
        before += get_num_coordinates(g)
        if not g.is_valid:
            g = make_valid(g); repairs += 1
            issue(filename, i, "Invalid source geometry repaired in display derivative only")
        projected = transform(to_m, g)
        simple = projected.simplify(tolerance, preserve_topology=True)
        if projected.area: max_area_change = max(max_area_change, abs(simple.area / projected.area - 1))
        g = transform(to_ll, simple)
        if not g.is_valid:
            g = make_valid(g)
            issue(filename, i, 'Projection round-trip topology repaired in display derivative only')
        assert g.is_valid and not g.is_empty
        after += get_num_coordinates(g)
        p = f.get("properties", {})
        features.append({"type": "Feature", "properties": {k: p.get(k) for k in fields} if fields else p, "geometry": mapping(g)})
    write(out / f"{key}.geojson", fc(features))
    manifest["layers"][key] = {"source": filename, "sha256": hashlib.sha256(raw).hexdigest(), "features": len(features), "sourceCoordinates": int(before), "displayCoordinates": int(after), "simplificationMetres": tolerance, "maxFeatureAreaChangeRatio": max_area_change, "repairedFeatures": repairs, "bytes": (out / f"{key}.geojson").stat().st_size}
    print(key, manifest["layers"][key], flush=True)

derivative("boundaries", "Municipal Boundary NAMRIA.geojson", fields=["ADM3_EN", "ADM3_PCODE", "AREA_SQKM"])
derivative("landslide", "CN_RIL.geojson", fields=["lndslidesu"])
derivative("liquefaction", "CN_liquefaction.geojson", fields=["Liq_Class"])
derivative("tsunami", "CN_tsunami.geojson", tolerance=5, fields=["Inun_desc", "Inun_depth"])
derivative("roads", "OSMCN_roads.geojson", fields=["Road Class", "RoadName", "fclass", "Mun"])
derivative("rivers", "Camarines Norte River Map.geojson", fields=["river_name", "name", "type"], project=True)
# Existing flood layer remains the source of flood susceptibility.
raw = json.loads((root / "CamarinesNorte_FloodPerMunicipality.geojson").read_text())
write(out / "flood.geojson", raw)
manifest["layers"]["flood"] = {"source": "CamarinesNorte_FloodPerMunicipality.geojson", "features": len(raw["features"])}
boundary = json.loads((out / "boundaries.geojson").read_text())
bounds = shape({"type": "GeometryCollection", "geometries": [f["geometry"] for f in boundary["features"]]}).bounds
def within(c): return bounds[0] <= c[0] <= bounds[2] and bounds[1] <= c[1] <= bounds[3]
with zipfile.ZipFile(args.source_dir / "CPF geojson & symbology-20260921T020344Z-1-001.zip") as z:
    cpf = json.loads(z.read(next(n for n in z.namelist() if n.endswith(".geojson"))))
points = []
for i, f in enumerate(cpf["features"], 1):
    if not within(f["geometry"]["coordinates"]):
        issue("Critical Point Facilities.geojson", i, "Coordinate outside provincial bounding box; withheld pending source correction")
        continue
    p = f["properties"]
    points.append({"type": "Feature", "geometry": f["geometry"], "properties": {k: p.get(k) for k in ["Category", "SubCategor", "Name", "Municipali"]}})
assert len(points) == 1540
write(out / "facilities.geojson", fc(points))
manifest["layers"]["facilities"] = {"sourceFeatures":1543,"displayFeatures":1540,"note":"Equivalent category icons; referenced source SVG files were not supplied."}

sheet = openpyxl.load_workbook(args.source_dir / "Barangay_Data_ForUpload.xlsx", data_only=True).active
profiles = []
for row in list(sheet.values)[2:]:
    m = muni(row[0]); b = brgy(m, row[1])
    categories = lambda values: [str(v).strip() for v in values if v not in (None, 0, "0", "")]
    profiles.append({"municipality": m, "barangay": b, "areaKm2": row[2], "captain": row[3], "contact": str(row[4]) if row[4] else None, "population": row[5], "populationYear": None,
       "demographics": dict(zip(["Women","Children","Persons with disabilities","Elderly","Indigenous people"], row[6:11])),
       "susceptibility": {"Flood": categories(row[11:15]), "Rain-Induced Landslide": categories(row[15:19]), "Tsunami": categories(row[19:23]), "Liquefaction": categories(row[23:24])}})
assert len(profiles) == 282 and len({(p["municipality"], p["barangay"]) for p in profiles}) == 282
assert sum(p["population"] for p in profiles) == 629699
write(root / "src/lib/barangayProfiles.json", profiles)
hh_summary = []
for short in ["Basud","Capalonga","Daet","Jpang","Labo","Mercedes","Paracale","SLR","Talisay","Vinzons"]:
    filename = f"HH_{short}.geojson"
    m = {"Jpang":"Jose Panganiban","SLR":"San Lorenzo Ruiz (Imelda)"}.get(short, short)
    features = json.loads((args.source_dir / filename).read_text())["features"]
    ids = collections.Counter(str(f["properties"].get("hhid")) for f in features if f["properties"].get("hhid") is not None)
    points, population_total, excluded = [], 0, 0
    for i, f in enumerate(features, 1):
        p = f["properties"]; c = f["geometry"]["coordinates"]
        if isinstance(p.get("hh_totmem"), (int,float)): population_total += p["hh_totmem"]
        if not within(c):
            excluded += 1
            issue(filename, i, "Coordinate outside provincial bounding box; withheld pending source correction")
            continue
        try: b = brgy(m, str(p.get("barangay", "")).replace("Ni?o", "Nino"))
        except StopIteration: b = None
        # Allowlist, never copy raw identifiers, names, health or economic attributes.
        points.append({"type": "Feature", "geometry": f["geometry"], "properties": {"record": f"{short}-{i}", "barangay": b, "populationCount": p.get("hh_totmem") if isinstance(p.get("hh_totmem"), int) and p["hh_totmem"] >= 0 else None, "duplicateId": ids.get(str(p.get("hhid")), 0) > 1}})
    write(private / f"{m}.geojson", fc(points))
    hh_summary.append({"municipality": m, "sourceRecords": len(features), "displayRecords":len(points), "populationSum": population_total if short != "Paracale" else None, "duplicateIdExcess": sum(n-1 for n in ids.values()), "excludedCoordinates": excluded})
assert sum(s["sourceRecords"] for s in hh_summary) == 102571
write(root / "src/lib/populationSummary.json", hh_summary)
write(out / "manifest.json", manifest)
print("Complete. Public layers:", out, "Private points:", private, flush=True)
