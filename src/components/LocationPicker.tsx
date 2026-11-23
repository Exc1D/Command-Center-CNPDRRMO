import { Fragment, useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { X } from 'lucide-react';
import { useStore } from '../lib/store';
import { MAP_CONFIG } from '../lib/constants';
import { barangaysFor, municipalityFromBoundary, nearestBarangay, pointInShape, REFERENCE_LAYERS } from '../lib/reference';
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

  useEffect(() => {
    if (!shapes.length) return;
    if (!map.getPane('locations')) { const pane = map.createPane('locations'); pane.style.zIndex = '360'; pane.style.pointerEvents = 'none'; }
    const layer = L.layerGroup().addTo(map);
    const outlined = new Set(barangayShapes.map(b => `${b.municipality}|${b.name}`));
    barangayShapes.forEach(b => {
      const picked = b.municipality === municipality;
      L.geoJSON(b.geometry, { pane: 'locations', interactive: false, pmIgnore: true, style: {
        color: picked ? '#0a84ff' : '#64748b', weight: picked && b.name === barangay ? 3 : picked ? 1.2 : 0.6, opacity: picked ? 0.9 : 0.6, fill: false,
      } } as any).addTo(layer);
    });
    shapes.forEach(s => L.geoJSON(s.geometry, { pane: 'locations', interactive: false, pmIgnore: true, style: {
      color: s.name === municipality ? '#0a84ff' : '#334155', weight: s.name === municipality ? 3 : 1.5, opacity: 0.85, fill: false,
    } } as any).addTo(layer));
    // Dots only for barangays with no outline (or while the outline file is loading or missing).
    shapes.forEach(s => barangaysFor(s.name).filter(b => !outlined.has(`${s.name}|${b.name}`)).forEach(b => {
      const picked = s.name === municipality;
      L.circleMarker([b.lat, b.lng], { pane: 'locations', interactive: false, pmIgnore: true,
        radius: picked && b.name === barangay ? 7 : picked ? 4 : 2.5, color: '#fff', weight: picked ? 1.5 : 1,
        fillColor: picked ? '#0a84ff' : '#334155', fillOpacity: picked ? 1 : 0.7 } as any).addTo(layer);
    }));
    if (!interactive) return () => { layer.remove(); };

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
    map.on('mousemove', onMove).on('click', onClick).on('mouseout', onOut);
    return () => { map.off('mousemove', onMove).off('click', onClick).off('mouseout', onOut); tooltip.remove(); layer.remove(); };
  }, [map, shapes, barangayShapes, municipality, barangay, interactive]);

  return null;
}

const SUSCEPTIBILITY_KEY: Record<string, string> = { flood: 'Flood', landslide: 'Rain-Induced Landslide', tsunami: 'Tsunami', liquefaction: 'Liquefaction' };
const number = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

// The on-map card for the picked location (review 3.1 / 10.1).
export function LocationCard() {
  const m = useStore(s => s.selectedMunicipality);
  const b = useStore(s => s.selectedBarangay);
  const layers = useStore(s => s.referenceLayers);
  if (!m) return null;
  const rows = profiles.filter(p => p.municipality === m && (!b || p.barangay === b));
  const p = b ? rows[0] : undefined;
  const hazards = REFERENCE_LAYERS.filter(l => layers.includes(l.id) && SUSCEPTIBILITY_KEY[l.id]);
  const close = () => { const s = useStore.getState(); s.setLocationFilter(b ? m : '', ''); if (!b) s.flyTo(MAP_CONFIG.PROVINCE_CENTER, MAP_CONFIG.DEFAULT_ZOOM); };
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
        const levels = (p.susceptibility as Record<string, string[]>)[SUSCEPTIBILITY_KEY[h.id]] ?? [];
        return <Fragment key={h.id}><dt>{h.label}</dt><dd>{levels.join(', ') || 'Not Susceptible'}</dd></Fragment>;
      })}
    </dl>
    {p && !hazards.length && <p className="text-xs text-on-surface/60 mt-2">Turn on a hazard in Map layers to see this barangay's susceptibility.</p>}
    {!b && <p className="text-xs text-on-surface/60 mt-2">Click inside {m} to pick a barangay.</p>}
  </div>;
}
