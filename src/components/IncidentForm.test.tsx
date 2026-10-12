import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IncidentForm } from './IncidentForm';
import { HazardAPI } from '../lib/api';
import { PLANNING_SYMBOLS } from '../lib/planning';
import { useStore } from '../lib/store';

vi.mock('../lib/api', () => ({ HazardAPI: { addHazard: vi.fn(), updateHazard: vi.fn(), getAllHazards: vi.fn().mockResolvedValue([]) } }));
const point = { type: 'Point', coordinates: [123,14] };
const record = { id: crypto.randomUUID(), type: 'flood', severity: 'Moderate', municipality: 'Daet', barangay: 'Bagasbas', title: 'Flood', notes: '', geometry: point, dateAdded: new Date().toISOString(), version: 2 };

beforeEach(() => { vi.clearAllMocks(); useStore.setState(useStore.getInitialState()); });

it('offers every planning symbol for an incident and saves or clears its selection', async () => {
  const user=userEvent.setup();
  const view=render(<IncidentForm record={record} geometry={point} onClose={()=>{}} />);
  const chooser=screen.getByRole('combobox',{name:/Pin symbol/});
  expect(chooser.querySelectorAll('option')).toHaveLength(PLANNING_SYMBOLS.length+1);
  await user.selectOptions(chooser,'rescue-boat');
  await user.click(screen.getByRole('button',{name:'Save Changes'}));
  await waitFor(()=>expect(HazardAPI.updateHazard).toHaveBeenCalledWith(expect.objectContaining({type:'flood',symbolKey:'rescue-boat',severity:'Moderate',version:2})));
  view.unmount();
  render(<IncidentForm record={{...record,symbolKey:'rescue-boat'}} geometry={point} onClose={()=>{}} />);
  expect(screen.getByRole('combobox',{name:/Pin symbol/})).toHaveValue('rescue-boat');
  await user.selectOptions(screen.getByRole('combobox',{name:/Pin symbol/}),'');
  await user.click(screen.getByRole('button',{name:'Save Changes'}));
  await waitFor(()=>expect(HazardAPI.updateHazard).toHaveBeenLastCalledWith(expect.objectContaining({symbolKey:null})));
});

it('creates a standalone resource without incident fields and excludes it from analytics', async () => {
  const user=userEvent.setup();
  render(<IncidentForm geometry={point} onClose={()=>{}} />);
  await user.selectOptions(screen.getByLabelText('Pin type'),'resource');
  expect(screen.queryByLabelText('Hazard Type')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Severity Level')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Affected Population')).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Municipality'),'Daet');
  await user.selectOptions(screen.getByLabelText('Barangay'),'Bagasbas');
  await user.click(screen.getByRole('button',{name:'Save Resource Pin'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a resource symbol.');
  expect(HazardAPI.addHazard).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByRole('combobox',{name:/Pin symbol/}),'ambulance');
  await user.type(screen.getByLabelText('Resource title'),'Ambulance Team Alpha');
  await user.click(screen.getByRole('button',{name:'Save Resource Pin'}));
  await waitFor(()=>expect(HazardAPI.addHazard).toHaveBeenCalledWith(expect.objectContaining({type:'resource',symbolKey:'ambulance',title:'Ambulance Team Alpha',severity:'Not applicable',affectedPopulation:null,geometry:point})));
  const saved=vi.mocked(HazardAPI.addHazard).mock.calls[0][0];
  useStore.getState().setHazards([saved,record]);
  expect(useStore.getState().filteredHazards).toEqual([record]);
});

it('edits a resource pin without changing it into an incident', async () => {
  const user=userEvent.setup();
  render(<IncidentForm record={{...record,type:'resource',symbolKey:'ambulance',severity:'Not applicable'}} geometry={point} onClose={()=>{}} />);
  expect(screen.getByRole('heading',{name:'Edit Resource Pin'})).toBeInTheDocument();
  await user.selectOptions(screen.getByRole('combobox',{name:/Pin symbol/}),'eoc');
  await user.click(screen.getByRole('button',{name:'Save Changes'}));
  await waitFor(()=>expect(HazardAPI.updateHazard).toHaveBeenCalledWith(expect.objectContaining({type:'resource',symbolKey:'eoc',severity:'Not applicable',version:2})));
});
