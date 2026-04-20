import { create } from 'zustand';
import { Hazard } from './db';

type BaseMapType = 'street' | 'topo' | 'satellite';

interface AppState {
  hazards: Hazard[];
  filteredHazards: Hazard[];
  activeFilters: string[];
  baseMap: BaseMapType;
  selectedHazard: Hazard | null;
  mapCenter: [number, number];
  mapZoom: number;
  
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
  toggleFilter: (type: string) => void;
  setBaseMap: (map: BaseMapType) => void;
  setSelectedHazard: (h: Hazard | null) => void;
  flyTo: (center: [number, number], zoom: number) => void;
  setMapAuthorized: (val: boolean) => void;
  
  openDropTagModal: (geom: any) => void;
  closeDropTagModal: () => void;
  
  openPinModal: (type: 'delete' | 'unlock', data?: any) => void;
  closePinModal: () => void;

  setAnalyticsOpen: (val: boolean) => void;
}

export const DISASTER_TYPES = [
  { id: 'flood', label: 'Flood', color: '#1d4ed8' }, // deep blue
  { id: 'storm_surge', label: 'Storm Surge', color: '#0369a1' },
  { id: 'landslide', label: 'Landslide', color: '#f59e0b' }, // amber
  { id: 'vehicular_accident', label: 'Vehicular Accident', color: '#dc2626' },
  { id: 'earthquake', label: 'Earthquake Fault', color: '#991b1b' }, // crimson red
  { id: 'tsunami', label: 'Tsunami', color: '#0ea5e9' }
];

export const SYNC_STATUS = {
  SYNCED: 'synced',
  PENDING_ADD: 'pending_add',
  PENDING_UPDATE: 'pending_update',
  PENDING_DELETE: 'pending_delete',
} as const;

export const useStore = create<AppState>((set) => ({
  hazards: [],
  filteredHazards: [],
  activeFilters: [],
  baseMap: 'street',
  selectedHazard: null,
  mapCenter: [14.1167, 122.9500] as [number, number], // Camarines Norte center approx
  mapZoom: 10,
  
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

  setHazards: (hazards) => set((state) => ({ 
    hazards, 
    filteredHazards: hazards.filter(h => state.activeFilters.includes(h.type)) 
  })),
  toggleFilter: (type) => set((state) => {
    const newFilters = state.activeFilters.includes(type)
      ? state.activeFilters.filter(f => f !== type)
      : [...state.activeFilters, type];
    return {
      activeFilters: newFilters,
      filteredHazards: state.hazards.filter(h => newFilters.includes(h.type))
    };
  }),
  setBaseMap: (baseMap) => set({ baseMap }),
  setSelectedHazard: (selectedHazard) => set({ selectedHazard }),
  flyTo: (mapCenter, mapZoom) => set({ mapCenter, mapZoom }),
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
