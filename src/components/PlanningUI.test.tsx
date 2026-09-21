import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanningSidebar } from './PlanningUI';
import { createPlanningScenario, DEFAULT_PLANNING_STYLE } from '../lib/planning';
import { usePlanningStore } from '../lib/planningStore';
import { useStore } from '../lib/store';

vi.mock('../lib/planningApi', () => ({
  PlanningAPI: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    save: vi.fn(),
    acquireLock: vi.fn(),
    templates: vi.fn().mockResolvedValue([]),
    saveTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
  },
}));

describe('PlanningSidebar', () => {
  beforeEach(() => {
    usePlanningStore.getState().newBoard();
    useStore.setState({ isMapAuthorized: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ type: 'FeatureCollection', features: [] }) }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('edits the decision brief and exposes labeled DRRM symbols', async () => {
    const user = userEvent.setup();
    render(<PlanningSidebar />);

    const name = await screen.findByLabelText('Plan name');
    await user.clear(name);
    await user.type(name, 'Flood evacuation');

    expect(usePlanningStore.getState().history?.present.name).toBe('Flood evacuation');
    expect(usePlanningStore.getState().dirty).toBe(true);

    await user.click(screen.getByRole('tab', { name: '2 Map' }));
    await user.selectOptions(screen.getByLabelText('Symbol category'), 'Command');
    expect(screen.getByRole('button', { name: 'Emergency Operations Center' }).querySelector('svg')).toBeInTheDocument();
  });

  it('disables scenario mutation for a read-only viewer', async () => {
    useStore.setState({ isMapAuthorized: false });
    render(<PlanningSidebar />);

    expect(await screen.findByLabelText('Plan name')).toBeDisabled();
    expect(screen.getByRole('button', { name: /save plan/i })).toBeDisabled();
  });

  it('guides operators from the brief to mapping and publication review', async () => {
    const user = userEvent.setup();
    render(<PlanningSidebar />);

    expect(await screen.findByRole('heading', { name: 'Define the decision' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '2 Map' }));
    expect(screen.getByRole('heading', { name: 'Map assignments and resources' })).toBeInTheDocument();
    await user.click(screen.getByText('Map reference and layers'));
    expect(screen.getByRole('checkbox', { name: 'Show drawings' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '3 Review' }));
    expect(screen.getByRole('heading', { name: 'Publication readiness' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish plan' })).toBeDisabled();
  });

  it('requires the latest draft to be saved before publication', async () => {
    const user = userEvent.setup();
    const scenario = createPlanningScenario('District 2 evacuation');
    scenario.notes = 'Move coastal residents before storm surge reaches the highway.';
    scenario.validFrom = new Date().toISOString();
    scenario.validUntil = new Date(Date.now() + 3_600_000).toISOString();
    scenario.classification = 'Internal';
    scenario.draftVersion = 2;
    scenario.objects = [{ id: crypto.randomUUID(), kind: 'symbol', layer: 'symbols', coordinates: [[122.9, 14.1]], style: { ...DEFAULT_PLANNING_STYLE }, locked: false, order: 0, symbolKey: 'evacuation-center', label: 'Open District 2 evacuation center' }];
    usePlanningStore.getState().load(scenario);
    usePlanningStore.getState().setLockAcquired(true);
    usePlanningStore.getState().edit(current => ({ ...current, notes: `${current.notes} Assign transport.` }));
    render(<PlanningSidebar />);

    await user.click(await screen.findByRole('tab', { name: '3 Review' }));
    expect(screen.getByRole('button', { name: 'Publish plan' })).toBeDisabled();
    expect(screen.getByText('Save the latest changes before publishing.')).toBeInTheDocument();
  });
});
