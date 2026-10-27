import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { AnalyticsPanel, summarizePlaces, rankPlaces, shelterStatus } from './AnalyticsPanel';
import { useStore } from '../lib/store';
import Sidebar from './Sidebar';
import { h1, h2, h3 } from '../test/fixtures/hazards';
import { ec1, ec2 } from '../test/fixtures/evacuationCenters';

const report=vi.hoisted(()=>({
  setFontSize:vi.fn(),text:vi.fn(),setFont:vi.fn(),addPage:vi.fn(),setFillColor:vi.fn(),rect:vi.fn(),
  splitTextToSize:vi.fn((text:string)=>[text]),addImage:vi.fn(),save:vi.fn(),
}));
vi.mock('jspdf',()=>({jsPDF:class {constructor(){return report;}}}));
vi.mock('html2canvas',()=>({default:vi.fn(async()=>({width:274,height:761,toDataURL:()=> 'data:image/jpeg;base64,test'}))}));

beforeEach(()=>{
  vi.clearAllMocks();
  useStore.setState({...useStore.getInitialState(),isAnalyticsOpen:true,activeFilters:['flood','landslide','vehicular_accident']});
  useStore.getState().setHazards([h1,h2,h3]);
});
const tile=(label:string)=>within(screen.getByRole('region',{name:'Headline figures'})).getByText(label).parentElement!;
it('shows headline figures and keeps unknown affected counts apart from zero',()=>{
  useStore.getState().setHazards([{...h1,affectedPopulation:0},{...h3,affectedPopulation:12},{...h2,affectedPopulation:null}]);
  useStore.getState().setEvacuationCenters([ec1,ec2,{...ec2,id:'gone',syncStatus:'pending_delete'}]);
  render(<AnalyticsPanel/>);
  expect(tile('Active incidents')).toHaveTextContent('31 severe');
  expect(tile('Barangays affected')).toHaveTextContent('3');
  expect(tile('People reported affected')).toHaveTextContent('121 incident without a count');
  expect(tile('Evacuation spaces')).toHaveTextContent('2302 centers');
});
it('ranks places by severity and drills down from municipality to barangay',()=>{
  render(<AnalyticsPanel/>);
  const focus=screen.getByRole('region',{name:'Where to focus'});
  expect(within(focus).getAllByRole('listitem').map(li=>li.querySelector('strong')!.textContent)).toEqual(['Mercedes','Daet']);
  fireEvent.click(within(focus).getByRole('button',{name:/Daet/}));
  expect(useStore.getState().selectedMunicipality).toBe('Daet');
  fireEvent.click(within(screen.getByRole('region',{name:'Where to focus'})).getByRole('button',{name:/Bagasbas/}));
  expect(useStore.getState().selectedBarangay).toBe('Bagasbas');
  expect(useStore.getState().filteredHazards.map(h=>h.id)).toEqual(['h1']);
});
it('flags shelter shortfalls, missing centers and enough space',()=>{
  useStore.getState().setHazards([{...h1,affectedPopulation:200},{...h2,affectedPopulation:10},{...h3,municipality:'Basud',barangay:'Poblacion 1',affectedPopulation:5}]);
  useStore.getState().setEvacuationCenters([ec1,ec2]);
  render(<AnalyticsPanel/>);
  const items=within(screen.getByRole('region',{name:'Shelter readiness'})).getAllByRole('listitem').map(li=>li.textContent);
  expect(items[0]).toMatch(/Basud.*No evacuation center recorded/);
  expect(items[1]).toMatch(/Daet.*Short by 50 spaces/);
  expect(items[2]).toMatch(/Mercedes.*Enough space/);
});
it('lists latest reports newest first and shows the selected one on the map',()=>{
  render(<AnalyticsPanel/>);
  const latest=within(screen.getByRole('region',{name:'Latest reports'})).getAllByRole('button');
  expect(latest.map(b=>b.querySelector('strong')!.textContent)).toEqual([h3.title,h2.title,h1.title]);
  fireEvent.click(latest[0]);
  expect(useStore.getState().selectedHazard?.id).toBe('h3');
  expect(useStore.getState().mapCenter).toEqual([14.1167055,122.9508094]);
});
it('shows an empty state that does not imply zero risk',()=>{
  useStore.getState().setHazards([]);
  render(<AnalyticsPanel/>);
  expect(screen.getByText(/No reports does not mean no risk/,{selector:'p.rounded-2xl'})).toBeInTheDocument();
  expect(screen.queryByRole('region',{name:'Where to focus'})).not.toBeInTheDocument();
});
it('shares dependent geographic filters with the map and preserves hazard filters',()=>{
  render(<AnalyticsPanel/>);
  fireEvent.change(screen.getByLabelText('Municipality'),{target:{value:'Daet'}});
  fireEvent.change(screen.getByLabelText('Barangay'),{target:{value:'Bagasbas'}});
  expect(useStore.getState().filteredHazards.map(h=>h.id)).toEqual(['h1']);
  fireEvent.change(screen.getByLabelText('Municipality'),{target:{value:'Mercedes'}});
  expect(useStore.getState().selectedBarangay).toBe('');
  expect(useStore.getState().filteredHazards.map(h=>h.id)).toEqual(['h2']);
});
it('keeps incident-log navigation removed',()=>{
  render(<><Sidebar/><AnalyticsPanel/></>);
  expect(screen.queryByRole('button',{name:/Incident Logs/})).not.toBeInTheDocument();
});
it('exports a situation report and the map without stretching a narrow viewport',async()=>{
  render(<><div className="leaflet-container"/><AnalyticsPanel/></>);
  fireEvent.click(screen.getByRole('button',{name:'Export Report'}));
  await waitFor(()=>expect(report.save).toHaveBeenCalled());
  const image=report.addImage.mock.calls.at(-1)!;
  expect(image[4]/image[5]).toBeCloseTo(274/761);
  expect(image[5]).toBe(155);
  expect(report.text).toHaveBeenCalledWith('Map context - current visible layers',12,15);
  expect(report.text).toHaveBeenCalledWith(['Camarines Norte - Situation Report · Camarines Norte'],12,15);
  expect(report.text).toHaveBeenCalledWith(['Mercedes: 1 severe · 1 total'],12,expect.any(Number));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('groups places case-insensitively and ranks critical before severe before volume',()=>{
  const places=summarizePlaces([
    {...h1,municipality:' daet ',barangay:' bagasbas ',affectedPopulation:12},
    {...h1,id:'b',affectedPopulation:null},
    {...h2,id:'c',severity:'Critical'},
    {...h3,id:'d',municipality:undefined,barangay:undefined},
  ],[ec1],true);
  expect(places.find(p=>p.name==='Bagasbas')).toMatchObject({municipality:'Daet',total:2,affected:12,unknown:1,centers:1,capacity:150});
  expect(places.find(p=>p.name==='Unknown barangay')).toMatchObject({municipality:'',total:1});
  expect(rankPlaces(places).map(p=>p.name)).toEqual(['Mercedes','Bagasbas','Unknown barangay']);
  expect(shelterStatus({...places[0],centers:1,capacity:5,affected:0,unknown:2,total:2}).label).toBe('Affected count not reported');
});
