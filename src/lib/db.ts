import Dexie, { Table } from 'dexie';

export interface Hazard {
  id: string;
  type: string;
  severity: string;
  title?: string;
  notes: string;
  geometry: any; // GeoJSON geometry representation
  dateAdded: string;
  syncStatus?: 'synced' | 'pending_add' | 'pending_update' | 'pending_delete';
}

export class OfflineDB extends Dexie {
  hazards!: Table<Hazard, string>;

  constructor() {
    super('CamarinesDRRMC_DB');
    this.version(1).stores({
      hazards: 'id, type, syncStatus',
    });
  }
}

export const db = new OfflineDB();
