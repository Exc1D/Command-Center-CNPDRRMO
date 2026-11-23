import { Fragment, useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { X } from 'lucide-react';
import { useStore } from '../lib/store';
import { MAP_CONFIG } from '../lib/constants';
import { barangaysFor, municipalityFromBoundary, nearestBarangay, pointInShape, REFERENCE_LAYERS, SUSCEPTIBILITY_KEY } from '../lib/reference';
import profiles from '../lib/barangayProfiles.json';

type Shape = { name: string; bounds: L.LatLngBounds; geometry: any };

// Clicking the map picks a location, so nobody has to use the dropdowns.
// One map-level handler with a point-in-shape test, so the outlines never block clicks on pins or hazard zones.
// Municipal and barangay outlines always show; `interactive` adds hover and click (off on the Planning page).
export function LocationPicker({ interactive = true }: { interactive?: boolean }) {
  const map = useMap();
  const municipality = useStore(s => s.selectedMunicipality);
  const barangay = useStore(s => s.selectedBarangay);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [barangayShapes, setBarangayShapes] = useState<(Shape & { municipality: string })[]>([]);

  useEffect(() => {
    fetch('/reference/boundaries.geojson').then(r => r.json()).then(data => setShapes(data.features.map((f: any) => ({
      name: municipalityFromBoundary(f.properties.ADM3_EN), bounds: L.geoJSON(f).getBounds(), geometry: f.geometry,
    })).filter((s: Shape) => s.name))).catch(() => {});
    // Barangay outlines: PSA/NAMRIA via OCHA HDX (CC BY-IGO, credit required). See scripts/extract-barangay-boundaries.py.
    fetch('/reference/barangay_boundaries.geojson').then(r => r.json()).then(data => setBarangayShapes(data.features.map((f: any) => ({
      ...f.properties, bounds: L.geoJSON(f).getBounds(), geometry: f.geometry,
    })))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!barangayShapes.length || !map.attributionControl) return;
    const credit = 'Barangay boundaries: PSA, NAMRIA via OCHA HDX';
    map.attributionControl.addAttribution(credit);
    return () => { map.attributionControl?.removeAttribution(credit); };
  }, [map, barangayShapes]);

  // Outlines are built once per data load; picking a location only restyles them (rebuilding ~300 layers per click was slow).
  const [drawn, setDrawn] = useState<{ layer: L.Path; municipality: string; name: string; kind: 'barangay' | 'municipality' | 'dot' }[]>([]);
  useEffect(() => {
    if (!shapes.length) return;
    if (!map.getPane('locations')) { const pane = map.createPane('locations'); pane.style.zIndex = '360'; pane.style.pointerEvents = 'none'; }
    const group = L.layerGroup().addTo(map);
    const opts = { pane: 'locations', interactive: false, pmIgnore: true } as any;
    const outlined = new Set(barangayShapes.map(b => `${b.municipality}|${b.name}`));
    const items: typeof drawn = [];
    const add = (layer: L.Path, municipality: string, name: string, kind: 'barangay' | 'municipality' | 'dot') => { layer.addTo(group); items.push({ layer, municipality, name, kind }); };
    barangayShapes.forEach(b => add(L.geoJSON(b.geometry, { ...opts, style: { fill: false } }) as unknown as L.Path, b.municipality, b.name, 'barangay'));
    shapes.forEach(s => add(L.geoJSON(s.geometry, { ...opts, style: { fill: false } }) as unknown as L.Path, s.name, s.name, 'municipality'));
    // Dots only for barangays with no outline (or while the outline file is loading or missing).
    shapes.forEach(s => barangaysFor(s.name).filter(b => !outlined.has(`${s.name}|${b.name}`)).forEach(b => add(L.circleMarker([b.lat, b.lng], { ...opts, color: '#fff' }), s.name, b.name, 'dot')));
    setDrawn(items);
    return () => { group.remove(); };
  }, [map, shapes, barangayShapes]);

  useEffect(() => {
    drawn.forEach(({ layer, municipality: m, name, kind }) => {
      const picked = m === municipality, exact = picked && name === barangay;
      if (kind === 'barangay') layer.setStyle({ color: picked ? '#0a84ff' : '#64748b', weight: exact ? 3 : picked ? 1.2 : 0.6, opacity: picked ? 0.9 : 0.6 });
      else if (kind === 'municipality') layer.setStyle({ color: picked ? '#0a84ff' : '#334155', weight: picked ? 3 : 1.5, opacity: 0.85 });
      else { (layer as L.CircleMarker).setRadius(exact ? 7 : picked ? 4 : 2.5); layer.setStyle({ weight: picked ? 1.5 : 1, fillColor: picked ? '#0a84ff' : '#334155', fillOpacity: picked ? 1 : 0.7 }); }
    });
  }, [drawn, municipality, barangay]);

  useEffect(() => {
    if (!shapes.length || !interactive) return;

    const tooltip = L.tooltip({ direction: 'top', offset: [0, -8], className: 'location-tooltip' });
    const busy = (e: L.LeafletMouseEvent) => e.sourceTarget !== map || (map as any).pm?.globalDrawModeEnabled?.();
    const inside = (latlng: L.LatLng, s: Shape) => s.bounds.contains(latlng) && pointInShape([latlng.lng, latlng.lat], s.geometry);
    const hit = (latlng: L.LatLng) => {
      const s = shapes.find(s => inside(latlng, s));
      if (!s) return null;
      if (s.name !== useStore.getState().selectedMunicipality) return { shape: s, barangay: null };
      const outline = barangayShapes.find(b => b.municipality === s.name && inside(latlng, b));
      const point = outline && barangaysFor(s.name).find(b => b.name === outline.name);
      return { shape: s, barangay: point ?? nearestBarangay(s.name, latlng.lat, latlng.lng) };
    };
    const onMove = (e: L.LeafletMouseEvent) => {
      const h = busy(e) ? null : hit(e.latlng);
      if (!h) { tooltip.remove(); return; }
      tooltip.setLatLng(e.latlng).setContent(h.barangay ? `Barangay · ${h.barangay.name}` : `Municipality · ${h.shape.name}`);
      if (!map.hasLayer(tooltip)) tooltip.addTo(map);
    };
    const onClick = (e: L.LeafletMouseEvent) => {
      const h = busy(e) ? null : hit(e.latlng);
      if (!h) return;
      const s = useStore.getState();
      if (h.barangay) { s.setLocationFilter(h.shape.name, h.barangay.name); s.flyTo([h.barangay.lat, h.barangay.lng], MAP_CONFIG.BARANGAY_ZOOM); }
      else { const c = h.shape.bounds.getCenter(); s.setLocationFilter(h.shape.name, ''); s.flyTo([c.lat, c.lng], map.getBoundsZoom(h.shape.bounds)); }
    };
    const onOut = () => tooltip.remove();
    // movestart: a click flies the map without a mousemove, which left the label stuck on the old spot.
    map.on('mousemove', onMove).on('click', onClick).on('mouseout', onOut).on('movestart', onOut);
    return () => { map.off('mousemove', onMove).off('click', onClick).off('mouseout', onOut).off('movestart', onOut); tooltip.remove(); };
  }, [map, shapes, barangayShapes, interactive]);

  return null;
}

const number = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

// The on-map card for the picked location (review 3.1 / 10.1).
export function LocationCard() {
  const m = useStore(s => s.selectedMunicipality);
  const b = useStore(s => s.selectedBarangay);
  const layers = useStore(s => s.referenceLayers);
  if (!m) return null;
  const rows = profiles.filter(p => p.municipality === m && (!b || p.barangay === b));
  const p = b ? rows[0] : undefined;
  const hazards = REFERENCE_LAYERS.filter(l => layers.includes(l.id));
  const close = () => {
    const s = useStore.getState(), points = barangaysFor(m);
    s.setLocationFilter(b ? m : '', '');
    if (b && points.length) s.flyTo([points.reduce((n, p) => n + p.lat, 0) / points.length, points.reduce((n, p) => n + p.lng, 0) / points.length], MAP_CONFIG.MUNICIPALITY_ZOOM);
    else s.flyTo(MAP_CONFIG.PROVINCE_CENTER, MAP_CONFIG.DEFAULT_ZOOM);
  };
  return <div className="location-card" role="region" aria-label="Selected location">
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs uppercase tracking-wide text-on-surface/60">{b ? `Barangay · ${m}` : 'Municipality'}</p>
        <h3 className="text-lg font-bold leading-tight">{b || m}</h3>
      </div>
      <button type="button" className="location-card-close" aria-label={b ? `Back to ${m}` : 'Back to province'} onClick={close}><X size={18} aria-hidden="true" /></button>
    </div>
    <dl className="location-card-facts">
      {!b && <><dt>Barangays</dt><dd>{rows.length}</dd></>}
      <dt>Area</dt><dd>{number(rows.reduce((n, r) => n + r.areaKm2, 0))} km²</dd>
      <dt>Population</dt><dd>{rows.reduce((n, r) => n + r.population, 0).toLocaleString()}</dd>
      {p && <><dt>Kapitan</dt><dd>{p.captain || 'Not supplied'}{p.contact ? ` · ${p.contact}` : ''}</dd><dt>DRRM contact</dt><dd>Not supplied</dd></>}
      {p && hazards.map(h => {
        // Storm surge and NOAH flood have no per-barangay table, so say so rather than drop the row.
        const key = SUSCEPTIBILITY_KEY[h.id];
        const levels = key ? (p.susceptibility as Record<string, string[]>)[key] ?? [] : [];
        return <Fragment key={h.id}><dt>{h.label}</dt><dd>{key ? levels.join(', ') || 'Not Susceptible' : 'No barangay data. Click a zone on the map.'}</dd></Fragment>;
      })}
    </dl>
    {p && Object.values(p.demographics).some(v => v !== null) && <dl className="location-card-facts">
      {Object.entries(p.demographics).map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value === null ? 'Not supplied' : (value as number).toLocaleString()}</dd></Fragment>)}
    </dl>}
    {p && !layers.some(id => REFERENCE_LAYERS.some(l => l.id === id)) && <p className="text-xs text-on-surface/60 mt-2">Pick a layer under Hazard zones to see this barangay's susceptibility.</p>}
    {!b && <p className="text-xs text-on-surface/60 mt-2">Click inside {m} to pick a barangay.</p>}
  </div>;
}
