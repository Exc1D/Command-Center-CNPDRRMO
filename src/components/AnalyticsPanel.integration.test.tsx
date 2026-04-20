import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Hazard } from '../lib/db';

const h1: Hazard = {
  id: 'h1',
  type: 'flood',
  severity: 'Moderate',
  title: 'Brgy. Bagasbas Flooding',
  municipality: 'Daet',
  barangay: 'Bagasbas',
  notes: 'Low-lying area near coast',
  geometry: { type: 'Point', coordinates: [122.9803837, 14.1337179] },
  dateAdded: '2026-04-15T08:00:00Z'
};

const h2: Hazard = {
  id: 'h2',
  type: 'landslide',
  severity: 'Severe',
  title: 'Mercedes Landslide Zone',
  municipality: 'Mercedes',
  barangay: 'Mercedes',
  notes: 'Hillside erosion observed',
  geometry: { type: 'Point', coordinates: [122.9803837, 14.1337179] },
  dateAdded: '2026-04-16T10:00:00Z'
};

const h3: Hazard = {
  id: 'h3',
  type: 'vehicular_accident',
  severity: 'Minor',
  title: 'Daet Highway Collision',
  municipality: 'Daet',
  barangay: 'Barangay IV',
  notes: 'Two-vehicle collision, no injuries',
  geometry: { type: 'Point', coordinates: [122.9508094, 14.1167055] },
  dateAdded: '2026-04-17T14:00:00Z'
};

const { mockUseStore, mockSetAnalyticsOpen, mockFlyTo, mockSetSelectedHazard } = vi.hoisted(() => ({
  mockUseStore: vi.fn(),
  mockSetAnalyticsOpen: vi.fn(),
  mockFlyTo: vi.fn(),
  mockSetSelectedHazard: vi.fn(),
}));

vi.mock('framer-motion', () => ({
  motion: {
    aside: ({ children, ...props }: any) => <aside {...props}>{children}</aside>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock('recharts', () => ({
  PieChart: ({ children }: any) => <svg>{children}</svg>,
  Pie: () => null,
  Cell: () => null,
  Legend: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  X: () => <span>X</span>,
  BarChart2: () => <span>Chart</span>,
  Table: () => <span>Table</span>,
  List: () => <span>List</span>,
  Search: () => <span>Search</span>,
}));

vi.mock('../lib/store', () => ({
  useStore: mockUseStore,
  DISASTER_TYPES: [
    { id: 'flood', label: 'Flood', color: '#3b82f6' },
    { id: 'landslide', label: 'Landslide', color: '#8b5cf6' },
    { id: 'vehicular_accident', label: 'Vehicular Accident', color: '#ef4444' },
    { id: 'earthquake', label: 'Earthquake', color: '#f97316' },
    { id: 'storm_surge', label: 'Storm Surge', color: '#06b6d4' },
    { id: 'tsunami', label: 'Tsunami', color: '#ec4899' },
  ],
}));

import { AnalyticsPanel } from './AnalyticsPanel';

describe('AnalyticsPanel', () => {
  const defaultStoreValue = {
    isAnalyticsOpen: true,
    filteredHazards: [h1, h2, h3],
    setAnalyticsOpen: mockSetAnalyticsOpen,
    flyTo: mockFlyTo,
    setSelectedHazard: mockSetSelectedHazard,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseStore.mockReturnValue(defaultStoreValue);
  });

  describe('List Tab', () => {
    beforeEach(() => {
      mockUseStore.mockReturnValue({
        ...defaultStoreValue,
        filteredHazards: [h1, h2, h3],
      });
      render(<AnalyticsPanel />);
      const listTab = screen.getAllByRole('button', { name: /list/i })[0];
      fireEvent.click(listTab);
    });

    it('renders hazard with real title', () => {
      expect(screen.getByText('Brgy. Bagasbas Flooding')).toBeInTheDocument();
    });

    it('renders severity badges', () => {
      expect(screen.getAllByText('Moderate').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Severe').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Minor').length).toBeGreaterThan(0);
    });

    it('clicking hazard calls setSelectedHazard', () => {
      const hazardCard = screen.getByText('Brgy. Bagasbas Flooding').closest('[class*="bg-surface-container-lowest"]');
      if (hazardCard) {
        fireEvent.click(hazardCard);
      }
      expect(mockSetSelectedHazard).toHaveBeenCalledWith(h1);
    });

    it('search input filters displayed hazards', () => {
      const searchInput = screen.getByPlaceholderText('Search incidents...');
      fireEvent.change(searchInput, { target: { value: 'Landslide' } });
      expect(screen.getByText('Mercedes Landslide Zone')).toBeInTheDocument();
      expect(screen.queryByText('Brgy. Bagasbas Flooding')).not.toBeInTheDocument();
    });
  });

  describe('Fallback text', () => {
    it('renders Untitled Incident when title is missing', () => {
      const hazardWithoutTitle = { ...h1, title: '' };
      mockUseStore.mockReturnValue({
        ...defaultStoreValue,
        filteredHazards: [hazardWithoutTitle],
      });
      render(<AnalyticsPanel />);
      const allButtons = screen.getAllByRole('button');
      const listBtn = allButtons.find(btn => btn.textContent?.includes('List'));
      if (listBtn) fireEvent.click(listBtn);
      const h4Elements = document.querySelectorAll('h4');
      const hasUntitled = Array.from(h4Elements).some(el => el.textContent?.includes('Untitled'));
      expect(hasUntitled).toBe(true);
    });
  });

  describe('Tab Switching', () => {
    it('renders chart tab', () => {
      render(<AnalyticsPanel />);
      expect(screen.getByText('Severity Distribution')).toBeInTheDocument();
    });

    it('renders table tab', () => {
      render(<AnalyticsPanel />);
      const tableTab = screen.getByRole('button', { name: /table/i });
      fireEvent.click(tableTab);
      expect(screen.getByText('Summary Matrix')).toBeInTheDocument();
    });

    it('renders list tab', () => {
      render(<AnalyticsPanel />);
      const listTab = screen.getAllByRole('button', { name: /list/i })[0];
      fireEvent.click(listTab);
      expect(screen.getByText('Raw Feed')).toBeInTheDocument();
    });
  });
});
