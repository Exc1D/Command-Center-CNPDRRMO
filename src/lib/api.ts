import { db, Hazard, EvacuationCenter } from './db';
import axios from 'axios';
import { useStore, SYNC_STATUS } from './store';

const OFFLINE_WARNING = 'Operating offline — data may not reflect recent changes';

// A simple API wrapper to handle online/offline syncing

export const HazardAPI = {
  async getAllHazards(): Promise<Hazard[]> {
    try {
      if (navigator.onLine) {
        const response = await axios.get('/api/hazards');
        const onlineHazards: Hazard[] = response.data.map((h: any) => ({
          ...h,
          geometry: typeof h.geometry === 'string' ? JSON.parse(h.geometry) : h.geometry,
          syncStatus: SYNC_STATUS.SYNCED,
        }));
        
        // Sync local DB with server data
        await db.hazards.bulkPut(onlineHazards);
        return onlineHazards;
      }
    } catch (e) {
      console.warn("Failed to fetch from server, falling back to local DB.", e);
      useStore.getState().setSyncError(OFFLINE_WARNING);
    }
    
    // Offline fallback
    return await db.hazards.toArray();
  },

  async addHazard(hazard: Omit<Hazard, 'syncStatus'>): Promise<void> {
    try {
      if (navigator.onLine) {
        await axios.post('/api/hazards', hazard);
        await db.hazards.put({ ...hazard, syncStatus: SYNC_STATUS.SYNCED });
      } else {
        await db.hazards.put({ ...hazard, syncStatus: SYNC_STATUS.PENDING_ADD });
      }
    } catch (e) {
      console.warn("Server unavailable, saving locally.", e);
      useStore.getState().setSyncError(OFFLINE_WARNING);
      await db.hazards.put({ ...hazard, syncStatus: SYNC_STATUS.PENDING_ADD });
    }
  },

  async updateHazard(hazard: Omit<Hazard, 'syncStatus'>): Promise<void> {
    try {
      if (navigator.onLine) {
        await axios.put(`/api/hazards/${hazard.id}`, hazard);
        await db.hazards.put({ ...hazard, syncStatus: SYNC_STATUS.SYNCED });
      } else {
        await db.hazards.put({ ...hazard, syncStatus: SYNC_STATUS.PENDING_UPDATE });
      }
    } catch (e) {
      console.warn("Server unavailable, saving locally.", e);
      useStore.getState().setSyncError(OFFLINE_WARNING);
      await db.hazards.put({ ...hazard, syncStatus: SYNC_STATUS.PENDING_UPDATE });
    }
  },

  async deleteHazard(id: string): Promise<void> {
    try {
      if (navigator.onLine) {
        await axios.delete(`/api/hazards/${id}`);
        await db.hazards.delete(id);
      } else {
        const existing = await db.hazards.get(id);
        if (existing) {
          await db.hazards.put({ ...existing, syncStatus: SYNC_STATUS.PENDING_DELETE });
        }
      }
    } catch (e) {
      console.warn("Server unavailable, marking for deletion locally.", e);
      useStore.getState().setSyncError(OFFLINE_WARNING);
      const existing = await db.hazards.get(id);
      if (existing) {
        await db.hazards.put({ ...existing, syncStatus: SYNC_STATUS.PENDING_DELETE });
      }
    }
  },

  // Called when internet comes back
  async syncPending() {
    if (!navigator.onLine) return;
    const state = useStore.getState();
    if (state.syncState.isSyncing) return; // Mutex guard

    useStore.getState().setSyncState({ isSyncing: true, lastSyncError: null });

    const failedItems: { id: string; type: string; error: string }[] = [];

    try {
      const pendingAdds = (await db.hazards.where('syncStatus').equals(SYNC_STATUS.PENDING_ADD).toArray()) ?? [];
      for (const hazard of pendingAdds) {
        try {
          await axios.post('/api/hazards', hazard);
          await db.hazards.update(hazard.id, { syncStatus: SYNC_STATUS.SYNCED });
        } catch (e) {
          failedItems.push({ id: hazard.id, type: 'add', error: (e as Error).message });
        }
      }

      const pendingUpdates = (await db.hazards.where('syncStatus').equals(SYNC_STATUS.PENDING_UPDATE).toArray()) ?? [];
      for (const hazard of pendingUpdates) {
        try {
          await axios.put(`/api/hazards/${hazard.id}`, hazard);
          await db.hazards.update(hazard.id, { syncStatus: SYNC_STATUS.SYNCED });
        } catch (e) {
          failedItems.push({ id: hazard.id, type: 'update', error: (e as Error).message });
        }
      }

      const pendingDeletes = (await db.hazards.where('syncStatus').equals(SYNC_STATUS.PENDING_DELETE).toArray()) ?? [];
      for (const hazard of pendingDeletes) {
        try {
          await axios.delete(`/api/hazards/${hazard.id}`);
          await db.hazards.delete(hazard.id);
        } catch (e) {
          failedItems.push({ id: hazard.id, type: 'delete', error: (e as Error).message });
        }
      }
    } finally {
      useStore.getState().setSyncState({ isSyncing: false, lastSyncError: null });
    }
  }
};

