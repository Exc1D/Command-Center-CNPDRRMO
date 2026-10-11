import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { HazardLegend } from './HazardLegend';
import { ReferenceMapLayers } from './ReferenceMapLayers';
import { useStore } from '../lib/store';
import { usePlanningStore } from '../lib/planningStore';

vi.mock('react-leaflet', () => ({ useMap: () => ({}) }));

beforeEach(() => {
  useStore.setState(useStore.getInitialState());
  usePlanningStore.setState(usePlanningStore.getInitialState());
});

it('follows visible hazard layers and flood classes, including the landslide hatch', () => {
  useStore.setState({ referenceLayers: ['flood', 'landslide'], activeSusceptibilityFilters: ['High'] });
  render(<HazardLegend />);
  expect(screen.getByText('Flood Susceptibility')).toBeInTheDocument();
  expect(screen.getByText('High', {exact:true})).toBeInTheDocument();
  expect(screen.queryByText('Low', {exact:true})).not.toBeInTheDocument();
  expect(screen.getByText('Debris Flow/Possible Accumulation Zone').querySelector('span')).toHaveStyle({ background: 'repeating-linear-gradient(135deg,transparent 0 3px,#000 3px 4px)' });
  act(() => useStore.setState({ referenceLayers: ['tsunami'], activeSusceptibilityFilters: [] }));
  expect(screen.queryByText('Flood Susceptibility')).not.toBeInTheDocument();
  expect(screen.getByText('Inundation depth')).toBeInTheDocument();
});

it('shows the map legend in Planning even before a scenario is created', () => {
  render(<ReferenceMapLayers />);
  expect(screen.queryByText('Hazard legend')).not.toBeInTheDocument();
  act(() => usePlanningStore.setState({ isPlanningMode: true }));
  const legend=screen.getByText('Hazard legend').closest('details')!;
  expect(legend).toHaveAttribute('open');
  expect(within(legend).getByText('Select reference hazard layers to show their legend.')).toBeInTheDocument();
});
