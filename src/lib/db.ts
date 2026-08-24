import Dexie, { Table } from 'dexie';
import type { PlanningRevision, PlanningScenario, PlanningTemplate } from './planning';

export interface Hazard {
  id: string;
  type: string;
  severity: string;
  title?: string;
  susceptibility?: string;
  municipality?: string;
  barangay?: string;
  notes: string;
  geometry: any; // GeoJSON geometry representation
  dateAdded: string;
  version?: number;
  conflictData?: string;
  syncStatus?: 'synced' | 'pending_add' | 'pending_update' | 'pending_delete' | 'conflict';
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
  version?: number;
  conflictData?: string;
  syncStatus?: 'synced' | 'pending_add' | 'pending_update' | 'pending_delete' | 'conflict';
}

export class OfflineDB extends Dexie {
  hazards!: Table<Hazard, string>;
  evacuationCenters!: Table<EvacuationCenter, string>;
  planningScenarios!: Table<PlanningScenario & { publishedRevision?: number | null; syncStatus?: string }, string>;
  planningRevisions!: Table<PlanningRevision, string>;
  planningTemplates!: Table<PlanningTemplate & { syncStatus?: string }, string>;

  constructor() {
    super('CamarinesDRRMC_DB');
    this.version(2).stores({
      hazards: 'id, type, syncStatus',
      evacuationCenters: 'id, syncStatus',
    });
    this.version(3).stores({
      hazards: 'id, type, syncStatus',
      evacuationCenters: 'id, syncStatus',
      planningScenarios: 'id, archivedAt, updatedAt, syncStatus',
      planningRevisions: 'id, scenarioId, revision, publishedAt',
      planningTemplates: 'id, name, updatedAt, syncStatus',
    });
  }
}

export const db = new OfflineDB();
