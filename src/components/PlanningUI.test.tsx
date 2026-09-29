import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanningOverlay, PlanningSidebar } from './PlanningUI';
import { createPlanningScenario, DEFAULT_PLANNING_STYLE, exportScenario, importScenario, PLANNING_SYMBOLS } from '../lib/planning';
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

describe('Planning UI', () => {
  beforeEach(() => {
    usePlanningStore.getState().newBoard();
    usePlanningStore.setState({ symbolKey: 'evacuation-center' });
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

  it('offers every symbol directly from the toolbar and preserves native selector keys', async () => {
    const user = userEvent.setup();
    render(<PlanningOverlay />);
    await user.click(screen.getByRole('button', { name: 'Symbol People and resources' }));

    const chooser = screen.getByRole('combobox', { name: 'Planning symbol' });
    expect(chooser.querySelectorAll('option')).toHaveLength(PLANNING_SYMBOLS.length);
    await user.selectOptions(chooser, 'rescue-boat');
    expect(usePlanningStore.getState()).toMatchObject({ symbolKey: 'rescue-boat', tool: 'symbol' });
    fireEvent.keyDown(chooser, { key: 'e' });
    expect(usePlanningStore.getState().tool).toBe('symbol');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(usePlanningStore.getState().tool).toBe('select');
  });

  it('changes a placed symbol without losing its assignment and persists the choice in plan exports', async () => {
    const user = userEvent.setup();
    const scenario = createPlanningScenario('Rescue assignments');
    const object = { id: crypto.randomUUID(), kind: 'symbol' as const, layer: 'symbols' as const, coordinates: [[122.9, 14.1]] as [number, number][], style: { ...DEFAULT_PLANNING_STYLE }, locked: false, order: 0, symbolKey: 'evacuation-center', label: 'Team Alpha', quantity: 2 };
    scenario.objects = [object];
    usePlanningStore.getState().load(scenario, true);
    usePlanningStore.getState().select([object.id]);
    render(<PlanningOverlay />);

    const chooser = screen.getByRole('combobox', { name: 'Object symbol' });
    await user.selectOptions(chooser, 'medical-post');
    fireEvent.keyDown(chooser, { key: 'Backspace' });
    const updated = usePlanningStore.getState().history!.present;
    expect(updated.objects).toEqual([{ ...object, symbolKey: 'medical-post' }]);
    expect(importScenario(exportScenario(updated, [])).objects).toEqual(updated.objects);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(usePlanningStore.getState().history!.present.objects).toEqual([object]);
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
