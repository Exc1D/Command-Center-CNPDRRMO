import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { HazardAPI } from './lib/api';
import { useStore } from './lib/store';

// Hoisted mock functions - must be declared before vi.mock()
const mockGetAllHazards = vi.hoisted(() => vi.fn());
const mockSyncPending = vi.hoisted(() => vi.fn());
const mockAddHazard = vi.hoisted(() => vi.fn());
const mockUpdateHazard = vi.hoisted(() => vi.fn());
const mockDeleteHazard = vi.hoisted(() => vi.fn());

// Mock the api module
vi.mock('./lib/api', () => ({
  HazardAPI: {
    getAllHazards: mockGetAllHazards,
    syncPending: mockSyncPending,
    addHazard: mockAddHazard,
    updateHazard: mockUpdateHazard,
    deleteHazard: mockDeleteHazard,
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

    // Reset store to default state
    useStore.setState({
      hazards: [],
      filteredHazards: [],
      isAnalyticsOpen: false,
      syncState: { isSyncing: false, lastSyncError: null },
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('fetchHazards on mount', () => {
    it('getAllHazards is called via spy on component mount', async () => {
      const hazards = [{ id: '1', type: 'flood', severity: 'Moderate' }];
      mockGetAllHazards.mockResolvedValue(hazards);

      // Spy on the API method
      const spy = vi.spyOn(HazardAPI, 'getAllHazards');

      render(<App />);

      await waitFor(() => {
        expect(spy).toHaveBeenCalled();
      });
    });

    it('renders App header when fetchHazards succeeds', async () => {
      const hazards = [{ id: '1', type: 'flood', severity: 'Moderate' }];
      mockGetAllHazards.mockResolvedValue(hazards);

      render(<App />);

      // Verify the header is rendered
      expect(screen.getByText('COMMAND CENTER')).toBeInTheDocument();
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
