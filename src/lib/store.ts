import { create } from 'zustand';
import { Hazard, EvacuationCenter } from './db';
import type { PlanningScenario } from './planning';

import { HAZARD_TYPES, FLOOD_COLORS, filterIncidents } from './reference';

type BaseMapType = 'street' | 'topo' | 'satellite';

interface AppState {
  referenceLayers: string[];
  elementLayers: string[];
  incidentsVisible: boolean;
  selectedMunicipality: string;
  selectedBarangay: string;
  toggleReferenceLayer: (id: string) => void;
  toggleElementLayer: (id: string) => void;
  toggleIncidents: () => void;
  setLocationFilter: (municipality: string, barangay: string) => void;
  hazards: Hazard[];
  filteredHazards: Hazard[];
  activeFilters: string[];
  activeSusceptibilityFilters: string[];
  baseMap: BaseMapType;
  selectedHazard: Hazard | null;
  mapCenter: [number, number];
  mapZoom: number;
  evacuationCenters: EvacuationCenter[];
  evacuationCentersVisible: boolean;
  toggleEvacuationCenters: () => void;
  
  // Evacuation center modal
  isEvacuationCenterModalOpen: boolean;
  evacuationCenterTempCoords: [number, number] | null;
  openEvacuationCenterModal: (coords: [number, number]) => void;
  closeEvacuationCenterModal: () => void;

  // Evacuation center selection (for popup card)
  selectedEvacuationCenter: EvacuationCenter | null;
  setSelectedEvacuationCenter: (center: EvacuationCenter | null) => void;

  // Authorization
  isMapAuthorized: boolean;

  // Sync state
  syncState: { isSyncing: boolean; lastSyncError: string | null };
  setSyncState: (s: { isSyncing: boolean; lastSyncError: string | null }) => void;
  clearSyncError: () => void;
  setSyncError: (msg: string) => void;

  // Modals state
  isDropTagModalOpen: boolean;
  dropTagTempGeometry: any | null; // From geoman
  isPinModalOpen: boolean;
  pinActionType: 'delete' | 'unlock' | null;
  pinActionData: any;
  isAnalyticsOpen: boolean;

  // Edit hazard modal
  isEditModalOpen: boolean;
  editModalHazard: Hazard | null;
  openEditModal: (hazard: Hazard) => void;
  closeEditModal: () => void;

  // Actions
  setHazards: (h: Hazard[]) => void;
  setEvacuationCenters: (c: EvacuationCenter[]) => void;
  toggleFilter: (type: string) => void;
  toggleSusceptibilityFilter: (level: string) => void;
  setBaseMap: (map: BaseMapType) => void;
  setSelectedHazard: (h: Hazard | null) => void;
  flyTo: (center: [number, number], zoom: number) => void;
  applyPlanningMapState: (mapState: PlanningScenario['mapState']) => void;
  setMapAuthorized: (val: boolean) => void;
  
  openDropTagModal: (geom: any) => void;
  closeDropTagModal: () => void;
  
  openPinModal: (type: 'delete' | 'unlock', data?: any) => void;
  closePinModal: () => void;

  setAnalyticsOpen: (val: boolean) => void;
}

export const DISASTER_TYPES = HAZARD_TYPES;
export const SUSCEPTIBILITY_LEVELS = Object.entries(FLOOD_COLORS).map(([id,color]) => ({id,label:id,color}));

export const SYNC_STATUS = {
  SYNCED: 'synced',
  PENDING_ADD: 'pending_add',
  PENDING_UPDATE: 'pending_update',
  PENDING_DELETE: 'pending_delete',
} as const;

