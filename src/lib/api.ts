import { db, Hazard } from './db';
import axios from 'axios';
import { useStore, SYNC_STATUS } from './store';

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
      useStore.getState().setSyncError('Operating offline — data may not reflect recent changes');
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
      useStore.getState().setSyncError('Operating offline — data may not reflect recent changes');
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
      useStore.getState().setSyncError('Operating offline — data may not reflect recent changes');
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
      useStore.getState().setSyncError('Operating offline — data may not reflect recent changes');
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
      if (failedItems.length > 0) {
        useStore.getState().setSyncError(`Sync partially failed: ${failedItems.length} item(s) failed`);
      }
    }
  }
};
