import axios from 'axios';
import type { Table } from 'dexie';
import { db, type EvacuationCenter, type Hazard } from './db';
import { SYNC_STATUS, useStore } from './store';

const OFFLINE_WARNING = 'Operating offline — changes are safely queued';
type SyncRecord = { id: string; syncStatus?: string };

async function reconcile<T extends SyncRecord>(table: Table<T, string>, server: T[]) {
  const local = await table.toArray();
  const pending = local.filter(item => item.syncStatus?.startsWith('pending_'));
  const pendingIds = new Set(pending.map(item => item.id));
  const serverIds = new Set(server.map(item => item.id));
  const stale = local.filter(item => !item.syncStatus?.startsWith('pending_') && !serverIds.has(item.id)).map(item => item.id);
  if (stale.length) await table.bulkDelete(stale);
  await table.bulkPut(server.filter(item => !pendingIds.has(item.id)));
  return [...server.filter(item => !pendingIds.has(item.id)), ...pending.filter(item => item.syncStatus !== SYNC_STATUS.PENDING_DELETE)];
}

function retryable(error: unknown) {
  return axios.isAxiosError(error) && (!error.response || error.response.status === 429 || error.response.status >= 500);
}

function reportQueued(error: unknown) {
  if (!retryable(error)) {
    const message = axios.isAxiosError(error) && typeof error.response?.data?.error === 'string' ? error.response.data.error : 'The server rejected this change';
    useStore.getState().setSyncError(message);
    if (axios.isAxiosError(error) && error.response?.status === 401) useStore.getState().setMapAuthorized(false);
    throw error;
  }
  useStore.getState().setSyncError(OFFLINE_WARNING);
}

let hazardSync: Promise<void> | null = null;
let centerSync: Promise<void> | null = null;

export const HazardAPI = {
  async getAllHazards(): Promise<Hazard[]> {
    try {
      if (navigator.onLine) {
        const response = await axios.get('/api/hazards');
        const server = (response.data as Hazard[]).map(hazard => ({
          ...hazard,
          geometry: typeof hazard.geometry === 'string' ? JSON.parse(hazard.geometry) : hazard.geometry,
          syncStatus: SYNC_STATUS.SYNCED,
        }));
        return reconcile(db.hazards, server);
      }
    } catch (error) {
      console.warn('Failed to fetch hazards; using the local cache.', error);
      useStore.getState().setSyncError(OFFLINE_WARNING);
    }
    return (await db.hazards.toArray()).filter(hazard => hazard.syncStatus !== SYNC_STATUS.PENDING_DELETE);
  },

  async addHazard(hazard: Omit<Hazard, 'syncStatus'>) {
    try {
      if (navigator.onLine) {
        const response = await axios.post('/api/hazards', hazard);
        await db.hazards.put({ ...hazard, version: response.data.version, syncStatus: SYNC_STATUS.SYNCED });
        return;
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        await db.hazards.put({ ...hazard, version: hazard.version ?? 1, syncStatus: SYNC_STATUS.SYNCED });
        return;
      }
      reportQueued(error);
    }
    await db.hazards.put({ ...hazard, syncStatus: SYNC_STATUS.PENDING_ADD });
  },

  async updateHazard(hazard: Omit<Hazard, 'syncStatus'>) {
    try {
      if (navigator.onLine) {
        const response = await axios.put(`/api/hazards/${hazard.id}`, hazard);
        await db.hazards.put({ ...hazard, version: response.data.version, syncStatus: SYNC_STATUS.SYNCED });
        return;
      }
    } catch (error) {
      reportQueued(error);
    }
    await db.hazards.put({ ...hazard, syncStatus: SYNC_STATUS.PENDING_UPDATE });
  },

  async deleteHazard(id: string) {
    try {
      if (navigator.onLine) {
        await axios.delete(`/api/hazards/${id}`);
        await db.hazards.delete(id);
        return;
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        await db.hazards.delete(id);
        return;
      }
      reportQueued(error);
    }
    const existing = await db.hazards.get(id);
    if (existing) await db.hazards.put({ ...existing, syncStatus: SYNC_STATUS.PENDING_DELETE });
  },

  syncPending() {
    if (!navigator.onLine) return Promise.resolve();
    if (hazardSync) return hazardSync;
    hazardSync = (async () => {
      useStore.getState().setSyncState({ isSyncing: true, lastSyncError: null });
      const failures: string[] = [];
      const process = async (status: string, action: (hazard: Hazard) => Promise<void>) => {
        for (const hazard of await db.hazards.where('syncStatus').equals(status).toArray()) {
          try { await action(hazard); } catch (error) { failures.push(`${hazard.id}: ${(error as Error).message}`); }
        }
      };
      try {
        await process(SYNC_STATUS.PENDING_ADD, async hazard => {
          try {
            const response = await axios.post('/api/hazards', hazard);
            await db.hazards.update(hazard.id, { version: response.data.version, syncStatus: SYNC_STATUS.SYNCED });
          } catch (error) {
            if (!axios.isAxiosError(error) || error.response?.status !== 409) throw error;
            await db.hazards.update(hazard.id, { version: hazard.version ?? 1, syncStatus: SYNC_STATUS.SYNCED });
          }
        });
        await process(SYNC_STATUS.PENDING_UPDATE, async hazard => {
          const response = await axios.put(`/api/hazards/${hazard.id}`, hazard);
          await db.hazards.update(hazard.id, { version: response.data.version, syncStatus: SYNC_STATUS.SYNCED });
        });
        await process(SYNC_STATUS.PENDING_DELETE, async hazard => {
          try { await axios.delete(`/api/hazards/${hazard.id}`); }
          catch (error) { if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error; }
          await db.hazards.delete(hazard.id);
        });
      } finally {
        useStore.getState().setSyncState({ isSyncing: false, lastSyncError: failures.length ? `Hazard sync failed for ${failures.length} item(s)` : null });
      }
    })().finally(() => { hazardSync = null; });
    return hazardSync;
  },
};

