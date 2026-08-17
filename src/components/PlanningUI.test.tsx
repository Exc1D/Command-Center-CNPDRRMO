import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanningSidebar } from './PlanningUI';
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
  });

  it('edits scenario metadata and exposes the DRRM symbol library', async () => {
    const user = userEvent.setup();
    render(<PlanningSidebar />);

    const name = screen.getByPlaceholderText('Scenario name');
    await user.clear(name);
    await user.type(name, 'Flood evacuation');

    expect(usePlanningStore.getState().history?.present.name).toBe('Flood evacuation');
    expect(usePlanningStore.getState().dirty).toBe(true);
    expect(screen.getByTitle('Emergency Operations Center')).toBeInTheDocument();
  });

  it('disables scenario mutation for a read-only viewer', async () => {
    useStore.setState({ isMapAuthorized: false });
    render(<PlanningSidebar />);

    expect(screen.getByPlaceholderText('Scenario name')).toBeDisabled();
    expect(await screen.findByRole('button', { name: /^save$/i })).toBeDisabled();
  });
});