export const useStore = create<AppState>((set) => ({
  referenceLayers: [],
  elementLayers: [],
  incidentsVisible: true,
  selectedMunicipality: '',
  selectedBarangay: '',
  toggleReferenceLayer: id => set(s => ({referenceLayers: s.referenceLayers.includes(id) ? s.referenceLayers.filter(x => x !== id) : [...s.referenceLayers,id]})),
  toggleElementLayer: id => set(s => ({elementLayers: s.elementLayers.includes(id) ? s.elementLayers.filter(x => x !== id) : [...s.elementLayers,id]})),
  toggleIncidents: () => set(s => ({incidentsVisible: !s.incidentsVisible})),
  setLocationFilter: (selectedMunicipality,selectedBarangay) => set(s => ({selectedMunicipality,selectedBarangay,filteredHazards:filterIncidents(s.hazards,s.activeFilters,selectedMunicipality,selectedBarangay)})),
  hazards: [],
  filteredHazards: [],
  activeFilters: HAZARD_TYPES.map(t=>t.id),
  activeSusceptibilityFilters: [],
  baseMap: 'street',
  selectedHazard: null,
  mapCenter: [14.1167, 122.9500] as [number, number], // Camarines Norte center approx
  mapZoom: 10,
  evacuationCenters: [],
  evacuationCentersVisible: false,
  toggleEvacuationCenters: () => set((state) => ({ evacuationCentersVisible: !state.evacuationCentersVisible })),

  isEvacuationCenterModalOpen: false,
  evacuationCenterTempCoords: null,
  openEvacuationCenterModal: (coords) => set({ isEvacuationCenterModalOpen: true, evacuationCenterTempCoords: coords }),
  closeEvacuationCenterModal: () => set({ isEvacuationCenterModalOpen: false, evacuationCenterTempCoords: null }),

  selectedEvacuationCenter: null,
  setSelectedEvacuationCenter: (center) => set({ selectedEvacuationCenter: center }),

  isMapAuthorized: false,

  isDropTagModalOpen: false,
  dropTagTempGeometry: null,
  isPinModalOpen: false,
  pinActionType: null,
  pinActionData: null,
  isAnalyticsOpen: false,

  isEditModalOpen: false,
  editModalHazard: null,
  openEditModal: (hazard) => set({ isEditModalOpen: true, editModalHazard: hazard }),
  closeEditModal: () => set({ isEditModalOpen: false, editModalHazard: null }),

  setHazards: (hazards) => set((state) => {
    return {
      hazards,
      filteredHazards: filterIncidents(hazards,state.activeFilters,state.selectedMunicipality,state.selectedBarangay),
      selectedHazard: state.selectedHazard ? hazards.find(hazard => hazard.id === state.selectedHazard?.id) ?? null : null,
    };
  }),
  setEvacuationCenters: (evacuationCenters) => set(state => ({
    evacuationCenters,
    selectedEvacuationCenter: state.selectedEvacuationCenter
      ? evacuationCenters.find(center => center.id === state.selectedEvacuationCenter?.id) ?? null
      : null,
  })),
  toggleFilter: (type) => set((state) => {
    const newFilters = state.activeFilters.includes(type)
      ? state.activeFilters.filter(f => f !== type)
      : [...state.activeFilters, type];
    return {
      activeFilters: newFilters,
      filteredHazards: filterIncidents(state.hazards,newFilters,state.selectedMunicipality,state.selectedBarangay)
    };
  }),
  toggleSusceptibilityFilter: (level) => set((state) => {
    const newSuscepFilters = state.activeSusceptibilityFilters.includes(level)
      ? state.activeSusceptibilityFilters.filter(f => f !== level)
      : [...state.activeSusceptibilityFilters, level];
    return { activeSusceptibilityFilters: newSuscepFilters };
  }),
  setBaseMap: (baseMap) => set({ baseMap }),
  setSelectedHazard: (selectedHazard) => set({ selectedHazard }),
  flyTo: (mapCenter, mapZoom) => set({ mapCenter, mapZoom }),
  applyPlanningMapState: (mapState) => set(state => ({
    mapCenter: mapState.center,
    mapZoom: mapState.zoom,
    baseMap: mapState.baseMap,
    activeFilters: mapState.activeFilters,
    activeSusceptibilityFilters: mapState.susceptibilityFilters,
    evacuationCentersVisible: mapState.evacuationCentersVisible,
    referenceLayers: mapState.referenceLayers ?? [],
    elementLayers: [...new Set((mapState.elementLayers ?? []).map(id=>id==='households'?'population':id==='lifelines'?'facilities':id))],
    incidentsVisible: mapState.incidentsVisible ?? true,
    selectedMunicipality: mapState.selectedMunicipality ?? '',
    selectedBarangay: mapState.selectedBarangay ?? '',
    filteredHazards: filterIncidents(state.hazards,mapState.activeFilters,mapState.selectedMunicipality,mapState.selectedBarangay),
  })),
  setMapAuthorized: (isMapAuthorized) => set({ isMapAuthorized }),
  
  openDropTagModal: (geom) => set({ isDropTagModalOpen: true, dropTagTempGeometry: geom }),
  closeDropTagModal: () => set({ isDropTagModalOpen: false, dropTagTempGeometry: null }),
  
  openPinModal: (type, data) => set({ isPinModalOpen: true, pinActionType: type, pinActionData: data }),
  closePinModal: () => set({ isPinModalOpen: false, pinActionType: null, pinActionData: null }),

  setAnalyticsOpen: (val) => set({ isAnalyticsOpen: val }),

  // Sync state
  syncState: { isSyncing: false, lastSyncError: null },
  setSyncState: (s) => set({ syncState: s }),
  clearSyncError: () => set((state) => ({ syncState: { ...state.syncState, lastSyncError: null } })),
  setSyncError: (msg) => set((state) => ({ syncState: { ...state.syncState, lastSyncError: msg } })),
}));
