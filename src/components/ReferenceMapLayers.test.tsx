import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MapContainer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { ReferenceMapLayers } from './ReferenceMapLayers';
import { useStore } from '../lib/store';
import { usePlanningStore } from '../lib/planningStore';

afterEach(() => vi.unstubAllGlobals());

it('shows transport and other facilities together and keeps legend interactions off the map', async () => {
  const categories=['School','Transportation: Port, Airport','Transportation: Port, Fishlanding/Dock/Pier','Transportation: Terminal, PUV/Bus'];
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({type:'FeatureCollection',features:categories.map((category,index)=>({type:'Feature',geometry:{type:'Point',coordinates:[123+index/100,14]},properties:{Name:category,SubCategor:category}}))})}));
  useStore.setState({...useStore.getInitialState(),elementLayers:['facilities']});
  usePlanningStore.setState({...usePlanningStore.getInitialState(),isPlanningMode:true});
  let map:L.Map;
  function CaptureMap() { map=useMap(); return null; }
  const view=render(<MapContainer center={[14,123]} zoom={14}><CaptureMap/><ReferenceMapLayers/></MapContainer>);
  await waitFor(()=>expect(view.container.querySelectorAll('.incident-icon')).toHaveLength(4));
  expect(view.container.querySelector('.lucide-plane')).toBeInTheDocument();
  expect(view.container.querySelector('.lucide-anchor')).toBeInTheDocument();
  expect(view.container.querySelector('.lucide-bus')).toBeInTheDocument();
  const click=vi.fn();map.on('click',click);
  fireEvent.click(screen.getByText('Hazard legend'));
  expect(click).not.toHaveBeenCalled();
  act(()=>useStore.getState().toggleElementLayer('facilities'));
  expect(view.container.querySelectorAll('.incident-icon')).toHaveLength(0);
  view.unmount();
});
