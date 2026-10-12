import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap, GeoJSON, FeatureGroup } from 'react-leaflet';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import { useStore, DISASTER_TYPES, SUSCEPTIBILITY_LEVELS } from '../lib/store';
import { HazardAPI, EvacuationCenterAPI } from '../lib/api';
import { v4 as uuidv4 } from 'uuid';
import { MAP_CONFIG } from '../lib/constants';
import { usePlanningStore } from '../lib/planningStore';
import { MapScaleControl, PlanningMapLayer, PublishedPlanningLayers } from './PlanningMapLayer';
import { ReferenceMapLayers, incidentIcon } from './ReferenceMapLayers';
import { hazardDefinition } from '../lib/reference';
import { getCentroid } from '../lib/utils';
import { HazardLegend } from './ReferenceControls';

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

export const GEOMAN_TRANSLATIONS = {
  tooltips: {
    placeMarker: 'Click the map to add an incident',
    firstVertex: 'Click the map to place the first point',
    continueLine: 'Click to add another point',
    finishLine: 'Click the first point or Save drawing to finish',
    finishPoly: 'Click the first point or Save drawing to finish',
    finishRect: 'Release to finish the rectangle',
    placeText: 'Click the map to add a note',
  },
  actions: {
    finish: 'Save drawing',
    removeLastVertex: 'Undo last point',
    cancel: 'Stop tool',
  },
  buttonTitles: {
    drawMarkerButton: 'Add incident',
    drawCircleMarkerButton: 'Add evacuation center',
    drawPolyButton: 'Draw hazard area',
    drawLineButton: 'Draw hazard line',
    drawRectButton: 'Draw rectangular hazard area',
    drawTextButton: 'Add map note',
    editButton: 'Edit a mapped hazard',
    dragButton: 'Move a mapped hazard',
    deleteButton: 'Delete a mapped hazard',
    rotateButton: 'Rotate a mapped hazard',
  },
};

export async function removeHazard(hazardId: string) {
  await HazardAPI.deleteHazard(hazardId);
  useStore.getState().setHazards(await HazardAPI.getAllHazards());
}

export async function updateHazardGeometry(hazard: any, geometry: any) {
  await HazardAPI.updateHazard({ ...hazard, geometry, ...(hazard.affectedPopulationBasis === 'population_estimate' ? {
    affectedPopulation: null, affectedPopulationBasis: 'reported',
    notes: (hazard.notes || '') + '\nIncident geometry changed; previous population estimate requires recalculation.',
  } : {}) });
  useStore.getState().setHazards(await HazardAPI.getAllHazards());
}

export async function loadEvacuationCenters() {
  const centers = await EvacuationCenterAPI.getAllCenters();
  useStore.getState().setEvacuationCenters(centers);
  return centers;
}

const evacuationCenterIcon = L.divIcon({
  className: 'evacuation-center-marker',
  html: `<div style="
    background: #059669;
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

function GeomanSetup() {
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
      drawPolyline: false,
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

      if (e.shape === 'CircleMarker') {
        const coords: [number, number] = [geojson.geometry.coordinates[0], geojson.geometry.coordinates[1]];
        openEvacuationCenterModal(coords);
      } else if (e.shape === 'Marker' && geojson.geometry.type === 'Point') {
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

  useEffect(() => {
    map.flyTo(mapCenter, mapZoom, { duration: 1.5 });
  }, [mapCenter, mapZoom, map]);

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
        icon: evacuationCenterIcon, pmIgnore: true
      }) as any;
      marker._evacuationCenterMarker = true;

      marker.bindPopup(`
        <div style="min-width: 150px;">
          <strong style="font-size: 14px;">${escapeHtml(String(center.name || 'Unnamed center'))}</strong>
          <p style="margin: 4px 0; color: #666; font-size: 12px;">${CENTER_TYPE_LABELS[center.type] || ''}</p>
          <p style="margin: 2px 0; font-size: 12px;">Capacity: ${Number(center.capacity)}</p>
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
  const setSelectedHazard = useStore(state => state.setSelectedHazard);
  const isMapAuthorized = useStore(state => state.isMapAuthorized);
  const incidentsVisible = useStore(state => state.incidentsVisible);
  const isPlanningMode = usePlanningStore(state => state.isPlanningMode);
  const referenceLayers = useStore(state => state.referenceLayers);
  const mapUrls = {
    street: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    topo: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
  };

  const getStyle = (hazard: any) => {
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
    // Attach ID so pm:remove can catch it
    (layer as any).hazardId = feature.properties.fullData.id;

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

    layer.on('pm:edit', async (e) => {
      const activeLayer = e.layer;
      const newGeom = (activeLayer as any).toGeoJSON().geometry;
      const hazardData = feature.properties.fullData;
      
      try {
        await updateHazardGeometry(hazardData, newGeom);
      } catch (error) {
        console.error('Failed to update hazard:', error);
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
        {!isPlanningMode && <GeomanSetup />}
        {isPlanningMode && <PlanningMapLayer />}
        {isPlanningMode && <PublishedPlanningLayers />}
        <MapScaleControl /><MapResizeHandler />
        <FlyToHandler />
        <EvacuationCenterMarkersHandler />

        <ReferenceMapLayers />

        <FeatureGroup>
          {incidentsVisible && filteredHazards.filter(hazard => getCentroid(hazard.geometry)).map(hazard => {
            const geojson = {
              type: "Feature",
              properties: { fullData: hazard },
              geometry: hazard.geometry
            };
            return (
              <GeoJSON
                key={JSON.stringify(hazard)+isMapAuthorized+isPlanningMode}
                pmIgnore={true}
                pointToLayer={(_feature,latlng)=>L.marker(latlng,{title:hazard.title || hazardDefinition(hazard.type)?.label || 'Incident',alt:hazard.title || 'Incident',icon:incidentIcon(hazard.type,hazard.symbolKey),pmIgnore:true})}
                data={geojson as any}
                style={() => getStyle(hazard)}
                onEachFeature={onEachFeature}
              />
            );
          })}
        </FeatureGroup>
      </MapContainer>
      {isPlanningMode && referenceLayers.length > 0 && <section aria-label="Hazard legend" className="absolute top-20 right-3 z-[450] w-64 max-w-[calc(100%-1.5rem)] rounded-xl bg-surface-container-lowest/95 text-on-surface p-3 shadow-panel">
        <details open><summary className="min-h-11 cursor-pointer text-sm font-bold">Hazard legend</summary><div className="max-h-[35vh] overflow-y-auto"><HazardLegend /></div></details>
      </section>}
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
