import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditHazardModal } from './EditHazardModal';
import { HazardAPI } from '../lib/api';
import { useStore } from '../lib/store';

// Hoisted mock functions
const mockGetAllHazards = vi.hoisted(() => vi.fn());
const mockSyncPending = vi.hoisted(() => vi.fn());
const mockAddHazard = vi.hoisted(() => vi.fn());
const mockUpdateHazard = vi.hoisted(() => vi.fn());
const mockDeleteHazard = vi.hoisted(() => vi.fn());

// Mock the api module
vi.mock('../lib/api', () => ({
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
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  AlertTriangle: () => <span data-testid="icon-alert-triangle">AlertTriangle</span>,
  X: () => <span data-testid="icon-x">X</span>,
}));

describe('EditHazardModal', () => {
  const mockHazard = {
    id: 'test-uuid',
    type: 'flood',
    severity: 'Moderate',
    title: 'Test Hazard',
    municipality: 'Test Municipality',
    barangay: 'Test Barangay',
    notes: 'Test notes',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    dateAdded: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllHazards.mockResolvedValue([]);
    mockUpdateHazard.mockResolvedValue(undefined);

    // Reset store and open the modal with mock hazard
    useStore.setState({
      isEditModalOpen: true,
      editModalHazard: mockHazard,
      isMapAuthorized: true,
    });
  });

  afterEach(() => {
    cleanup();
    // Close modal after each test
    useStore.setState({
      isEditModalOpen: false,
      editModalHazard: null,
    });
  });

  it('renders modal when isEditModalOpen is true', () => {
    render(<EditHazardModal />);

    expect(screen.getByText('Edit Hazard Record')).toBeInTheDocument();
    expect(screen.getByText('Modify Incident Data')).toBeInTheDocument();
  });

  it('does not render when isEditModalOpen is false', () => {
    useStore.setState({ isEditModalOpen: false, editModalHazard: null });

    render(<EditHazardModal />);

    expect(screen.queryByText('Edit Hazard Record')).not.toBeInTheDocument();
  });

  it('pre-fills form with hazard data', () => {
    render(<EditHazardModal />);

    // Check that the title input has the hazard's title
    const titleInput = screen.getByPlaceholderText('e.g. Brgy. Bagasbas Coastline');
    expect((titleInput as HTMLInputElement).value).toBe('Test Hazard');
  });

  it('displays disaster type buttons', () => {
    render(<EditHazardModal />);

    // Should show all disaster types
    expect(screen.getByText('Flood')).toBeInTheDocument();
    expect(screen.getByText('Storm Surge')).toBeInTheDocument();
    expect(screen.getByText('Landslide')).toBeInTheDocument();
    expect(screen.getByText('Vehicular Accident')).toBeInTheDocument();
    expect(screen.getByText('Earthquake Fault')).toBeInTheDocument();
    expect(screen.getByText('Tsunami')).toBeInTheDocument();
  });

  it('displays severity select with current value', () => {
    render(<EditHazardModal />);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('Moderate');
  });

  it('save button is enabled when not saving', () => {
    render(<EditHazardModal />);

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).toBeEnabled();
  });

  it('close button is clickable', async () => {
    const closeEditModalSpy = vi.spyOn(useStore.getState(), 'closeEditModal');

    render(<EditHazardModal />);

    const closeButton = screen.getByTestId('icon-x').closest('button');
    if (closeButton) {
      await userEvent.click(closeButton);
    }

    expect(closeEditModalSpy).toHaveBeenCalled();
  });
});
