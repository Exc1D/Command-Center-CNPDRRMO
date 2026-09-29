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

  it('renders modal when isDropTagModalOpen is true', async () => {
    render(<DropTagModal />);

    expect(screen.getByText('Incident Details')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Suggest nearby location'));
    await waitFor(() => expect(screen.getByLabelText('Municipality')).toHaveValue('Daet'));
  });

  it('does not render when isDropTagModalOpen is false', () => {
    useStore.setState({ isDropTagModalOpen: false, dropTagTempGeometry: null });

    render(<DropTagModal />);

    expect(screen.queryByText('New Hazard Mapping')).not.toBeInTheDocument();
  });

  it('displays disaster type buttons', async () => {
    render(<DropTagModal />);

    expect(screen.getByText('Flood')).toBeInTheDocument();
    expect(screen.getByText('Storm Surge')).toBeInTheDocument();
    expect(screen.getByText('Rain-Induced Landslide')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Suggest nearby location'));
    await waitFor(() => expect(screen.getByLabelText('Municipality')).toHaveValue('Daet'));
  });

  it('close button is clickable', async () => {
    const closeDropTagModalSpy = vi.spyOn(useStore.getState(), 'closeDropTagModal');

    render(<DropTagModal />);

    const closeButton = screen.getByRole('button', {name:/Close incident details|Close PIN verification/});
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

    const closeButton = screen.getByRole('button', {name:/Close incident details|Close PIN verification/});
    if (closeButton) {
      await userEvent.click(closeButton);
    }

    expect(closePinModalSpy).toHaveBeenCalled();
  });
});

it('uses a population estimate without treating unknown population as zero and preserves the calculation notes',async()=>{
  vi.clearAllMocks();
  mockAddHazard.mockResolvedValue(undefined);mockGetAllHazards.mockResolvedValue([]);
  const originalFetch=global.fetch;
  global.fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({matchedRecords:3,populationSum:9,missingPopulationRecords:1,duplicateIdRecords:1,method:'Population points within 500 m radius',calculatedAt:'2026-09-21T00:00:00Z',coverageNote:'Incomplete source data',unavailableMunicipalities:['Santa Elena']})});
  useStore.setState({...useStore.getInitialState(),isDropTagModalOpen:true,dropTagTempGeometry:{type:'Point',coordinates:[122.98,14.13]}});
  try {
    render(<DropTagModal/>);
    expect(screen.getByLabelText('Affected Population')).toHaveValue(null);
    await userEvent.selectOptions(screen.getByLabelText('Municipality'),'Daet');
    await userEvent.selectOptions(screen.getByLabelText('Barangay'),'Bagasbas');
    expect(screen.getByRole('button',{name:'Calculate population exposure'})).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Analysis radius (metres)'),'500');
    await userEvent.click(screen.getByRole('button',{name:'Calculate population exposure'}));
    await userEvent.click(await screen.findByRole('button',{name:'Use as provisional estimate'}));
    expect(screen.getByLabelText('Affected Population')).toHaveValue(9);
    await userEvent.click(screen.getByRole('button',{name:'Save Incident'}));
    await waitFor(()=>expect(mockAddHazard).toHaveBeenCalledWith(expect.objectContaining({affectedPopulation:9,affectedPopulationBasis:'population_estimate',notes:expect.stringContaining('500 m radius')})));
  }finally{global.fetch=originalFetch;cleanup();}
});
