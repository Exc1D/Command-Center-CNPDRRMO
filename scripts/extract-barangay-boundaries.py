# Keep Camarines Norte barangays from the HDX ADM4 GeoJSON, renamed to the app's barangay names, rounded to ~1 m.
# Source: https://data.humdata.org/dataset/cod-ab-phl (phl_admin_boundaries.geojson.zip, phl_admin4.geojson). License CC BY-IGO: keep the map credit.
# Usage: python3 scripts/extract-barangay-boundaries.py <phl_admin4.geojson> public/baranggays.geojson public/reference/barangay_boundaries.geojson
import json, sys
src, app_points, out = sys.argv[1:4]
names = {f['properties']['psgc']: f['properties'] for f in json.load(open(app_points))['features']}
data = json.load(open(src))

def rnd(c):
    if isinstance(c[0], (int, float)): return [round(c[0], 5), round(c[1], 5)]
    pts = [rnd(p) for p in c]
    if pts and isinstance(pts[0][0], float):  # a ring: drop repeated points
        pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
    return pts

feats, unmatched = [], []
for f in data['features']:
    p = f['properties']
    if p.get('adm2_name') != 'Camarines Norte': continue
    code = p['adm4_pcode'].removeprefix('PH').lstrip('0')
    app = names.get(code)
    if not app: unmatched.append((p['adm3_name'], p['adm4_name'], p['adm4_pcode'])); continue
    feats.append({'type': 'Feature', 'properties': {'name': app['name'], 'municipality': app['municipality'], 'psgc': code},
                  'geometry': {'type': f['geometry']['type'], 'coordinates': rnd(f['geometry']['coordinates'])}})
json.dump({'type': 'FeatureCollection', 'features': feats}, open(out, 'w'), separators=(',', ':'))
missing = sorted(set(names) - {f['properties']['psgc'] for f in feats})
print('kept', len(feats), 'unmatched', unmatched, 'app barangays without outline', [names[m]['name'] + ' / ' + names[m]['municipality'] for m in missing])
