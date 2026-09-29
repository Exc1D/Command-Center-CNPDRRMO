import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PopulationExposure } from './PopulationExposure';
import { useStore } from '../lib/store';
import { summarizeLayerExposure, type ExposureIndex } from '../server/layerExposure';

const index:ExposureIndex={version:1,generatedAt:'2026-09-28T00:00:00Z',method:'Original polygons.',sources:[],repairs:[],municipalities:['Paracale'],classes:[{id:'high',layer:'flood',label:'High'}],buckets:[{municipality:'Paracale',barangay:null,classes:['high'],matchedRecords:1,populationSum:0,missingPopulationRecords:1,duplicateIdRecords:0}]};
beforeEach(()=>{useStore.setState({...useStore.getInitialState(),referenceLayers:['flood'],isMapAuthorized:true,selectedMunicipality:'Paracale',activeSusceptibilityFilters:[]});});
afterEach(()=>vi.unstubAllGlobals());
it('gates private analysis, respects map filters, and clears results when locked',async()=>{
  const fetcher=vi.fn(async(_url:string,options:RequestInit)=>({ok:true,json:async()=>summarizeLayerExposure(index,JSON.parse(options.body as string))}));
  vi.stubGlobal('fetch',fetcher);
  useStore.setState({isMapAuthorized:false});
  render(<PopulationExposure/>);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Unlock population analysis'}));
  expect(useStore.getState().isPinModalOpen).toBe(true);
  useStore.setState({isMapAuthorized:true});
  await waitFor(()=>expect(screen.getByText('Compare selected hazards')).toBeInTheDocument());
  expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
  expect(screen.getByText('Provisional estimates, not confirmed affected-person counts.')).toBeInTheDocument();
  expect(screen.getByText(/Paracale records lack population values/)).toBeInTheDocument();
  expect(screen.queryByText('Source files and fingerprints')).not.toBeInTheDocument();
  expect(screen.queryByText(/Unknown \(0\.0%\)/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('High',{exact:true}));
  await waitFor(()=>expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body as string).floodClasses).toEqual(['High']));
  useStore.setState({isMapAuthorized:false});
  await waitFor(()=>expect(screen.queryByText('Compare selected hazards')).not.toBeInTheDocument());
});
it('reports unavailable analysis with retry instead of a false zero',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:503,json:async()=>({error:'Dataset unavailable'})})));
  render(<PopulationExposure/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Dataset unavailable');
  expect(screen.getByRole('button',{name:'Retry analysis'})).toBeInTheDocument();
  expect(screen.queryByText('Combined exposure')).not.toBeInTheDocument();
});
