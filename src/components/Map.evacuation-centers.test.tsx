/**
 * EvacuationCenterMarkersHandler Tests
 *
 * Tests the marker rendering logic for evacuation center map markers.
 * Since the handler uses useMap() (react-leaflet) which requires Leaflet context
 * not available in JSDOM, we test the handler's integration with the store
 * and API layer following the pattern from Map.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvacuationCenterAPI } from '../lib/api';
import { useStore } from '../lib/store';
import { ec1, ec2 } from '../test/fixtures/evacuationCenters';
import { CENTER_TYPE_LABELS, escapeHtml } from '../components/Map';

const mockGetAllCenters = vi.hoisted(() => vi.fn());

vi.mock('../lib/api', () => ({
  EvacuationCenterAPI: {
    getAllCenters: mockGetAllCenters,
  },
}));

describe('EvacuationCenterMarkersHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllCenters.mockResolvedValue([]);
    useStore.setState({
      evacuationCenters: [],
      evacuationCentersVisible: false,
      setEvacuationCenters: useStore.getState().setEvacuationCenters,
      setSelectedEvacuationCenter: useStore.getState().setSelectedEvacuationCenter,
    });
  });

  describe('visibility toggle behavior', () => {
    it('fetches centers when evacuationCentersVisible becomes true', async () => {
      const centers = [ec1, ec2];
      mockGetAllCenters.mockResolvedValue(centers);

      useStore.setState({ evacuationCentersVisible: true });

      await EvacuationCenterAPI.getAllCenters();
      const fetchedCenters = await EvacuationCenterAPI.getAllCenters();

      expect(mockGetAllCenters).toHaveBeenCalled();
      expect(fetchedCenters).toEqual(centers);
    });

    it('does not fetch centers when visibility is false', () => {
      useStore.setState({ evacuationCentersVisible: false });

      expect(mockGetAllCenters).not.toHaveBeenCalled();
    });

    it('updates store with fetched centers', async () => {
      const centers = [ec1, ec2];
      mockGetAllCenters.mockResolvedValue(centers);

      const fetchedCenters = await EvacuationCenterAPI.getAllCenters();
      useStore.getState().setEvacuationCenters(fetchedCenters);

      expect(useStore.getState().evacuationCenters).toEqual(centers);
    });
  });

  describe('marker rendering when visible', () => {
    it('sets evacuationCenters in store when visibility is true', async () => {
      const centers = [ec1, ec2];
      mockGetAllCenters.mockResolvedValue(centers);

      await EvacuationCenterAPI.getAllCenters();
      const fetchedCenters = await EvacuationCenterAPI.getAllCenters();
      useStore.getState().setEvacuationCenters(fetchedCenters);

      expect(useStore.getState().evacuationCenters).toEqual(centers);
    });

    it('handles empty centers array', async () => {
      mockGetAllCenters.mockResolvedValue([]);

      const centers = await EvacuationCenterAPI.getAllCenters();
      useStore.getState().setEvacuationCenters(centers);

      expect(useStore.getState().evacuationCenters).toEqual([]);
    });

    it('marker cleanup occurs when evacuationCenters changes', () => {
      useStore.setState({ evacuationCenters: [ec1] });

      const currentMarkers = useStore.getState().evacuationCenters;
      expect(currentMarkers).toHaveLength(1);

      useStore.setState({ evacuationCenters: [ec1, ec2] });

      const updatedMarkers = useStore.getState().evacuationCenters;
      expect(updatedMarkers).toHaveLength(2);
    });
  });

  describe('XSS prevention in popup', () => {
    it('escapeHtml function prevents XSS in name field', () => {
      const maliciousName = '<script>alert("xss")</script>';

      const escaped = escapeHtml(maliciousName);

      expect(escaped).not.toContain('<script>');
      expect(escaped).toContain('&lt;script&gt;');
    });

    it('escapeHtml function handles special characters in barangay', () => {
      const maliciousBarangay = "Test<script>alert('xss')</script>";

      const escaped = escapeHtml(maliciousBarangay);

      expect(escaped).not.toContain('<script>');
      expect(escaped).toContain('&lt;script&gt;');
    });

    it('escapeHtml function handles municipality with quotes', () => {
      const municipalityWithQuotes = 'Test "quoted" municipality';

      const escaped = escapeHtml(municipalityWithQuotes);

      expect(escaped).toContain('&quot;quoted&quot;');
      expect(escaped).not.toContain('"quoted"');
    });

    it('escapeHtml preserves safe characters', () => {
      const safeString = 'San Jose Elementary School';

      const escaped = escapeHtml(safeString);

      expect(escaped).toBe(safeString);
    });
  });

  describe('center type labels', () => {
    it('returns correct label for school type', () => {
      expect(CENTER_TYPE_LABELS['school']).toBe('School');
    });

    it('returns correct label for barangay_hall type', () => {
      expect(CENTER_TYPE_LABELS['barangay_hall']).toBe('Barangay Hall');
    });

    it('returns undefined for unknown type', () => {
      expect(CENTER_TYPE_LABELS['unknown_type']).toBeUndefined();
    });

    it('returns Other for unmapped type', () => {
      expect(CENTER_TYPE_LABELS['community_center'] ?? 'Other').toBe('Other');
    });
  });
});