export const EvacuationCenterAPI = {
  async getAllCenters(): Promise<EvacuationCenter[]> {
    try {
      if (navigator.onLine) {
        const response = await axios.get('/api/evacuation-centers');
        const server = (response.data as EvacuationCenter[]).map(center => ({
          ...center,
          coordinates: typeof center.coordinates === 'string' ? JSON.parse(center.coordinates) : center.coordinates,
          syncStatus: SYNC_STATUS.SYNCED,
        }));
        return reconcile(db.evacuationCenters, server);
      }
    } catch (error) {
      console.warn('Failed to fetch evacuation centers; using the local cache.', error);
      useStore.getState().setSyncError(OFFLINE_WARNING);
    }
    return (await db.evacuationCenters.toArray()).filter(center => center.syncStatus !== SYNC_STATUS.PENDING_DELETE);
  },

  async addCenter(center: Omit<EvacuationCenter, 'syncStatus'>) {
    try {
      if (navigator.onLine) {
        const response = await axios.post('/api/evacuation-centers', center);
        await db.evacuationCenters.put({ ...center, version: response.data.version, syncStatus: SYNC_STATUS.SYNCED });
        return;
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        await db.evacuationCenters.put({ ...center, version: center.version ?? 1, syncStatus: SYNC_STATUS.SYNCED });
        return;
      }
      reportQueued(error);
    }
    await db.evacuationCenters.put({ ...center, syncStatus: SYNC_STATUS.PENDING_ADD });
  },

  async updateCenter(center: Omit<EvacuationCenter, 'syncStatus'>) {
    try {
      if (navigator.onLine) {
        const response = await axios.put(`/api/evacuation-centers/${center.id}`, center);
        await db.evacuationCenters.put({ ...center, version: response.data.version, syncStatus: SYNC_STATUS.SYNCED });
        return;
      }
    } catch (error) {
      reportQueued(error);
    }
    await db.evacuationCenters.put({ ...center, syncStatus: SYNC_STATUS.PENDING_UPDATE });
  },

  async deleteCenter(id: string) {
    try {
      if (navigator.onLine) {
        await axios.delete(`/api/evacuation-centers/${id}`);
        await db.evacuationCenters.delete(id);
        return;
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        await db.evacuationCenters.delete(id);
        return;
      }
      reportQueued(error);
    }
    const existing = await db.evacuationCenters.get(id);
    if (existing) await db.evacuationCenters.put({ ...existing, syncStatus: SYNC_STATUS.PENDING_DELETE });
  },

  syncPending() {
    if (!navigator.onLine) return Promise.resolve();
    if (centerSync) return centerSync;
    centerSync = (async () => {
      const priorError = useStore.getState().syncState.lastSyncError;
      useStore.getState().setSyncState({ isSyncing: true, lastSyncError: priorError });
      const failures: string[] = [];
      const process = async (status: string, action: (center: EvacuationCenter) => Promise<void>) => {
        for (const center of await db.evacuationCenters.where('syncStatus').equals(status).toArray()) {
          try { await action(center); } catch (error) { failures.push(`${center.id}: ${(error as Error).message}`); }
        }
      };
      try {
        await process(SYNC_STATUS.PENDING_ADD, async center => {
          try {
            const response = await axios.post('/api/evacuation-centers', center);
            await db.evacuationCenters.update(center.id, { version: response.data.version, syncStatus: SYNC_STATUS.SYNCED });
          } catch (error) {
            if (!axios.isAxiosError(error) || error.response?.status !== 409) throw error;
            await db.evacuationCenters.update(center.id, { version: center.version ?? 1, syncStatus: SYNC_STATUS.SYNCED });
          }
        });
        await process(SYNC_STATUS.PENDING_UPDATE, async center => {
          const response = await axios.put(`/api/evacuation-centers/${center.id}`, center);
          await db.evacuationCenters.update(center.id, { version: response.data.version, syncStatus: SYNC_STATUS.SYNCED });
        });
        await process(SYNC_STATUS.PENDING_DELETE, async center => {
          try { await axios.delete(`/api/evacuation-centers/${center.id}`); }
          catch (error) { if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error; }
          await db.evacuationCenters.delete(center.id);
        });
      } finally {
        useStore.getState().setSyncState({ isSyncing: false, lastSyncError: failures.length ? `Evacuation center sync failed for ${failures.length} item(s)` : priorError });
      }
    })().finally(() => { centerSync = null; });
    return centerSync;
  },
};
