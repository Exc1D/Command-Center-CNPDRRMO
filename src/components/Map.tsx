import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap, GeoJSON, FeatureGroup } from 'react-leaflet';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import { useStore } from '../lib/store';
import { EvacuationCenterAPI } from '../lib/api';
import { MAP_CONFIG } from '../lib/constants';
import { usePlanningStore } from '../lib/planningStore';
import { MapScaleControl, PlanningMapLayer, PublishedPlanningLayers } from './PlanningMapLayer';
import { ReferenceMapLayers, incidentIcon } from './ReferenceMapLayers';
import { hazardDefinition, filterMapRecords, ROAD_STATUS } from '../lib/reference';
import { centerOccupancyTone, getCentroid } from '../lib/utils';

// Fix Leaflet icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c] || c);
}

export const CENTER_TYPE_LABELS: Record<string, string> = {
  school: 'School',
  barangay_hall: 'Barangay Hall',
  church: 'Church',
  covered_court: 'Covered Court',
  other: 'Other',
};

const GEOMAN_TRANSLATIONS = {
  tooltips: { placeMarker: 'Click the map to add an incident or resource pin' },
  actions: { cancel: 'Stop tool' },
  buttonTitles: {
    drawMarkerButton: 'Add incident or resource pin',
    drawCircleMarkerButton: 'Add evacuation center pin',
    drawLineButton: 'Mark road status along a line',
  },
};

export async function loadEvacuationCenters() {
  const centers = await EvacuationCenterAPI.getAllCenters();
  useStore.getState().setEvacuationCenters(centers);
  return centers;
}

