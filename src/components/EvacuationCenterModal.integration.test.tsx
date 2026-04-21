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

describe('EvacuationCenterModal - Integration', () => {
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

  it('calls detectLocationFromGeometry with correct geometry when modal opens', async () => {
    const utils = await import('../lib/utils');
    const spy = vi.spyOn(utils, 'detectLocationFromGeometry');

    render(<EvacuationCenterModal />);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({
        type: 'Point',
        coordinates: [mockCoords[0], mockCoords[1]],
      });
    });
  });

  it('auto-populates municipality and barangay after location detection', async () => {
    render(<EvacuationCenterModal />);

    await waitFor(() => {
      const municipalityInput = screen.getByPlaceholderText('Municipality') as HTMLInputElement;
      expect(municipalityInput.value).toBe('Daet');
    });

    const barangayInput = screen.getByPlaceholderText('Barangay') as HTMLInputElement;
    expect(barangayInput.value).toBe('Bagasbas');
  });

  it('saves new evacuation center and refreshes list', async () => {
    const mockSetEvacuationCenters = vi.fn();
    useStore.setState({ setEvacuationCenters: mockSetEvacuationCenters });

    render(<EvacuationCenterModal />);

    const nameInput = await screen.findByPlaceholderText('e.g. San Jose Elementary School');
    await userEvent.type(nameInput, 'San Jose Elementary School');

    const capacityInput = await screen.findByPlaceholderText('e.g. 150');
    await userEvent.type(capacityInput, '150');

    const saveButton = await screen.findByRole('button', { name: 'Save Center' });
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(mockAddCenter).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'San Jose Elementary School',
          type: 'barangay_hall',
          capacity: 150,
          municipality: 'Daet',
          barangay: 'Bagasbas',
          coordinates: mockCoords,
        })
      );
    });

    await waitFor(() => {
      expect(mockGetAllCenters).toHaveBeenCalled();
    });

    expect(mockSetEvacuationCenters).toHaveBeenCalledWith([]);
  });

  it('closes modal after successful save', async () => {
    const closeModalSpy = vi.spyOn(useStore.getState(), 'closeEvacuationCenterModal');

    render(<EvacuationCenterModal />);

    const nameInput = await screen.findByPlaceholderText('e.g. San Jose Elementary School');
    await userEvent.type(nameInput, 'Test Center');

    const capacityInput = await screen.findByPlaceholderText('e.g. 150');
    await userEvent.type(capacityInput, '100');

    const saveButton = await screen.findByRole('button', { name: 'Save Center' });
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(closeModalSpy).toHaveBeenCalled();
    });
  });

  it('allows manual override of auto-detected municipality', async () => {
    render(<EvacuationCenterModal />);

    await waitFor(() => {
      const municipalityInput = screen.getByPlaceholderText('Municipality') as HTMLInputElement;
      expect(municipalityInput.value).toBe('Daet');
    });

    const municipalityInput = screen.getByPlaceholderText('Municipality');
    await userEvent.clear(municipalityInput);
    await userEvent.type(municipalityInput, 'Caramoran');

    expect((municipalityInput as HTMLInputElement).value).toBe('Caramoran');
  });

  it('allows manual override of auto-detected barangay', async () => {
    render(<EvacuationCenterModal />);

    await waitFor(() => {
      const barangayInput = screen.getByPlaceholderText('Barangay') as HTMLInputElement;
      expect(barangayInput.value).toBe('Bagasbas');
    });

    const barangayInput = screen.getByPlaceholderText('Barangay');
    await userEvent.clear(barangayInput);
    await userEvent.type(barangayInput, 'Henoga');

    expect((barangayInput as HTMLInputElement).value).toBe('Henoga');
  });
});