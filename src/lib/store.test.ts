import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, DISASTER_TYPES } from './store';
import { h1, h2, h3, h4 } from '../test/fixtures/hazards';

describe('useStore', () => {
  beforeEach(() => {
    useStore.setState({
      hazards: [],
      filteredHazards: [],
      activeFilters: [],
      baseMap: 'street',
      selectedHazard: null,
      mapCenter: [14.1167, 122.9500],
      mapZoom: 10,
      isMapAuthorized: false,
      isDropTagModalOpen: false,
      dropTagTempGeometry: null,
      isPinModalOpen: false,
      pinActionType: null,
      pinActionData: null,
      isAnalyticsOpen: false,
      isEditModalOpen: false,
      editModalHazard: null
    });
  });

  describe('default state', () => {
    it('default activeFilters is empty', () => {
      const state = useStore.getState();
      expect(state.activeFilters).toEqual([]);
    });

    it('default filteredHazards is empty', () => {
      const state = useStore.getState();
      expect(state.filteredHazards).toEqual([]);
    });
  });

  describe('toggleFilter', () => {
    it('adds filter when toggling an inactive filter', () => {
      useStore.getState().toggleFilter('flood');
      const state = useStore.getState();
      expect(state.activeFilters).toContain('flood');
    });

    it('removes active filter when toggling an active filter', () => {
      useStore.getState().toggleFilter('flood');
      useStore.getState().toggleFilter('flood');
      const state = useStore.getState();
      expect(state.activeFilters).not.toContain('flood');
    });

    it('handles multiple toggles correctly', () => {
      useStore.getState().toggleFilter('flood');
      useStore.getState().toggleFilter('landslide');
      const state = useStore.getState();
      expect(state.activeFilters).toContain('flood');
      expect(state.activeFilters).toContain('landslide');
    });
  });

  describe('setHazards', () => {
    it('filters hazards by activeFilters', () => {
      useStore.getState().toggleFilter('landslide');
      useStore.getState().toggleFilter('storm_surge');
      useStore.getState().toggleFilter('vehicular_accident');
      useStore.getState().toggleFilter('earthquake');
      useStore.getState().toggleFilter('tsunami');
      useStore.getState().setHazards([h1, h2]);
      const state = useStore.getState();
      expect(state.hazards).toEqual([h1, h2]);
      expect(state.filteredHazards).toEqual([h2]);
    });

    it('returns all matching hazards when all match filter', () => {
      useStore.getState().toggleFilter('flood');
      useStore.getState().setHazards([h1, h1]);
      const state = useStore.getState();
      expect(state.filteredHazards).toEqual([h1, h1]);
    });

    it('returns empty array when no hazards match filters', () => {
      useStore.getState().toggleFilter('landslide');
      useStore.getState().toggleFilter('storm_surge');
      useStore.getState().toggleFilter('vehicular_accident');
      useStore.getState().toggleFilter('earthquake');
      useStore.getState().toggleFilter('tsunami');
      useStore.getState().setHazards([h1]);
      const state = useStore.getState();
      expect(state.filteredHazards).toEqual([]);
    });

    it('handles empty hazards array', () => {
      useStore.getState().setHazards([]);
      const state = useStore.getState();
      expect(state.filteredHazards).toEqual([]);
      expect(state.hazards).toEqual([]);
    });

    it('sets hazards array correctly', () => {
      useStore.getState().setHazards([h1, h2, h3, h4]);
      const state = useStore.getState();
      expect(state.hazards).toEqual([h1, h2, h3, h4]);
    });
  });

  describe('flyTo', () => {
    it('sets mapCenter and mapZoom atomically', () => {
      useStore.getState().flyTo([14.1, 122.9], 12);
      const state = useStore.getState();
      expect(state.mapCenter).toEqual([14.1, 122.9]);
      expect(state.mapZoom).toBe(12);
    });
  });

  describe('openEditModal / closeEditModal', () => {
    it('openEditModal sets isEditModalOpen=true and editModalHazard', () => {
      useStore.getState().openEditModal(h1);
      const state = useStore.getState();
      expect(state.isEditModalOpen).toBe(true);
      expect(state.editModalHazard).toEqual(h1);
    });

    it('closeEditModal resets isEditModalOpen=false and editModalHazard=null', () => {
      useStore.getState().openEditModal(h1);
      useStore.getState().closeEditModal();
      const state = useStore.getState();
      expect(state.isEditModalOpen).toBe(false);
      expect(state.editModalHazard).toBe(null);
    });
  });
});
