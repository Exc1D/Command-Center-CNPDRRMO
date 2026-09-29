import { act, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MapContainer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { PlanningMapLayer } from './PlanningMapLayer';
import { usePlanningStore } from '../lib/planningStore';
import { useStore } from '../lib/store';

afterEach(() => vi.unstubAllGlobals());

it('allows point placement above references only during editable placement, then restores map interaction', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ features: [{ geometry: { type: 'Polygon', coordinates: [[[122, 13], [124, 13], [124, 15], [122, 15], [122, 13]]] } }] }) }));
  useStore.setState({ isMapAuthorized: true });
  usePlanningStore.getState().newBoard();
  let map: L.Map;
  function CaptureMap() { map = useMap(); return null; }
  const view = render(<MapContainer center={[14, 123]} zoom={10}><CaptureMap /><PlanningMapLayer /></MapContainer>);
  await waitFor(() => expect(map).toBeDefined());
  act(() => {
    map.openPopup('Reference hazard', [14, 123]);
    usePlanningStore.getState().setSymbolKey('rescue-boat');
  });
  await waitFor(() => expect(map.getContainer()).toHaveClass('planning-placing'));
  expect(view.container.querySelector('.leaflet-popup')).toBeNull();
  act(() => { map.fire('click', { latlng: L.latLng(14, 123) }); });
  expect(usePlanningStore.getState().history!.present.objects).toEqual([expect.objectContaining({ kind: 'symbol', symbolKey: 'rescue-boat', coordinates: [[123, 14]] })]);
  expect(map.getContainer()).not.toHaveClass('planning-placing');
  act(() => { usePlanningStore.getState().setTool('text'); });
  expect(map.getContainer()).toHaveClass('planning-placing');
  act(() => { usePlanningStore.getState().setTool('select'); });
  expect(map.getContainer()).not.toHaveClass('planning-placing');
  act(() => {
    usePlanningStore.getState().edit(current => ({ ...current, layers: { ...current.layers, symbols: { visible: true, locked: true } } }));
    usePlanningStore.getState().setTool('symbol');
  });
  expect(map.getContainer()).not.toHaveClass('planning-placing');
  act(() => {
    usePlanningStore.getState().setTool('text');
    useStore.setState({ isMapAuthorized: false });
  });
  expect(map.getContainer()).not.toHaveClass('planning-placing');
  view.unmount();
});
