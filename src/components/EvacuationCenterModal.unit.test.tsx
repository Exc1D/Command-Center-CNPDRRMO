import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvacuationCenterModal } from './EvacuationCenterModal';
import { EvacuationCenterAPI } from '../lib/api';
import { useStore } from '../lib/store';

// Hoisted mock functions
const mockGetAllCenters = vi.hoisted(() => vi.fn());
const mockAddCenter = vi.hoisted(() => vi.fn());

// Mock the api module
vi.mock('../lib/api', () => ({
  EvacuationCenterAPI: {
    getAllCenters: mockGetAllCenters,
    addCenter: mockAddCenter,
  },
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock('lucide-react', () => ({
  X: () => <span data-testid="icon-x">X</span>,
  MapPin: () => <span data-testid="icon-mappin">MapPin</span>,
}));

vi.mock('uuid', () => ({
  v4: () => 'mock-uuid-5678',
}));

vi.mock('../lib/utils', () => ({
  detectLocationFromGeometry: () => Promise.resolve({
    municipality: 'Daet',
    barangay: 'Bagasbas',
  }),
}));

describe('EvacuationCenterModal', () => {
  const mockCoords: [number, number] = [122.9803837, 14.1337179];

  beforeEach(() => {
    vi.clearAllMocks();
    mockAddCenter.mockResolvedValue(undefined);
    mockGetAllCenters.mockResolvedValue([]);

    useStore.setState({
      isEvacuationCenterModalOpen: true,
      evacuationCenterTempCoords: mockCoords,
    });
  });

  afterEach(() => {
    cleanup();
    useStore.setState({
      isEvacuationCenterModalOpen: false,
      evacuationCenterTempCoords: null,
    });
  });

  it('renders modal when isEvacuationCenterModalOpen is true', async () => {
    render(<EvacuationCenterModal />);

    expect(screen.getByText('New Evacuation Center')).toBeInTheDocument();
    expect(screen.getByText('Add Evacuation Center')).toBeInTheDocument();
  });

  it('does not render when isEvacuationCenterModalOpen is false', () => {
    useStore.setState({ isEvacuationCenterModalOpen: false, evacuationCenterTempCoords: null });

    render(<EvacuationCenterModal />);

    expect(screen.queryByText('New Evacuation Center')).not.toBeInTheDocument();
  });

  it('renders form fields', async () => {
    render(<EvacuationCenterModal />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. San Jose Elementary School')).toBeInTheDocument();
      expect(screen.getByRole('combobox')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('e.g. 150')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Municipality')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Barangay')).toBeInTheDocument();
    });
  });

  it('renders all center type options', async () => {
    render(<EvacuationCenterModal />);

    await waitFor(() => {
      expect(screen.getByText('School')).toBeInTheDocument();
      expect(screen.getByText('Barangay Hall')).toBeInTheDocument();
      expect(screen.getByText('Church')).toBeInTheDocument();
      expect(screen.getByText('Covered Court')).toBeInTheDocument();
      expect(screen.getByText('Other')).toBeInTheDocument();
    });
  });

  it('calls closeEvacuationCenterModal when close button clicked', async () => {
    const closeModalSpy = vi.spyOn(useStore.getState(), 'closeEvacuationCenterModal');

    render(<EvacuationCenterModal />);

    const closeButton = screen.getByTestId('icon-x').closest('button');
    if (closeButton) {
      await userEvent.click(closeButton);
    }

    expect(closeModalSpy).toHaveBeenCalled();
  });

  it('button is disabled when name is empty', async () => {
    render(<EvacuationCenterModal />);

    await waitFor(() => {
      const saveButton = screen.getByRole('button', { name: 'Name Required' });
      expect(saveButton).toBeDisabled();
    });
  });

  it('button shows Valid Capacity Required when name filled but capacity empty', async () => {
    render(<EvacuationCenterModal />);

    const nameInput = await screen.findByPlaceholderText('e.g. San Jose Elementary School');
    await userEvent.type(nameInput, 'Test Center');

    const saveButton = await screen.findByRole('button', { name: 'Valid Capacity Required' });
    expect(saveButton).toBeDisabled();
  });

  it('button shows Save Center when name and capacity are filled', async () => {
    render(<EvacuationCenterModal />);

    const nameInput = await screen.findByPlaceholderText('e.g. San Jose Elementary School');
    await userEvent.type(nameInput, 'Test Center');

    const capacityInput = await screen.findByPlaceholderText('e.g. 150');
    await userEvent.type(capacityInput, '100');

    const saveButton = await screen.findByRole('button', { name: 'Save Center' });
    expect(saveButton).toBeEnabled();
  });
});