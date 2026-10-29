import axios from 'axios';
import type { Table } from 'dexie';
import { db, type EvacuationCenter, type Hazard, type SyncStatus } from './db';
import { useStore } from './store';

const OFFLINE_WARNING = 'Operating offline — changes are safely queued';
type SyncRecord = { id: string; version?: number; conflictData?: string; syncStatus?: SyncStatus };

const statusOf = (error: unknown) => axios.isAxiosError(error) ? error.response?.status : undefined;

export function retryable(error: unknown) {
  return axios.isAxiosError(error) && (!error.response || error.response.status === 429 || error.response.status >= 500);
}

function reportQueued(error: unknown) {
  if (!retryable(error)) {
    const message = axios.isAxiosError(error) && typeof error.response?.data?.error === 'string' ? error.response.data.error : 'The server rejected this change';
    useStore.getState().setSyncError(message);
    if (statusOf(error) === 401) useStore.getState().setMapAuthorized(false);
    throw error;
  }
  useStore.getState().setSyncError(OFFLINE_WARNING);
}

async function reconcile<T extends SyncRecord>(table: Table<T, string>, server: T[]) {
  const local = await table.toArray();
  const pending = local.filter(item => item.syncStatus?.startsWith('pending_'));
  const conflicts = new Map(local.filter(item => item.syncStatus === 'conflict').map(item => [item.id, item]));
  const pendingIds = new Set(pending.map(item => item.id));
  const serverIds = new Set(server.map(item => item.id));
  const stale = local.filter(item => !item.syncStatus?.startsWith('pending_') && item.syncStatus !== 'conflict' && !serverIds.has(item.id)).map(item => item.id);
  const merged = server.filter(item => !pendingIds.has(item.id)).map(item => {
    const conflict = conflicts.get(item.id);
    return conflict ? { ...item, conflictData: conflict.conflictData, syncStatus: 'conflict' } as T : item;
  });
  if (stale.length) await table.bulkDelete(stale);
  await table.bulkPut(merged);
  return [...merged, ...pending.filter(item => item.syncStatus !== 'pending_delete'), ...[...conflicts.values()].filter(item => !serverIds.has(item.id))];
}

const comparable = (record: object, field: string) =>
  JSON.stringify((record as Record<string, unknown>)[field] ?? (field === 'affectedPopulationBasis' ? 'reported' : null));