const evacuationCenterIcon = (color: string) => L.divIcon({
  className: 'evacuation-center-marker',
  html: `<div style="
    background: ${color};
    width: 32px;
    height: 32px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    border: 2px solid white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
  ">
    <svg style="transform: rotate(45deg); width: 16px; height: 16px; color: white;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

export function MonitoringPins() {
  const map = useMap();
  const openDropTagModal = useStore(state => state.openDropTagModal);
  const openEvacuationCenterModal = useStore(state => state.openEvacuationCenterModal);
  const isMapAuthorized = useStore(state => state.isMapAuthorized);

  useEffect(() => {
    if (!isMapAuthorized) {
      if (map.pm) {
        map.pm.disableDraw();
        if (map.pm.globalEditModeEnabled()) map.pm.disableGlobalEditMode();
        if (map.pm.globalDragModeEnabled()) map.pm.disableGlobalDragMode();
        if (map.pm.globalRemovalModeEnabled()) map.pm.disableGlobalRemovalMode();
        map.pm.removeControls();
      }
      return;
    }

    map.pm.setLang('en', GEOMAN_TRANSLATIONS, 'en');
    map.pm.addControls({
      position: 'topleft',
      drawMarker: true,
      drawCircleMarker: true,
      drawPolyline: true,
      drawRectangle: false,
      drawPolygon: false,
      drawCircle: false,
      drawText: false,
      editMode: false,
      dragMode: false,
      cutPolygon: false,
      removalMode: false,
      rotateMode: false,
    });

    map.getContainer().querySelectorAll('.leaflet-pm-toolbar a[role="button"]').forEach(button => {
      const label=button.closest('[title]')?.getAttribute('title');
      if(label) button.setAttribute('aria-label',label);
    });
    const beginDrawing=()=>map.getContainer().classList.add('incident-drawing');
    const endDrawing=()=>map.getContainer().classList.remove('incident-drawing');
    map.on('pm:drawstart',beginDrawing);
    map.on('pm:drawend',endDrawing);

    // Handle creation
    const created = (e: L.LeafletEvent & { layer: L.Layer; shape: string }) => {
      const layer = e.layer;
      const geojson = (layer as any).toGeoJSON();
      map.pm.disableDraw();
      map.removeLayer(layer);

      // Monitoring creates points and road-status lines; existing areas remain viewable.
      if (e.shape === 'CircleMarker') {
        // Evacuation center marker
        const coords: [number, number] = [geojson.geometry.coordinates[0], geojson.geometry.coordinates[1]];
        openEvacuationCenterModal(coords);
      } else if ((e.shape === 'Marker' && geojson.geometry.type === 'Point') || (e.shape === 'Line' && geojson.geometry.type === 'LineString')) {
        // Incident, resource or road status
        openDropTagModal(geojson.geometry);
      }
    };
    map.on('pm:create', created);

    return () => {
      if (map.pm) {
        map.pm.disableDraw();
        if (map.pm.globalEditModeEnabled()) map.pm.disableGlobalEditMode();
        if (map.pm.globalDragModeEnabled()) map.pm.disableGlobalDragMode();
        if (map.pm.globalRemovalModeEnabled()) map.pm.disableGlobalRemovalMode();
        map.pm.removeControls();
      }
      map.off('pm:drawstart',beginDrawing);
      map.off('pm:drawend',endDrawing);
      endDrawing();
      map.off('pm:create', created);
    };
  }, [map, openDropTagModal, openEvacuationCenterModal, isMapAuthorized]);

  return null;
}

function FlyToHandler() {
  const mapCenter = useStore(state => state.mapCenter);
  const mapZoom = useStore(state => state.mapZoom);
  const map = useMap();
  const firstRun = useRef(true);

  useEffect(() => {
    // The province default means "home": fit the province to whatever screen size this is.
    const home = mapZoom === MAP_CONFIG.DEFAULT_ZOOM && mapCenter[0] === MAP_CONFIG.PROVINCE_CENTER[0] && mapCenter[1] === MAP_CONFIG.PROVINCE_CENTER[1];
    const animate = !firstRun.current;
    firstRun.current = false;
    // The zoom floor keeps a map that loads mostly covered (phone sidebar) from opening on the whole country.
    const [center, zoom] = home
      ? [L.latLngBounds(MAP_CONFIG.PROVINCE_BOUNDS).getCenter(), Math.max(map.getBoundsZoom(MAP_CONFIG.PROVINCE_BOUNDS), MAP_CONFIG.DEFAULT_ZOOM - 1)]
      : [L.latLng(mapCenter), mapZoom];
    // Leaflet's flyTo divides by the container size, so a hidden (0×0) map would throw NaN LatLng.
    if (!map.getSize().x) map.setView(mapCenter, mapZoom);
    else if (animate) map.flyTo(center, zoom, { duration: 1.5 });
    else map.setView(center, zoom);
  }, [mapCenter, mapZoom, map]);

  return null;
}

// Dims everything outside Camarines Norte so the province reads as the working area.
function ProvinceMask() {
  const map = useMap();

  useEffect(() => {
    const controller = new AbortController();
    let mask: L.Polygon | undefined;
    const pane = map.getPane('provinceMask') ?? map.createPane('provinceMask');
    pane.style.zIndex = '350'; // above base tiles, below every data layer
    pane.style.pointerEvents = 'none';
    fetch('/reference/province.geojson', { signal: controller.signal }).then(response => response.json()).then(data => {
      // Each island's outer ring becomes a hole in a world-sized polygon.
      const holes = data.features[0].geometry.coordinates.map((polygon: number[][][]) => polygon[0].map(([lng, lat]) => [lat, lng]));
      mask = L.polygon([[[85, -180], [85, 180], [-85, 180], [-85, -180]], ...holes], {
        pane: 'provinceMask', interactive: false, pmIgnore: true,
        color: '#334155', weight: 1.5, opacity: 0.7, fillColor: '#0f172a', fillOpacity: 0.3,
      } as L.PolylineOptions).addTo(map);
    }).catch(() => {}); // ponytail: cosmetic layer, the map works without it
    return () => { controller.abort(); mask?.remove(); };
  }, [map]);

  return null;
}

function EvacuationCenterMarkersHandler() {
  const map = useMap();
  const evacuationCentersVisible = useStore(state => state.evacuationCentersVisible);
  const evacuationCenters = useStore(state => state.evacuationCenters);
  const setSelectedEvacuationCenter = useStore(state => state.setSelectedEvacuationCenter);

  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    if (!evacuationCentersVisible) return;
    loadEvacuationCenters().catch(()=>useStore.getState().setSyncError('Could not load evacuation centers'));
  }, [evacuationCentersVisible]);

  useEffect(() => {
    markersRef.current.forEach(marker => {
      map.removeLayer(marker);
    });
    markersRef.current = [];

    if (!evacuationCentersVisible) return;

    evacuationCenters.forEach((center) => {
      if (!Array.isArray(center.coordinates) || center.coordinates.length < 2 || !center.coordinates.every(Number.isFinite)) return;
      const marker = L.marker([center.coordinates[1], center.coordinates[0]], {
        icon: evacuationCenterIcon(centerOccupancyTone(center).color), pmIgnore: true
      }) as any;
      marker._evacuationCenterMarker = true;

      marker.bindPopup(`
        <div style="min-width: 150px;">
          <strong style="font-size: 14px;">${escapeHtml(String(center.name || 'Unnamed center'))}</strong>
          <p style="margin: 4px 0; color: #666; font-size: 12px;">${CENTER_TYPE_LABELS[center.type] || ''}</p>
          <p style="margin: 2px 0; font-size: 12px; font-weight: 600;">${centerOccupancyTone(center).label}</p>
          <p style="margin: 2px 0; font-size: 12px;">Inside now: ${Number(center.personsNow ?? 0)} / ${Number(center.capacity)} persons (${Number(center.familiesNow ?? 0)} families)</p>
          <p style="margin: 2px 0; font-size: 12px;">${escapeHtml(String(center.barangay || ''))}${center.municipality ? `, ${escapeHtml(String(center.municipality))}` : ''}</p>
        </div>
      `);

      marker.on('click', () => {
        setSelectedEvacuationCenter(center);
      });

      marker.addTo(map);
      markersRef.current.push(marker);
    });
    return ()=>{markersRef.current.forEach(marker=>map.removeLayer(marker));markersRef.current=[];};
  }, [evacuationCentersVisible, evacuationCenters, map, setSelectedEvacuationCenter]);

  return null;
}

export default function DangerMap() {
  const baseMap = useStore(state => state.baseMap);
  const filteredHazards = useStore(state => state.filteredHazards);
  const hazards = useStore(state => state.hazards);
  const municipality = useStore(state => state.selectedMunicipality);
  const barangay = useStore(state => state.selectedBarangay);
  const resourcePins = filterMapRecords(hazards, ['resource', 'road'], municipality, barangay);
  const setSelectedHazard = useStore(state => state.setSelectedHazard);
  const incidentsVisible = useStore(state => state.incidentsVisible);
  const isPlanningMode = usePlanningStore(state => state.isPlanningMode);
  const mapUrls = {
    street: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    topo: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
  };

  const getStyle = (hazard: any) => {
    if (hazard.type === 'road') return { color: ROAD_STATUS[hazard.severity] ?? '#475569', weight: 6, opacity: 0.95, dashArray: hazard.severity === 'Not passable' ? '10 6' : undefined };
    const typeDef = hazardDefinition(hazard.type);
    const baseColor = typeDef?.color || 'var(--color-primary)';
    
    let opacity = 0.25;
    let weight = 2;
    
    switch (hazard.severity) {
      case 'Minor':
        opacity = 0.15;
        weight = 1;
        break;
      case 'Moderate':
        opacity = 0.35;
        weight = 2;
        break;
      case 'Severe':
        opacity = 0.6;
        weight = 3;
        break;
      case 'Critical':
        opacity = 0.85;
        weight = 4;
        break;
    }

    return {
      color: baseColor,
      weight: weight,
      opacity: 0.9,
      fillColor: baseColor,
      fillOpacity: opacity
    };
  };

  const onEachFeature = (feature: any, layer: L.Layer) => {
    layer.on({
      mouseover: (e) => {
        const target = e.target;
        if (target instanceof L.Path) target.setStyle({
          fillOpacity: 0.5,
          weight: 4
        });
      },
      mouseout: (e) => {
        const target = e.target;
        if (target instanceof L.Path) target.setStyle({
          ...getStyle(feature.properties.fullData)
        });
      },
      click: (e) => {
        L.DomEvent.stopPropagation(e as any);
        const properties = feature.properties;
        setSelectedHazard(properties.fullData);
      }
    });
  };

  return (
    <div className="w-full h-full relative z-0 bg-surface">
      <MapContainer 
        center={MAP_CONFIG.PROVINCE_CENTER}
        zoom={MAP_CONFIG.DEFAULT_ZOOM} 
        style={{ height: "100%", width: "100%", background: 'transparent' }}
        zoomControl={false}
      >
        <TileLayer
          key={baseMap}
          url={mapUrls[baseMap]}
          attribution={baseMap === "satellite" ? "Tiles © Esri and contributors" : baseMap === "topo" ? "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)" : "© OpenStreetMap contributors"}
        />
        {!isPlanningMode && <MonitoringPins />}
        {isPlanningMode && <PlanningMapLayer />}
        {isPlanningMode && <PublishedPlanningLayers />}
        <ProvinceMask />
        <MapScaleControl /><MapResizeHandler />
        <FlyToHandler />
        <EvacuationCenterMarkersHandler />

        <ReferenceMapLayers />

        <FeatureGroup>
          {incidentsVisible && [...filteredHazards, ...resourcePins].filter(hazard => getCentroid(hazard.geometry)).map(hazard => {
            const geojson = {
              type: "Feature",
              properties: { fullData: hazard },
              geometry: hazard.geometry
            };
            return (
              <GeoJSON
                key={JSON.stringify(hazard)}
                pmIgnore={true}
                pointToLayer={(_feature,latlng)=>L.marker(latlng,{title:hazard.title || hazardDefinition(hazard.type)?.label || 'Resource pin',alt:hazard.title || (hazard.type==='resource'?'Resource pin':'Incident'),icon:incidentIcon(hazard.type,hazard.symbolKey,hazard.type==='road'?ROAD_STATUS[hazard.severity]:undefined),pmIgnore:true})}
                data={geojson as any}
                style={() => getStyle(hazard)}
                onEachFeature={onEachFeature}
              />
            );
          })}
        </FeatureGroup>
      </MapContainer>
    </div>
  );
}

function MapResizeHandler() {
  const map=useMap();
  useEffect(()=>{
    const observer=new ResizeObserver(()=>map.invalidateSize({pan:true,animate:false}));
    observer.observe(map.getContainer());
    return ()=>observer.disconnect();
  },[map]);
  return null;
}
