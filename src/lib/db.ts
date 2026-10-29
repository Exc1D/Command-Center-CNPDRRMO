import Dexie, { Table } from 'dexie';
import type { PlanningRevision, PlanningScenario, PlanningTemplate } from './planning';

export type SyncStatus = 'synced' | 'pending_add' | 'pending_update' | 'pending_delete' | 'conflict';

export interface Hazard {
  id: string;
  type: string;
  symbolKey?: string | null;
  severity: string;
  title?: string;
  susceptibility?: string;
  affectedPopulation?: number | null;
  affectedPopulationBasis?: 'reported' | 'population_estimate';
  municipality?: string;
  barangay?: string;
  notes: string;
  geometry: any; // GeoJSON geometry representation
  dateAdded: string;
  version?: number;
  conflictData?: string;
  syncStatus?: SyncStatus;
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
  // DROMIC-style occupancy; optional because records cached before these fields existed lack them.
  status?: 'standby' | 'open' | 'full' | 'closed';
  familiesNow?: number;
  personsNow?: number;
  familiesCumulative?: number;
  personsCumulative?: number;
  occupancyUpdatedAt?: string;
  version?: number;
  conflictData?: string;
  syncStatus?: SyncStatus;
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
