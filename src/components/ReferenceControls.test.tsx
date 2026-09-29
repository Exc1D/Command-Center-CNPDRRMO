import { expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReferenceControls } from './ReferenceControls';
import { useStore } from '../lib/store';
import { isTransportFacility } from '../lib/reference';

it('controls GIS zones and reported incidents independently in one hazard list',()=>{
  useStore.setState({...useStore.getInitialState()});
  render(<ReferenceControls/>);
  fireEvent.click(screen.getByText('Hazards', {exact:true}));
  const hazards=screen.getByRole('table',{name:'Hazard zones and reported incidents'});
  fireEvent.click(within(hazards).getByRole('checkbox',{name:'Flood zones'}));
  expect(useStore.getState().referenceLayers).toEqual(['flood']);
  expect(within(hazards).getByRole('checkbox',{name:'Flood incidents'})).toBeChecked();
  fireEvent.click(within(hazards).getByRole('checkbox',{name:'Flood incidents'}));
  expect(useStore.getState().activeFilters).not.toContain('flood');
  expect(within(hazards).getByRole('checkbox',{name:'Flood zones'})).toBeChecked();
  fireEvent.click(within(hazards).getByRole('checkbox',{name:'Storm Surge zones'}));
  fireEvent.click(within(hazards).getByRole('checkbox',{name:'Rain-Induced Landslide zones'}));
  expect(useStore.getState().referenceLayers).toEqual(['flood','storm_surge','landslide']);
  expect(within(hazards).queryByRole('checkbox',{name:'Erosion zones'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox',{name:'Show reported incidents'}));
  expect(within(hazards).getByRole('checkbox',{name:'Storm Surge incidents'})).toBeDisabled();
  expect(within(hazards).getByRole('checkbox',{name:'Storm Surge zones'})).toBeEnabled();
  fireEvent.click(screen.getByRole('checkbox',{name:'Show reported incidents'}));
  expect(within(hazards).getByRole('checkbox',{name:'Storm Surge incidents'})).toBeChecked();
  expect(within(hazards).getByRole('checkbox',{name:'Flood incidents'})).not.toBeChecked();
});

it('provides independent transport layers with a concise road-condition notice',()=>{
  useStore.setState({...useStore.getInitialState()});
  render(<ReferenceControls/>);
  const lifelines=screen.getByRole('group',{name:'Roads and transport'});
  fireEvent.click(within(lifelines).getByRole('checkbox',{name:/Transport facilities/}));
  fireEvent.click(within(lifelines).getByRole('checkbox',{name:'Roads'}));
  expect(useStore.getState().elementLayers).toEqual(['lifelines','roads']);
  expect(within(lifelines).getByText('Reference locations only; road conditions are unverified.')).toBeInTheDocument();
  expect(screen.getByRole('checkbox',{name:'Critical Point Facilities'})).not.toBeChecked();
  expect(isTransportFacility({SubCategor:'Transportation: Port, Airport'})).toBe(true);
  expect(isTransportFacility({SubCategor:'School'})).toBe(false);
  expect(isTransportFacility({Category:'Infrastructure, Utilities, Transportation and Services (INF)'})).toBe(false);
});
