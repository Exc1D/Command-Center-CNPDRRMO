import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import DangerMap from './Map';
import { useStore } from '../lib/store';
import { usePlanningStore } from '../lib/planningStore';

let map: L.Map;
vi.mock('./PlanningMapLayer', () => ({
  PlanningMapLayer: () => null,
  PublishedPlanningLayers: () => null,
  MapScaleControl: () => { map = useMap(); return null; },
}));
vi.mock('./ReferenceMapLayers', async importOriginal => ({
  ...await importOriginal<typeof import('./ReferenceMapLayers')>(),
  ReferenceMapLayers: () => null,
}));

beforeEach(() => {
  useStore.setState(useStore.getInitialState());
  useStore.setState({ isMapAuthorized: true });
  usePlanningStore.setState({ isPlanningMode: false });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

it('offers pins and road lines but ignores area creation in monitoring', async () => {
  const { container, unmount } = render(<DangerMap />);
  await waitFor(() => expect(container.querySelector('.leaflet-pm-icon-marker')).toBeInTheDocument());
  expect(container.querySelector('.leaflet-pm-icon-polygon')).not.toBeInTheDocument();
  expect(container.querySelector('.leaflet-pm-icon-polyline')).toBeInTheDocument();
  expect(container.querySelector('.leaflet-pm-icon-rectangle')).not.toBeInTheDocument();
  expect(container.querySelector('.leaflet-pm-icon-edit')).not.toBeInTheDocument();
  expect(container.querySelector('.leaflet-pm-icon-drag')).not.toBeInTheDocument();
  expect(container.querySelector('.leaflet-pm-icon-delete')).not.toBeInTheDocument();
  act(() => { map.fire('pm:create', { shape: 'Polygon', layer: L.polygon([[14,123],[14.1,123],[14,123.1]]) }); });
  expect(useStore.getState().isDropTagModalOpen).toBe(false);
  act(() => { map.fire('pm:create', { shape: 'Marker', layer: L.marker([14,123]) }); });
  expect(useStore.getState().dropTagTempGeometry).toEqual({ type: 'Point', coordinates: [123,14] });
  act(() => { map.fire('pm:create', { shape: 'CircleMarker', layer: L.circleMarker([14,123]) }); });
  expect(useStore.getState().isEvacuationCenterModalOpen).toBe(true);
  act(() => usePlanningStore.setState({ isPlanningMode: true }));
  expect(container.querySelector('.leaflet-pm-toolbar')).not.toBeInTheDocument();
  unmount();
});

it('renders a saved planning symbol on a monitoring pin and retains the default hazard icon', () => {
  useStore.setState({ filteredHazards: [
    { id: 'boat', type: 'flood', severity: 'Moderate', notes: '', dateAdded: new Date().toISOString(), symbolKey: 'rescue-boat', geometry: { type: 'Point', coordinates: [123,14] } },
    { id: 'default', type: 'flood', severity: 'Moderate', notes: '', dateAdded: new Date().toISOString(), geometry: { type: 'Point', coordinates: [123.1,14] } },
  ] });
  const { container } = render(<DangerMap />);
  expect(container.querySelector('.incident-icon .lucide-ship-wheel')).toBeInTheDocument();
  expect(container.querySelector('.incident-icon .lucide-droplets')).toBeInTheDocument();
});

it('removes pin tools when operations are locked', () => {
  const { container } = render(<DangerMap />);
  act(() => useStore.setState({ isMapAuthorized: false }));
  expect(container.querySelector('.leaflet-pm-toolbar')).not.toBeInTheDocument();
});
