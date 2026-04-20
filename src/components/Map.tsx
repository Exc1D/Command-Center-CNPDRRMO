import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap, GeoJSON, FeatureGroup } from 'react-leaflet';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import { useStore, DISASTER_TYPES } from '../lib/store';
import { HazardAPI } from '../lib/api';
import { v4 as uuidv4 } from 'uuid';

// Fix Leaflet icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function GeomanSetup() {
  const map = useMap();
  const openDropTagModal = useStore(state => state.openDropTagModal);
  const isMapAuthorized = useStore(state => state.isMapAuthorized);
  
  useEffect(() => {
    if (!isMapAuthorized) {
      if (map.pm) map.pm.removeControls();
      return;
    }

    // Add Geoman controls
    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
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
      map.removeLayer(layer);
      openDropTagModal(geojson.geometry);
    });

    // Enable delete shape feature wired natively to our database
    map.on('pm:remove', async (e) => {
      const hazardId = (e.layer as any).hazardId;
      if (hazardId) {
        await HazardAPI.deleteHazard(hazardId);
        const hazards = await HazardAPI.getAllHazards();
        useStore.getState().setHazards(hazards);
      }
    });

    return () => {
      if (map.pm) map.pm.removeControls();
      map.off('pm:create');
      map.off('pm:remove');
    };
  }, [map, openDropTagModal, isMapAuthorized]);

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

export default function DangerMap() {
  const baseMap = useStore(state => state.baseMap);
  const filteredHazards = useStore(state => state.filteredHazards);
  const setSelectedHazard = useStore(state => state.setSelectedHazard);
  
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
      
      const updatedHazard = {
        ...hazardData,
        geometry: newGeom,
      };
      
      await HazardAPI.updateHazard(updatedHazard);
      const hazards = await HazardAPI.getAllHazards();
      useStore.getState().setHazards(hazards);
    });
  };

  return (
    <div className="w-full h-full relative z-0 bg-surface">
      <MapContainer 
        center={[14.1167, 122.9500]} 
        zoom={10} 
        style={{ height: "100%", width: "100%", background: 'transparent' }}
        zoomControl={false}
      >
        <TileLayer
          key={baseMap}
          url={mapUrls[baseMap]}
          attribution="&copy; DRRMC Camarines Norte"
        />
        <GeomanSetup />
        <FlyToHandler />

        <FeatureGroup>
          {filteredHazards.map(hazard => {
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