// One offline-first client per table: write through when online, queue in IndexedDB otherwise.
function syncedTable<T extends SyncRecord>({ table, endpoint, fields, fromServer, label, resetsError }: {
  table: Table<T, string>;
  endpoint: string;
  fields: string[];
  fromServer: (row: T) => T;
  label: string;
  // The first sync of a refresh clears the old error; later ones keep it so they don't hide it.
  resetsError: boolean;
}) {
  type Draft = Omit<T, 'syncStatus'>;
  const save = (record: Draft, syncStatus: SyncStatus, version = record.version) => table.put({ ...record, version, syncStatus } as T);
  const markSynced = (id: string, version: number | undefined) => table.update(id, record => {
    record.version = version;
    record.syncStatus = 'synced';
  });
  let running: Promise<void> | null = null;

  async function resolveConflict(error: unknown, local: Draft) {
    if (!axios.isAxiosError(error) || error.response?.status !== 409 || !error.response.data?.current) return 'unhandled' as const;
    const current = fromServer(error.response.data.current);
    if (fields.every(field => comparable(current, field) === comparable(local, field))) {
      await table.put(current);
      return 'idempotent' as const;
    }
    await table.put({ ...current, conflictData: JSON.stringify(local), syncStatus: 'conflict' });
    return 'conflict' as const;
  }

  const api = {
    async getAll(): Promise<T[]> {
      try {
        if (navigator.onLine) {
          const response = await axios.get(endpoint);
          return reconcile(table, (response.data as T[]).map(fromServer));
        }
      } catch (error) {
        console.warn(`Failed to fetch ${label.toLowerCase()}s; using the local cache.`, error);
        useStore.getState().setSyncError(OFFLINE_WARNING);
      }
      return (await table.toArray()).filter(record => record.syncStatus !== 'pending_delete');
    },

    async add(record: Draft) {
      try {
        if (navigator.onLine) {
          const response = await axios.post(endpoint, record);
          await save(record, 'synced', response.data.version);
          return;
        }
      } catch (error) {
        // Already on the server (an earlier attempt landed), so there is nothing to queue.
        if (statusOf(error) === 409) {
          await save(record, 'synced', record.version ?? 1);
          return;
        }
        reportQueued(error);
      }
      await save(record, 'pending_add');
    },

    async update(record: Draft) {
      if ((await table.get(record.id))?.syncStatus === 'pending_add') {
        await save(record, 'pending_add');
        if (navigator.onLine) await api.syncPending();
        return;
      }
      try {
        if (navigator.onLine) {
          const response = await axios.put(`${endpoint}/${record.id}`, record);
          await save(record, 'synced', response.data.version);
          return;
        }
      } catch (error) {
        if (await resolveConflict(error, record) !== 'unhandled') return;
        reportQueued(error);
      }
      await save(record, 'pending_update');
    },

    async remove(id: string) {
      try {
        if (navigator.onLine) {
          await axios.delete(`${endpoint}/${id}`);
          await table.delete(id);
          return;
        }
      } catch (error) {
        if (statusOf(error) === 404) {
          await table.delete(id);
          return;
        }
        reportQueued(error);
      }
      const existing = await table.get(id);
      if (existing) await save(existing, 'pending_delete');
    },

    async acceptConflict(id: string) {
      const existing = await table.get(id);
      if (existing?.syncStatus !== 'conflict') return;
      delete existing.conflictData;
      await save(existing, 'synced');
    },

    async applyConflict(id: string) {
      const existing = await table.get(id);
      if (!existing?.conflictData) return;
      await api.update({ ...JSON.parse(existing.conflictData), version: existing.version });
    },

    syncPending() {
      if (!navigator.onLine) return Promise.resolve();
      if (running) return running;
      running = (async () => {
        const priorError = resetsError ? null : useStore.getState().syncState.lastSyncError;
        useStore.getState().setSyncState({ isSyncing: true, lastSyncError: priorError });
        const failures: string[] = [];
        const process = async (status: SyncStatus, action: (record: T) => Promise<unknown>) => {
          for (const record of await table.where('syncStatus').equals(status).toArray()) {
            try { await action(record); } catch (error) { failures.push(`${record.id}: ${(error as Error).message}`); }
          }
        };
        try {
          await process('pending_add', async record => {
            try {
              const response = await axios.post(endpoint, record);
              await markSynced(record.id, response.data.version);
            } catch (error) {
              if (statusOf(error) !== 409) throw error;
              await markSynced(record.id, record.version ?? 1);
            }
          });
          await process('pending_update', async record => {
            try {
              const response = await axios.put(`${endpoint}/${record.id}`, record);
              await markSynced(record.id, response.data.version);
            } catch (error) {
              if (await resolveConflict(error, record) !== 'idempotent') throw error;
            }
          });
          await process('pending_delete', async record => {
            try { await axios.delete(`${endpoint}/${record.id}`); }
            catch (error) { if (statusOf(error) !== 404) throw error; }
            await table.delete(record.id);
          });
        } finally {
          useStore.getState().setSyncState({ isSyncing: false, lastSyncError: failures.length ? `${label} sync failed for ${failures.length} item(s)` : priorError });
        }
      })().finally(() => { running = null; });
      return running;
    },
  };
  return api;
}

const parsed = <V>(value: V | string): V => typeof value === 'string' ? JSON.parse(value) : value;

const hazards = syncedTable<Hazard>({
  table: db.hazards,
  endpoint: '/api/hazards',
  fields: ['type', 'symbolKey', 'severity', 'title', 'municipality', 'barangay', 'notes', 'geometry', 'dateAdded', 'affectedPopulation', 'affectedPopulationBasis'],
  fromServer: hazard => ({ ...hazard, geometry: parsed(hazard.geometry), syncStatus: 'synced' }),
  label: 'Hazard',
  resetsError: true,
});

const centers = syncedTable<EvacuationCenter>({
  table: db.evacuationCenters,
  endpoint: '/api/evacuation-centers',
  fields: ['name', 'type', 'capacity', 'municipality', 'barangay', 'coordinates', 'dateAdded', 'status', 'familiesNow', 'personsNow', 'familiesCumulative', 'personsCumulative', 'occupancyUpdatedAt'],
  fromServer: center => ({ ...center, coordinates: parsed(center.coordinates), syncStatus: 'synced' }),
  label: 'Evacuation center',
  resetsError: false,
});

export const HazardAPI = {
  getAllHazards: hazards.getAll,
  addHazard: hazards.add,
  updateHazard: hazards.update,
  deleteHazard: hazards.remove,
  acceptHazardConflict: hazards.acceptConflict,
  applyHazardConflict: hazards.applyConflict,
  syncPending: hazards.syncPending,
};

export const EvacuationCenterAPI = {
  getAllCenters: centers.getAll,
  addCenter: centers.add,
  updateCenter: centers.update,
  deleteCenter: centers.remove,
  acceptCenterConflict: centers.acceptConflict,
  applyCenterConflict: centers.applyConflict,
  syncPending: centers.syncPending,
};
