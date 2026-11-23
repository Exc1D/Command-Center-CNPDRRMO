import { expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReferenceControls } from './ReferenceControls';
import { useStore } from '../lib/store';

it('picks one hazard zone layer and filters incidents with separate dropdowns',()=>{
  useStore.setState({...useStore.getInitialState()});
  render(<ReferenceControls/>);
  fireEvent.change(screen.getByRole('combobox',{name:'Hazard zones'}),{target:{value:'flood'}});
  expect(useStore.getState().referenceLayers).toEqual(['flood']);
  fireEvent.change(screen.getByRole('combobox',{name:'Hazard zones'}),{target:{value:'landslide'}});
  expect(useStore.getState().referenceLayers).toEqual(['landslide']);
  const type=screen.getByRole('combobox',{name:'Incident type'});
  fireEvent.change(type,{target:{value:'storm_surge'}});
  expect(useStore.getState().activeFilters).toEqual(['storm_surge']);
  fireEvent.click(screen.getByRole('checkbox',{name:'Show incidents and resource pins'}));
  expect(type).toBeDisabled();
  expect(useStore.getState().referenceLayers).toEqual(['landslide']);
  fireEvent.click(screen.getByRole('checkbox',{name:'Show incidents and resource pins'}));
  fireEvent.change(type,{target:{value:''}});
  expect(useStore.getState().activeFilters).toHaveLength(8);
});

it('keeps Elements in one container with the road network under Lifeline Utilities',()=>{
  useStore.setState(useStore.getInitialState());
  render(<ReferenceControls/>);
  const lifeline=screen.getByRole('group',{name:'Lifeline Utilities'});
  fireEvent.click(screen.getByRole('checkbox',{name:'Critical Point Facilities'}));
  fireEvent.click(within(lifeline).getByRole('checkbox',{name:'Road Network'}));
  expect(useStore.getState().elementLayers).toEqual(['facilities','roads']);
  expect(screen.queryByRole('checkbox',{name:/Boundaries/})).not.toBeInTheDocument();
  expect(screen.getByText(/Includes transport facilities/)).toBeInTheDocument();
});
