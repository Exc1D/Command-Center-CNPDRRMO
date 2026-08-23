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
import floodSusceptibilityUrl from '../../CamarinesNorte_FloodPerMunicipality.geojson?url';
import { getCentroid } from '../lib/utils';

const SUSCEP_STYLES: Record<string, { color: string; fillOpacity: number }> = {
  'Very High': { color: '#001f3f', fillOpacity: 0.35 },
  'High': { color: '#7b2cbf', fillOpacity: 0.35 },
  'Moderate': { color: '#d63384', fillOpacity: 0.35 },
  'Low': { color: '#fccde5', fillOpacity: 0.4 }
};

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

export async function removeHazard(hazardId: string) {
  await HazardAPI.deleteHazard(hazardId);
  useStore.getState().setHazards(await HazardAPI.getAllHazards());
}

export async function updateHazardGeometry(hazard: any, geometry: any) {
  await HazardAPI.updateHazard({ ...hazard, geometry });
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
      if (map.pm) map.pm.removeControls();
      return;
    }

    // Add Geoman controls
    map.pm.addControls({
      position: 'topleft',
      drawMarker: true,  // Enable marker drawing for evacuation centers
      drawCircleMarker: false,
      drawPolyline: true,
      drawRectangle: true,
      drawPolygon: true,
      drawCircle: false,
      editMode: true,
      dragMode: true,
      cutPolygon: false,
      removalMode: true, // Enabled for shape deletion feature
    });

    // Styles for drawn paths based on Editorial Resilience
    map.pm.setPathOptions({
      color: 'var(--color-primary)',
      fillColor: 'var(--color-surface-container)',
      fillOpacity: 0.4,
    });

    // Handle creation
    map.on('pm:create', (e) => {
      const layer = e.layer;
      const geojson = (layer as any).toGeoJSON();

      // FIXED: Use instanceof check for more reliable marker detection
      // Geoman's pmType may not be set yet at this point, so check the layer class directly
      if (layer instanceof L.Marker) {
        // Evacuation center marker
        map.removeLayer(layer);
        const coords: [number, number] = [geojson.geometry.coordinates[0], geojson.geometry.coordinates[1]];
        openEvacuationCenterModal(coords);
      } else {
        // Hazard polygon/polyline/rectangle
        map.removeLayer(layer);
        openDropTagModal(geojson.geometry);
      }
    });

    // Enable delete shape feature wired natively to our database
    map.on('pm:remove', async (e) => {
      const hazardId = (e.layer as any).hazardId;
      if (hazardId) {
        try {
          await removeHazard(hazardId);
        } catch (error) {
          console.error('Failed to delete hazard:', error);
        }
      }
    });

    return () => {
      if (map.pm) map.pm.removeControls();
      map.off('pm:create');
      map.off('pm:remove');
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
    loadEvacuationCenters();
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
        icon: evacuationCenterIcon
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
  }, [evacuationCentersVisible, evacuationCenters, map, setSelectedEvacuationCenter]);

  return null;
}

export default function DangerMap() {
  const baseMap = useStore(state => state.baseMap);
  const filteredHazards = useStore(state => state.filteredHazards);
  const setSelectedHazard = useStore(state => state.setSelectedHazard);
  const activeFilters = useStore(state => state.activeFilters);
  const activeSusceptibilityFilters = useStore(state => state.activeSusceptibilityFilters);
  const [susceptibilityGeoJSON, setSusceptibilityGeoJSON] = useState<any>(null);
  const isPlanningMode = usePlanningStore(state => state.isPlanningMode);

  useEffect(() => {
    if (activeFilters.includes('flood')) {
      fetch(floodSusceptibilityUrl)
        .then(res => res.json())
        .then(data => setSusceptibilityGeoJSON(data))
        .catch(err => console.error('Failed to load flood susceptibility data:', err));
    } else {
      setSusceptibilityGeoJSON(null);
    }
  }, [activeFilters]);

  const suscepStyle = (feature: any) => {
    const suscep = feature?.properties?.Suscep;
    const style = SUSCEP_STYLES[suscep] || { color: '#999', fillOpacity: 0.2 };
    return {
      color: style.color,
      weight: 1,
      opacity: 0.6,
      fillColor: style.color,
      fillOpacity: style.fillOpacity
    };
  };

  const onEachSuscepFeature = (feature: any, layer: L.Layer) => {
    const suscep = feature?.properties?.Suscep;
    const municipality = feature?.properties?.Municipali;
    const label = `${municipality}: ${suscep || 'Unknown'}`;

    layer.bindTooltip(label, {
      permanent: false,
      direction: 'center',
      className: 'susceptibility-tooltip'
    });

    layer.on({
      mouseover: (e) => {
        const target = e.target;
        target.setStyle({ fillOpacity: 0.6, weight: 2 });
      },
      mouseout: (e) => {
        const target = e.target;
        target.setStyle(suscepStyle(feature));
      }
    });
  };

  const mapUrls = {
    street: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    topo: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
  };

  const getStyle = (hazard: any) => {
    const typeDef = DISASTER_TYPES.find(t => t.id === hazard.type);
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
        target.setStyle({
          fillOpacity: 0.5,
          weight: 4
        });
      },
      mouseout: (e) => {
        const target = e.target;
        target.setStyle({
          fillOpacity: 0.25,
          weight: 3
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
          attribution="&copy; DRRMC Camarines Norte"
        />
        {!isPlanningMode && <GeomanSetup />}
        {isPlanningMode && <PlanningMapLayer />}
        <PublishedPlanningLayers />
        <MapScaleControl />
        <FlyToHandler />
        <EvacuationCenterMarkersHandler />

        {susceptibilityGeoJSON && (
          <GeoJSON
            key={`susceptibility-layer-${activeSusceptibilityFilters.join('-')}`}
            data={susceptibilityGeoJSON}
            filter={feature => activeSusceptibilityFilters.length === 0 || activeSusceptibilityFilters.includes(feature?.properties?.Suscep)}
            style={suscepStyle}
            onEachFeature={onEachSuscepFeature}
            pane="overlayPane"
          />
        )}

        <FeatureGroup>
          {filteredHazards.filter(hazard => getCentroid(hazard.geometry)).map(hazard => {
            const geojson = {
              type: "Feature",
              properties: { fullData: hazard },
              geometry: hazard.geometry
            };
            return (
              <GeoJSON
                key={hazard.id + hazard.syncStatus + hazard.severity}
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
