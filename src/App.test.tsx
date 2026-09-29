import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { HazardAPI } from './lib/api';
import { useStore } from './lib/store';
import { usePlanningStore } from './lib/planningStore';

// Hoisted mock functions - must be declared before vi.mock()
const mockGetAllHazards = vi.hoisted(() => vi.fn());
const mockSyncPending = vi.hoisted(() => vi.fn());
const mockAddHazard = vi.hoisted(() => vi.fn());
const mockUpdateHazard = vi.hoisted(() => vi.fn());
const mockDeleteHazard = vi.hoisted(() => vi.fn());
const mockGetAllCenters = vi.hoisted(() => vi.fn());
const mockSyncCenters = vi.hoisted(() => vi.fn());

// Mock the api module
vi.mock('./lib/api', () => ({
  HazardAPI: {
    getAllHazards: mockGetAllHazards,
    syncPending: mockSyncPending,
    addHazard: mockAddHazard,
    updateHazard: mockUpdateHazard,
    deleteHazard: mockDeleteHazard,
  },
  EvacuationCenterAPI: {
    getAllCenters: mockGetAllCenters,
    syncPending: mockSyncCenters,
  },
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

// Mock lucide-react with all icons used in App and child components
vi.mock('lucide-react', async () => {
  const actual = await import('lucide-react');
  return {
    ...actual,
    BarChart2: () => <span data-testid="icon-bar-chart">BarChart2</span>,
    X: () => <span data-testid="icon-x">X</span>,
    Table: () => <span data-testid="icon-table">Table</span>,
    Trash2: () => <span data-testid="icon-trash">Trash2</span>,
    Edit3: () => <span data-testid="icon-edit">Edit3</span>,
    AlertTriangle: () => <span data-testid="icon-alert">AlertTriangle</span>,
    ShieldAlert: () => <span data-testid="icon-shield">ShieldAlert</span>,
  };
});

// Mock Map component (requires leaflet which is hard to test)
vi.mock('./components/Map', () => ({
  default: () => <div data-testid="danger-map">Map</div>,
}));

// Mock Sidebar
vi.mock('./components/Sidebar', () => ({
  default: () => <div data-testid="sidebar">Sidebar</div>,
}));

vi.mock('./components/PlanningUI', () => ({
  PlanningSidebar: () => <div data-testid="planning-sidebar">PlanningSidebar</div>,
  PlanningOverlay: () => <div>PlanningOverlay</div>,
}));

// Mock ErrorBoundary
vi.mock('./components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: any) => children,
}));

// Mock AnalyticsPanel
vi.mock('./components/AnalyticsPanel', () => ({
  AnalyticsPanel: () => <div data-testid="analytics-panel">AnalyticsPanel</div>,
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllHazards.mockResolvedValue([]);
    mockSyncPending.mockResolvedValue(undefined);
    mockGetAllCenters.mockResolvedValue([]);
    mockSyncCenters.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ valid: false }) }));

    // Reset store to default state
    useStore.setState({
      hazards: [],
      filteredHazards: [],
      isAnalyticsOpen: false,
      syncState: { isSyncing: false, lastSyncError: null },
    });
    usePlanningStore.setState(usePlanningStore.getInitialState());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('fetchHazards on mount', () => {
    it('loads public data and syncs pending centers after restoring a session', async () => {
      const hazards = [{ id: '1', type: 'flood', severity: 'Moderate' }];
      mockGetAllHazards.mockResolvedValue(hazards);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ valid: true }) }));

      // Spy on the API method
      const spy = vi.spyOn(HazardAPI, 'getAllHazards');

      render(<App />);

      await waitFor(() => {
        expect(spy).toHaveBeenCalled();
        expect(mockSyncCenters).toHaveBeenCalled();
        expect(mockGetAllCenters).toHaveBeenCalled();
      });
    });

    it('renders App header when fetchHazards succeeds', async () => {
      const hazards = [{ id: '1', type: 'flood', severity: 'Moderate' }];
      mockGetAllHazards.mockResolvedValue(hazards);

      render(<App />);

      // Verify the header is rendered
      expect(screen.getByText('COMMAND CENTER')).toBeInTheDocument();
      await waitFor(() => expect(mockGetAllCenters).toHaveBeenCalled());
    });

    it('renders App when fetchHazards fails (error is caught internally)', async () => {
      mockGetAllHazards.mockRejectedValue(new Error('Network error'));

      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<App />);

      // App should still render (error is caught internally)
      await waitFor(() => {
        expect(screen.getByText('COMMAND CENTER')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });
  });

  describe('online event listener', () => {
    it('online event listener is registered on mount', async () => {
      mockGetAllHazards.mockResolvedValue([]);

      const addSpy = vi.spyOn(window, 'addEventListener');

      render(<App />);

      await waitFor(() => {
        // Check that 'online' listener was registered (not 'offline')
        expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
      });
    });

    it('refreshes after reconnecting without decorative connection labels', async () => {
      render(<App />);
      await waitFor(() => expect(mockGetAllHazards).toHaveBeenCalled());
      mockGetAllHazards.mockClear();
      act(() => window.dispatchEvent(new Event('offline')));
      act(() => window.dispatchEvent(new Event('online')));
      await waitFor(() => expect(mockGetAllHazards).toHaveBeenCalled());
      expect(screen.queryByText(/Online, cache ready|Offline, changes queued|Syncing operational data/)).not.toBeInTheDocument();
    });
  });

  it('opens in monitoring and supports keyboard mode switching with hints', async () => {
    render(<App />);

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    const modeSwitch = screen.getByRole('switch', { name: 'Planning mode' });
    expect(modeSwitch).toHaveAttribute('aria-checked', 'false');
    expect(modeSwitch).toHaveAccessibleDescription('View incidents Build a response');
    expect(screen.queryByText(/Operational planning workspace|Live operational map/)).not.toBeInTheDocument();
    act(() => useStore.setState({ isAnalyticsOpen: true }));
    modeSwitch.focus();
    await userEvent.keyboard(' ');
    expect(modeSwitch).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('planning-sidebar')).toBeInTheDocument();
    expect(useStore.getState().isAnalyticsOpen).toBe(false);
    await userEvent.keyboard('{Enter}');
    expect(modeSwitch).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('retains an unsaved plan when leaving planning is canceled', async () => {
    usePlanningStore.getState().enter();
    usePlanningStore.getState().newBoard();
    usePlanningStore.getState().edit(plan => ({ ...plan, notes: 'Keep this draft' }));
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
    render(<App />);
    await userEvent.click(screen.getByRole('switch', { name: 'Planning mode' }));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved planning changes?');
    expect(usePlanningStore.getState().isPlanningMode).toBe(true);
    expect(usePlanningStore.getState().history?.present.notes).toBe('Keep this draft');
    expect(usePlanningStore.getState().dirty).toBe(true);
  });

  it('collapses and keeps the sidebar mounted for reopening', async () => {
    render(<App />);
    const sidebar = screen.getByTestId('sidebar');
    const panel = sidebar.parentElement!;
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(screen.getByRole('banner')).not.toContainElement(toggle);
    await userEvent.click(toggle);
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    expect(panel).toHaveAttribute('inert');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(panel).toHaveAttribute('aria-hidden', 'false');
    expect(panel).not.toHaveAttribute('inert');
    expect(screen.getByTestId('sidebar')).toBe(sidebar);
  });

  describe('Analytics toggle', () => {
    it('analytics button exists and toggles state', async () => {
      mockGetAllHazards.mockResolvedValue([]);

      render(<App />);

      const analyticsButton = screen.getByRole('button', { name: /view analytics/i });
      expect(analyticsButton).toBeInTheDocument();

      await userEvent.click(analyticsButton);

      const state = useStore.getState();
      expect(state.isAnalyticsOpen).toBe(true);
    });
  });
});
