import Dexie, { Table } from 'dexie';

export interface Hazard {
  id: string;
  type: string;
  severity: string;
  title?: string;
  municipality?: string;
  barangay?: string;
  notes: string;
  geometry: any; // GeoJSON geometry representation
  dateAdded: string;
  syncStatus?: 'synced' | 'pending_add' | 'pending_update' | 'pending_delete';
}

export interface EvacuationCenter {
  id: string;
  name: string;
  type: 'school' | 'barangay_hall' | 'church' | 'covered_court' | 'other';
  capacity: number;
  municipality: string;
  barangay: string;
  coordinates: [number, number]; // [lng, lat]
  dateAdded: string;
  syncStatus?: 'synced' | 'pending_add' | 'pending_update' | 'pending_delete';
}

export class OfflineDB extends Dexie {
  hazards!: Table<Hazard, string>;
  evacuationCenters!: Table<EvacuationCenter, string>;

  constructor() {
    super('CamarinesDRRMC_DB');
    this.version(2).stores({
      hazards: 'id, type, syncStatus',
      evacuationCenters: 'id, syncStatus',
    });
  }
}

export const db = new OfflineDB();
