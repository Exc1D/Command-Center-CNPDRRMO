import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { AnalyticsPanel, summarizeBarangays, summarizeMunicipalities } from './AnalyticsPanel';
import { useStore } from '../lib/store';
import Sidebar from './Sidebar';
import { h1, h2, h3 } from '../test/fixtures/hazards';

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
it('shows per-municipality severity counts and the requested matrix columns',()=>{
  render(<AnalyticsPanel/>);
  const daet=screen.getByRole('row',{name:/Daet/});
  expect(within(daet).getAllByRole('cell').map(c=>c.textContent)).toEqual(['1','1','0','0','2']);
  fireEvent.click(screen.getByRole('button',{name:'Matrix'}));
  for(const name of ['Municipality','Barangay','Hazard','Incident','Severity','Affected']) expect(screen.getByRole('columnheader',{name,exact:true})).toBeInTheDocument();
  expect(screen.getByText(h1.title!)).toBeInTheDocument();
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
it('removes incident-log navigation while preserving searchable incident analytics',()=>{
  render(<><Sidebar/><AnalyticsPanel/></>);
  expect(screen.queryByRole('button',{name:/Incident Logs/})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Matrix'}));
  fireEvent.change(screen.getByPlaceholderText('Search incidents...'),{target:{value:'Bagasbas'}});
  expect(screen.queryByText(h2.title!)).not.toBeInTheDocument();
  expect(screen.getByText(h1.title!)).toBeInTheDocument();
  expect(useStore.getState().hazards).toHaveLength(3);
});
it('keeps unknown counts separate from zero and labels population estimates',()=>{
  useStore.getState().setHazards([{...h1,affectedPopulation:0},{...h3,affectedPopulation:12,affectedPopulationBasis:'population_estimate'},h2]);
  render(<AnalyticsPanel/>);
  expect(screen.getByText(/1 unknown/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Matrix'}));
  expect(screen.getByText('12 (est.)')).toBeInTheDocument();
  expect(screen.getByText('Unknown',{exact:true})).toBeInTheDocument();
});
it('renders untitled incidents, empty search results, and sourced history',()=>{
  useStore.getState().setHazards([{...h1,title:''}]);
  render(<AnalyticsPanel/>);
  fireEvent.click(screen.getByRole('button',{name:'Matrix'}));
  expect(screen.getByText('Untitled',{exact:true})).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Search incidents...'),{target:{value:'unmatched'}});
  expect(screen.getByText('No incidents match the selected filters.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'History'}));
  expect(screen.getByRole('link',{name:'PAGASA preliminary report'})).toHaveAttribute('href',expect.stringContaining('KRISTINE.pdf'));
});
it('exports the matrix and map without stretching a narrow viewport',async()=>{
  render(<><div className="leaflet-container"/><AnalyticsPanel/></>);
  fireEvent.click(screen.getByRole('button',{name:'Export Report'}));
  await waitFor(()=>expect(report.save).toHaveBeenCalled());
  const image=report.addImage.mock.calls.at(-1)!;
  expect(image[4]/image[5]).toBeCloseTo(274/761);
  expect(image[5]).toBe(155);
  expect(report.text).toHaveBeenCalledWith('Map context - current visible layers',12,15);
  expect(report.text).toHaveBeenCalledWith('Barangay incident summary',12,15);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('groups barangays within municipalities and preserves zero, unknown and estimated counts',()=>{
  expect(summarizeMunicipalities([{...h1,municipality:' daet '}]).find(g=>g.municipality==='Daet')?.counts).toEqual([0,1,0,0]);
  const groups=summarizeBarangays([
    {...h1,affectedPopulation:0},
    {...h1,id:'second',municipality:'daet',barangay:' bagasbas ',affectedPopulation:12,affectedPopulationBasis:'population_estimate'},
    {...h1,id:'third',municipality:'Basud'},
    {...h1,id:'unknown',municipality:undefined,barangay:undefined},
  ]);
  expect(groups).toHaveLength(3);
  expect(groups.find(g=>g.municipality==='Daet')).toMatchObject({barangay:'Bagasbas',counts:[0,2,0,0],total:2,affected:12,unknown:0,estimated:1});
  expect(groups.find(g=>g.municipality==='Basud')).toMatchObject({total:1,unknown:1});
  expect(groups.find(g=>g.municipality==='Unknown municipality')).toMatchObject({barangay:'Unknown barangay',total:1,unknown:1});
});
it('drills down from barangay aggregation and applies the same filters to the hazard breakdown',()=>{
  render(<AnalyticsPanel/>);
  fireEvent.click(screen.getByRole('button',{name:'Barangay',exact:true}));
  const table=screen.getByRole('table',{name:'Barangay severity and affected population'});
  expect(within(table).getAllByRole('row')).toHaveLength(4);
  fireEvent.click(within(table).getByRole('button',{name:'Bagasbas'}));
  expect(useStore.getState().selectedMunicipality).toBe('Daet');
  expect(useStore.getState().selectedBarangay).toBe('Bagasbas');
  expect(within(table).getAllByRole('row')).toHaveLength(2);
  const breakdown=screen.getByRole('table',{name:/Hazard and severity breakdown/});
  expect(within(breakdown).getByRole('row',{name:'Flood 0 1 0 0 1'})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search incidents'),{target:{value:'No match'}});
  expect(within(table).getAllByRole('row')).toHaveLength(1);
  expect(screen.getByText('No incidents match the selected filters.')).toBeInTheDocument();
});