export const EvacuationCenterAPI = {
  async getAllCenters(): Promise<EvacuationCenter[]> {
    try {
      if (navigator.onLine) {
        const response = await axios.get('/api/evacuation-centers');
        const onlineCenters: EvacuationCenter[] = response.data.map((c: any) => ({
          ...c,
          coordinates: typeof c.coordinates === 'string' ? JSON.parse(c.coordinates) : c.coordinates,
          syncStatus: SYNC_STATUS.SYNCED,
        }));
        await db.evacuationCenters.bulkPut(onlineCenters);
        return onlineCenters;
      }
    } catch (e) {
      console.warn("Failed to fetch from server, falling back to local DB.", e);
      useStore.getState().setSyncError(OFFLINE_WARNING);
    }
    return await db.evacuationCenters.toArray();
  },

  async addCenter(center: Omit<EvacuationCenter, 'syncStatus'>): Promise<void> {
    try {
      if (navigator.onLine) {
        await axios.post('/api/evacuation-centers', center);
        await db.evacuationCenters.put({ ...center, syncStatus: SYNC_STATUS.SYNCED });
      } else {
        await db.evacuationCenters.put({ ...center, syncStatus: SYNC_STATUS.PENDING_ADD });
      }
    } catch (e) {
      console.warn("Server unavailable, saving locally.", e);
      useStore.getState().setSyncError(OFFLINE_WARNING);
      await db.evacuationCenters.put({ ...center, syncStatus: SYNC_STATUS.PENDING_ADD });
    }
  },

  async updateCenter(center: Omit<EvacuationCenter, 'syncStatus'>): Promise<void> {
    try {
      if (navigator.onLine) {
        await axios.put(`/api/evacuation-centers/${center.id}`, center);
        await db.evacuationCenters.put({ ...center, syncStatus: SYNC_STATUS.SYNCED });
      } else {
        await db.evacuationCenters.put({ ...center, syncStatus: SYNC_STATUS.PENDING_UPDATE });
      }
    } catch (e) {
      console.warn("Server unavailable, saving locally.", e);
      useStore.getState().setSyncError(OFFLINE_WARNING);
      await db.evacuationCenters.put({ ...center, syncStatus: SYNC_STATUS.PENDING_UPDATE });
    }
  },

  async deleteCenter(id: string): Promise<void> {
    try {
      if (navigator.onLine) {
        await axios.delete(`/api/evacuation-centers/${id}`);
        await db.evacuationCenters.delete(id);
      } else {
        const existing = await db.evacuationCenters.get(id);
        if (existing) {
          await db.evacuationCenters.put({ ...existing, syncStatus: SYNC_STATUS.PENDING_DELETE });
        }
      }
    } catch (e) {
      console.warn("Server unavailable, marking for deletion locally.", e);
      useStore.getState().setSyncError(OFFLINE_WARNING);
      const existing = await db.evacuationCenters.get(id);
      if (existing) {
        await db.evacuationCenters.put({ ...existing, syncStatus: SYNC_STATUS.PENDING_DELETE });
      }
    }
  },

  async syncPending() {
    if (!navigator.onLine) return;
    const state = useStore.getState();
    if (state.syncState.isSyncing) return;

    useStore.getState().setSyncState({ isSyncing: true, lastSyncError: null });

    const failedItems: { id: string; type: string; error: string }[] = [];

    try {
      const pendingAdds = (await db.evacuationCenters.where('syncStatus').equals(SYNC_STATUS.PENDING_ADD).toArray()) ?? [];
      for (const center of pendingAdds) {
        try {
          await axios.post('/api/evacuation-centers', center);
          await db.evacuationCenters.update(center.id, { syncStatus: SYNC_STATUS.SYNCED });
        } catch (e) {
          failedItems.push({ id: center.id, type: 'add', error: (e as Error).message });
        }
      }

      const pendingUpdates = (await db.evacuationCenters.where('syncStatus').equals(SYNC_STATUS.PENDING_UPDATE).toArray()) ?? [];
      for (const center of pendingUpdates) {
        try {
          await axios.put(`/api/evacuation-centers/${center.id}`, center);
          await db.evacuationCenters.update(center.id, { syncStatus: SYNC_STATUS.SYNCED });
        } catch (e) {
          failedItems.push({ id: center.id, type: 'update', error: (e as Error).message });
        }
      }

      const pendingDeletes = (await db.evacuationCenters.where('syncStatus').equals(SYNC_STATUS.PENDING_DELETE).toArray()) ?? [];
      for (const center of pendingDeletes) {
        try {
          await axios.delete(`/api/evacuation-centers/${center.id}`);
          await db.evacuationCenters.delete(center.id);
        } catch (e) {
          failedItems.push({ id: center.id, type: 'delete', error: (e as Error).message });
        }
      }

      if (failedItems.length > 0) {
        useStore.getState().setSyncError(`Evacuation center sync partially failed: ${failedItems.length} item(s) failed`);
      }
    } finally {
      // Only reset isSyncing; preserve lastSyncError (set above if failures occurred)
      useStore.getState().setSyncState({ isSyncing: false, lastSyncError: failedItems.length > 0 ? useStore.getState().syncState.lastSyncError : null });
    }
  }
};
