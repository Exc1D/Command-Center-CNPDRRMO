import { db, Hazard } from './db';
import axios from 'axios';

// A simple API wrapper to handle online/offline syncing

export const HazardAPI = {
  async getAllHazards(): Promise<Hazard[]> {
    try {
      if (navigator.onLine) {
        const response = await axios.get('/api/hazards');
        const onlineHazards: Hazard[] = response.data.map((h: any) => ({
          ...h,
          geometry: typeof h.geometry === 'string' ? JSON.parse(h.geometry) : h.geometry,
          syncStatus: 'synced',
        }));
        
        // Sync local DB with server data
        await db.hazards.bulkPut(onlineHazards);
        return onlineHazards;
      }
    } catch (e) {
      console.warn("Failed to fetch from server, falling back to local DB.", e);
    }
    
    // Offline fallback
    return await db.hazards.toArray();
  },

  async addHazard(hazard: Omit<Hazard, 'syncStatus'>): Promise<void> {
    try {
      if (navigator.onLine) {
        await axios.post('/api/hazards', hazard);
        await db.hazards.put({ ...hazard, syncStatus: 'synced' });
      } else {
        await db.hazards.put({ ...hazard, syncStatus: 'pending_add' });
      }
    } catch (e) {
      console.warn("Server unavailable, saving locally.", e);
      await db.hazards.put({ ...hazard, syncStatus: 'pending_add' });
    }
  },

  async updateHazard(hazard: Omit<Hazard, 'syncStatus'>): Promise<void> {
    try {
      if (navigator.onLine) {
        await axios.put(`/api/hazards/${hazard.id}`, hazard);
        await db.hazards.put({ ...hazard, syncStatus: 'synced' });
      } else {
        await db.hazards.put({ ...hazard, syncStatus: 'pending_update' });
      }
    } catch (e) {
      console.warn("Server unavailable, saving locally.", e);
      await db.hazards.put({ ...hazard, syncStatus: 'pending_update' });
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
          await db.hazards.put({ ...existing, syncStatus: 'pending_delete' });
        }
      }
    } catch (e) {
      console.warn("Server unavailable, marking for deletion locally.", e);
      const existing = await db.hazards.get(id);
      if (existing) {
        await db.hazards.put({ ...existing, syncStatus: 'pending_delete' });
      }
    }
  },

  // Called when internet comes back
  async syncPending() {
    if (!navigator.onLine) return;

    try {
      const pendingAdds = await db.hazards.where('syncStatus').equals('pending_add').toArray();
      for (const hazard of pendingAdds) {
        await axios.post('/api/hazards', hazard);
        await db.hazards.update(hazard.id, { syncStatus: 'synced' });
      }

      const pendingUpdates = await db.hazards.where('syncStatus').equals('pending_update').toArray();
      for (const hazard of pendingUpdates) {
        await axios.put(`/api/hazards/${hazard.id}`, hazard);
        await db.hazards.update(hazard.id, { syncStatus: 'synced' });
      }

      const pendingDeletes = await db.hazards.where('syncStatus').equals('pending_delete').toArray();
      for (const hazard of pendingDeletes) {
        await axios.delete(`/api/hazards/${hazard.id}`);
        await db.hazards.delete(hazard.id);
      }
    } catch (e) {
      console.error("Error during background sync", e);
    }
  }
};
