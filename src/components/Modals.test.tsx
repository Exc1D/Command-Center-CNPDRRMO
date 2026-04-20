import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DropTagModal, PinModal } from './Modals';
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
  AnimatePresence: ({ children }: any) => children,
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  AlertTriangle: () => <span data-testid="icon-alert-triangle">AlertTriangle</span>,
  X: () => <span data-testid="icon-x">X</span>,
  Trash2: () => <span data-testid="icon-trash">Trash2</span>,
  Edit3: () => <span data-testid="icon-edit">Edit3</span>,
  ShieldAlert: () => <span data-testid="icon-shield">ShieldAlert</span>,
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid-1234',
}));

// Mock detectLocationFromGeometry - return a resolved promise
const mockDetectLocation = vi.fn().mockResolvedValue({
  municipality: 'Daet',
  barangay: 'Bagasbas',
});

vi.mock('../lib/utils', () => ({
  detectLocationFromGeometry: (...args: any[]) => mockDetectLocation(...args),
}));

describe('DropTagModal', () => {
  const mockGeometry = {
    type: 'Polygon' as const,
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAddHazard.mockResolvedValue(undefined);
    mockGetAllHazards.mockResolvedValue([]);
    mockDetectLocation.mockResolvedValue({
      municipality: 'Daet',
      barangay: 'Bagasbas',
    });

    // Open the modal with mock geometry
    useStore.setState({
      isDropTagModalOpen: true,
      dropTagTempGeometry: mockGeometry,
    });
  });

  afterEach(() => {
    cleanup();
    useStore.setState({
      isDropTagModalOpen: false,
      dropTagTempGeometry: null,
    });
  });

  it('renders modal when isDropTagModalOpen is true', () => {
    render(<DropTagModal />);

    expect(screen.getByText('New Hazard Mapping')).toBeInTheDocument();
    expect(screen.getByText('Locational Data Entry')).toBeInTheDocument();
  });

  it('does not render when isDropTagModalOpen is false', () => {
    useStore.setState({ isDropTagModalOpen: false, dropTagTempGeometry: null });

    render(<DropTagModal />);

    expect(screen.queryByText('New Hazard Mapping')).not.toBeInTheDocument();
  });

  it('displays disaster type buttons', () => {
    render(<DropTagModal />);

    expect(screen.getByText('Flood')).toBeInTheDocument();
    expect(screen.getByText('Storm Surge')).toBeInTheDocument();
    expect(screen.getByText('Landslide')).toBeInTheDocument();
  });

  it('close button is clickable', async () => {
    const closeDropTagModalSpy = vi.spyOn(useStore.getState(), 'closeDropTagModal');

    render(<DropTagModal />);

    const closeButton = screen.getByTestId('icon-x').closest('button');
    if (closeButton) {
      await userEvent.click(closeButton);
    }

    expect(closeDropTagModalSpy).toHaveBeenCalled();
  });
});

describe('PinModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteHazard.mockResolvedValue(undefined);
    mockGetAllHazards.mockResolvedValue([]);

    // Open the modal in delete mode
    useStore.setState({
      isPinModalOpen: true,
      pinActionType: 'delete',
      pinActionData: 'test-hazard-id',
    });
  });

  afterEach(() => {
    cleanup();
    useStore.setState({
      isPinModalOpen: false,
      pinActionType: null,
      pinActionData: null,
    });
  });

  it('renders modal when isPinModalOpen is true', () => {
    render(<PinModal />);

    expect(screen.getByText('Verification Required')).toBeInTheDocument();
  });

  it('does not render when isPinModalOpen is false', () => {
    useStore.setState({ isPinModalOpen: false });

    render(<PinModal />);

    expect(screen.queryByText('Verification Required')).not.toBeInTheDocument();
  });

  it('keypad buttons are present', () => {
    render(<PinModal />);

    // Check all number buttons are present
    for (let i = 0; i <= 9; i++) {
      expect(screen.getByRole('button', { name: String(i) })).toBeInTheDocument();
    }
  });

  it('close button calls closePinModal', async () => {
    const closePinModalSpy = vi.spyOn(useStore.getState(), 'closePinModal');

    render(<PinModal />);

    const closeButton = screen.getByTestId('icon-x').closest('button');
    if (closeButton) {
      await userEvent.click(closeButton);
    }

    expect(closePinModalSpy).toHaveBeenCalled();
  });
});
