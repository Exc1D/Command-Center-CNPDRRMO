import { expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReferenceControls } from './ReferenceControls';
import { useStore } from '../lib/store';
import { isTransportFacility } from '../lib/reference';

it('provides independent lifeline transport layers and identifies unavailable utility networks',()=>{
  useStore.setState({...useStore.getInitialState()});
  render(<ReferenceControls/>);
  const lifelines=screen.getByRole('group',{name:'Lifeline Utilities'});
  fireEvent.click(within(lifelines).getByRole('checkbox',{name:/Transport facilities/}));
  fireEvent.click(within(lifelines).getByRole('checkbox',{name:'Roads'}));
  expect(useStore.getState().elementLayers).toEqual(['lifelines','roads']);
  expect(within(lifelines).getByText('Power network: data not supplied')).toBeInTheDocument();
  expect(screen.getByRole('checkbox',{name:'Critical Point Facilities'})).not.toBeChecked();
  expect(isTransportFacility({SubCategor:'Transportation: Port, Airport'})).toBe(true);
  expect(isTransportFacility({SubCategor:'School'})).toBe(false);
  expect(isTransportFacility({Category:'Infrastructure, Utilities, Transportation and Services (INF)'})).toBe(false);
});
