import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MapContainer, useMap } from 'react-leaflet';
import L from 'leaflet';
import DangerMap, { MonitoringPins } from './Map';
import { incidentIcon } from './ReferenceMapLayers';
import { useStore } from '../lib/store';
import { usePlanningStore } from '../lib/planningStore';

beforeEach(() => {
  useStore.setState(useStore.getInitialState());
  usePlanningStore.setState(usePlanningStore.getInitialState());
});
afterEach(() => vi.unstubAllGlobals());

it('offers only pin tools and opens point details without retaining temporary markers', async () => {
  useStore.setState({ isMapAuthorized: true });
  let map: L.Map;
  function CaptureMap() { map = useMap(); return null; }
  const view = render(<MapContainer center={[14, 123]} zoom={10}><CaptureMap /><MonitoringPins /></MapContainer>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add incident or resource pin' })).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Add evacuation center pin' })).toBeInTheDocument();
  expect(view.container.querySelectorAll('.leaflet-pm-toolbar .leaflet-buttons-control-button')).toHaveLength(2);
  act(() => {
    const layer = L.marker([14, 123]).addTo(map);
    map.fire('pm:create', { shape: 'Marker', layer });
    expect(map.hasLayer(layer)).toBe(false);
  });
  expect(useStore.getState()).toMatchObject({ isDropTagModalOpen: true, dropTagTempGeometry: { type: 'Point', coordinates: [123, 14] } });
  act(() => {
    useStore.getState().closeDropTagModal();
    // A late event from a previous drawing mode must not create a monitoring area.
    map.fire('pm:create', { shape: 'Polygon', layer: L.polygon([[14,123],[14,124],[15,123]]) });
  });
  expect(useStore.getState().isDropTagModalOpen).toBe(false);
  act(() => map.fire('pm:create', { shape: 'CircleMarker', layer: L.circleMarker([14, 123]) }));
  expect(useStore.getState()).toMatchObject({ isEvacuationCenterModalOpen: true, evacuationCenterTempCoords: [123, 14] });
  act(() => {
    map.pm.enableDraw('Marker');
    useStore.getState().setMapAuthorized(false);
  });
  expect(map.pm.globalDrawModeEnabled()).toBe(false);
  expect(view.container.querySelector('.leaflet-pm-toolbar')).toBeNull();
  view.unmount();
});

it('renders a chosen planning symbol and retains the default hazard icon for old records', () => {
  expect(incidentIcon('flood', 'ambulance').options.html).toContain('lucide-ambulance');
  expect(incidentIcon('flood').options.html).toContain('lucide-droplets');
  expect(incidentIcon('resource', 'eoc').options.html).toContain('lucide-radio-tower');
});

it('keeps resource pins visible without hazard filters and opens their saved details', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const resource={id:'ambulance',type:'resource',symbolKey:'ambulance',severity:'Not applicable',title:'Team Alpha',municipality:'Daet',barangay:'Bagasbas',notes:'',geometry:{type:'Point',coordinates:[123,14]},dateAdded:'2026-10-11T00:00:00Z'};
  useStore.setState({activeFilters:[],isMapAuthorized:true});
  useStore.getState().setHazards([resource]);
  const view=render(<DangerMap/>);
  await waitFor(()=>expect(screen.getByTitle('Team Alpha')).toBeInTheDocument());
  expect(screen.getByTitle('Team Alpha').querySelector('.lucide-ambulance')).toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Team Alpha'));
  expect(useStore.getState().selectedHazard).toEqual(resource);
  act(()=>useStore.getState().setLocationFilter('Basud',''));
  expect(screen.queryByTitle('Team Alpha')).not.toBeInTheDocument();
  act(()=>useStore.getState().setLocationFilter('Daet','Bagasbas'));
  expect(screen.getByTitle('Team Alpha')).toBeInTheDocument();
  act(()=>useStore.getState().toggleIncidents());
  expect(screen.queryByTitle('Team Alpha')).not.toBeInTheDocument();
  view.unmount();
});
