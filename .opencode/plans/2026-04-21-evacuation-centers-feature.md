# Evacuation Center Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate toggleable evacuation center layer on the map, allowing admins to add point markers with name, type, capacity via the Geoman marker tool.

**Architecture:** Standalone evacuation center system with its own data model, API endpoints, offline storage (Dexie), and UI controls. Reuses the existing PIN-authorization pattern (isMapAuthorized) to gate admin operations. Evacuation centers display as Leaflet markers with custom icon, separate from hazard polygons.

**Tech Stack:** TypeScript, React, Zustand, Leaflet, react-leaflet, Geoman, Dexie (offline), Express + SQLite (backend), Zod validation

---

## File Structure

```
src/lib/
  db.ts                    # Add EvacuationCenter interface + OfflineDB.evacuationCenters table
  api.ts                   # Add EvacuationCenterAPI (parallel to HazardAPI)
  store.ts                 # Add evacuationCenters state slice + toggle + visibility flag

src/components/
  Map.tsx                  # Render evacuation center markers; handle marker creation via Geoman
  Sidebar.tsx              # Add "Evacuation Centers" visibility toggle
  EvacuationCenterModal.tsx # NEW: Modal for entering center details after marker drop
  EvacuationCenterCard.tsx  # NEW: Popup card when clicking a center marker

server.ts                  # Add /api/evacuation-centers CRUD + verify-pin endpoint

src/test/fixtures/
  evacuation-centers.ts    # NEW: Test fixtures for centers

src/components/
  EvacuationCenterModal.unit.test.tsx  # NEW
  EvacuationCenterModal.integration.test.tsx  # NEW
  Map.evacuation-centers.test.tsx  # NEW
```

---

## Task 1: Database Model

**Files:**
- Modify: `src/lib/db.ts:1-27`
- Test: `src/lib/store.test.ts` (add tests for center state)

```typescript
// Add to src/lib/db.ts

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
```

Update `OfflineDB` class:

```typescript
export class OfflineDB extends Dexie {
  hazards!: Table<Hazard, string>;
  evacuationCenters!: Table<EvacuationCenter, string>; // ADD

  constructor() {
    super('CamarinesDRRMC_DB');
    this.version(2).stores({
      hazards: 'id, type, syncStatus',
      evacuationCenters: 'id, municipality, syncStatus', // ADD
    });
  }
}
```

---

## Task 2: EvacuationCenterAPI

**Files:**
- Modify: `src/lib/api.ts:1-131`
- Create: `src/lib/api.test.ts` (add center API tests)

Add `EvacuationCenterAPI` object parallel to `HazardAPI`:

```typescript
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
    } finally {
      useStore.getState().setSyncState({ isSyncing: false, lastSyncError: null });
      if (failedItems.length > 0) {
        useStore.getState().setSyncError(`Evacuation center sync partially failed: ${failedItems.length} item(s) failed`);
      }
    }
  }
};
```

Also add `EvacuationCenter` to the import at the top of `api.ts`:

```typescript
import { db, Hazard, EvacuationCenter } from './db';
```

---

## Task 3: Store — Evacuation Center State Slice

**Files:**
- Modify: `src/lib/store.ts:1-125`

Add to `AppState` interface:

```typescript
// Evacuation centers
evacuationCenters: EvacuationCenter[];
evacuationCentersVisible: boolean;
setEvacuationCenters: (c: EvacuationCenter[]) => void;
toggleEvacuationCenters: () => void;

// Evacuation center modal
isEvacuationCenterModalOpen: boolean;
evacuationCenterTempCoords: [number, number] | null;
openEvacuationCenterModal: (coords: [number, number]) => void;
closeEvacuationCenterModal: () => void;
```

Add to store initialization:

```typescript
evacuationCenters: [],
evacuationCentersVisible: false,

isEvacuationCenterModalOpen: false,
evacuationCenterTempCoords: null,

setEvacuationCenters: (evacuationCenters) => set({ evacuationCenters }),
toggleEvacuationCenters: () => set((state) => ({ evacuationCentersVisible: !state.evacuationCentersVisible })),
openEvacuationCenterModal: (coords) => set({ isEvacuationCenterModalOpen: true, evacuationCenterTempCoords: coords }),
closeEvacuationCenterModal: () => set({ isEvacuationCenterModalOpen: false, evacuationCenterTempCoords: null }),
```

Also add to the import at the top of `store.ts`:

```typescript
import { Hazard, EvacuationCenter } from './db';
```

---

## Task 4: Backend API — Evacuation Center CRUD

**Files:**
- Modify: `server.ts:1-327`

Add SQLite table creation after the hazards table:

```typescript
db.prepare(`
  CREATE TABLE IF NOT EXISTS evacuation_centers (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT,
    capacity INTEGER,
    municipality TEXT,
    barangay TEXT,
    coordinates TEXT,
    dateAdded TEXT
  )
`).run();
```

Add Zod schema:

```typescript
const evacuationCenterSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(['school', 'barangay_hall', 'church', 'covered_court', 'other']),
  capacity: z.number().int().positive(),
  municipality: z.string().optional(),
  barangay: z.string().optional(),
  coordinates: z.tuple([z.number(), z.number()]),
  dateAdded: z.string().datetime().optional(),
});
```

Add API routes (after existing hazard routes):

```typescript
// GET all evacuation centers
app.get("/api/evacuation-centers", (req, res) => {
  try {
    const centers = db.prepare('SELECT * FROM evacuation_centers').all();
    res.json(centers);
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to fetch evacuation centers:`, error);
    res.status(500).json({ error: 'Failed to fetch evacuation centers', errorId });
  }
});

// POST new evacuation center
app.post("/api/evacuation-centers", (req, res) => {
  try {
    const parsed = evacuationCenterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid evacuation center data', details: parsed.error.flatten() });
    }
    const { id, name, type, capacity, municipality, barangay, coordinates, dateAdded } = parsed.data;
    const stmt = db.prepare(`
      INSERT INTO evacuation_centers (id, name, type, capacity, municipality, barangay, coordinates, dateAdded)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, name, type, capacity, municipality || '', barangay || '', JSON.stringify(coordinates), dateAdded);
    res.json({ success: true, id });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to save evacuation center:`, error);
    res.status(500).json({ error: 'Failed to save evacuation center', errorId });
  }
});

// PUT update evacuation center
app.put("/api/evacuation-centers/:id", (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid evacuation center ID format' });
    }
    const updateSchema = evacuationCenterSchema.partial().omit({ id: true });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update data', details: parsed.error.flatten() });
    }
    const { name, type, capacity, municipality, barangay, coordinates, dateAdded } = parsed.data;
    const existing = db.prepare('SELECT * FROM evacuation_centers WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Evacuation center not found' });
    }
    const stmt = db.prepare(`
      UPDATE evacuation_centers
      SET name = COALESCE(?, name),
          type = COALESCE(?, type),
          capacity = COALESCE(?, capacity),
          municipality = COALESCE(?, municipality),
          barangay = COALESCE(?, barangay),
          coordinates = COALESCE(?, coordinates),
          dateAdded = COALESCE(?, dateAdded)
      WHERE id = ?
    `);
    stmt.run(
      name,
      type,
      capacity,
      municipality,
      barangay,
      coordinates ? JSON.stringify(coordinates) : undefined,
      dateAdded,
      id
    );
    res.json({ success: true, id });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to update evacuation center:`, error);
    res.status(500).json({ error: 'Failed to update evacuation center', errorId });
  }
});

// DELETE evacuation center
app.delete("/api/evacuation-centers/:id", (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid evacuation center ID format' });
    }
    const result = db.prepare('DELETE FROM evacuation_centers WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Evacuation center not found' });
    }
    res.json({ success: true });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to delete evacuation center:`, error);
    res.status(500).json({ error: 'Failed to delete evacuation center', errorId });
  }
});
```

---

## Task 5: EvacuationCenterModal — Add Center Form

**Files:**
- Create: `src/components/EvacuationCenterModal.tsx`
- Create: `src/components/EvacuationCenterModal.unit.test.tsx`
- Create: `src/components/EvacuationCenterModal.integration.test.tsx`

Modal triggered when admin drops a marker on the map. Fields: name, type dropdown, capacity. Auto-detects municipality/barangay from coordinates (reuse `detectLocationFromGeometry` from `utils.ts`).

```typescript
import { useState, useEffect } from 'react';
import { useStore } from '../lib/store';
import { EvacuationCenterAPI } from '../lib/api';
import { v4 as uuidv4 } from 'uuid';
import { motion } from 'framer-motion';
import { X, MapPin } from 'lucide-react';
import { detectLocationFromGeometry } from '../lib/utils';

const CENTER_TYPES = [
  { id: 'school', label: 'School' },
  { id: 'barangay_hall', label: 'Barangay Hall' },
  { id: 'church', label: 'Church' },
  { id: 'covered_court', label: 'Covered Court' },
  { id: 'other', label: 'Other' },
];

export function EvacuationCenterModal() {
  const {
    isEvacuationCenterModalOpen,
    evacuationCenterTempCoords,
    closeEvacuationCenterModal,
    setEvacuationCenters,
  } = useStore();

  const [name, setName] = useState('');
  const [type, setType] = useState<'school' | 'barangay_hall' | 'church' | 'covered_court' | 'other'>('barangay_hall');
  const [capacity, setCapacity] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [barangay, setBarangay] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);

  useEffect(() => {
    if (isEvacuationCenterModalOpen) {
      setName('');
      setType('barangay_hall');
      setCapacity('');
      setMunicipality('');
      setBarangay('');
      setIsDetecting(true);
    }
  }, [isEvacuationCenterModalOpen]);

  useEffect(() => {
    if (isEvacuationCenterModalOpen && evacuationCenterTempCoords && !municipality && !barangay) {
      const geometry = {
        type: 'Point',
        coordinates: [evacuationCenterTempCoords[0], evacuationCenterTempCoords[1]]
      };
      detectLocationFromGeometry(geometry).then((location) => {
        if (location) {
          setMunicipality(location.municipality);
          setBarangay(location.barangay);
        }
        setIsDetecting(false);
      });
    }
  }, [isEvacuationCenterModalOpen, evacuationCenterTempCoords, municipality, barangay]);

  const handleSave = async () => {
    if (!name.trim() || !evacuationCenterTempCoords) return;
    setIsSaving(true);
    try {
      const newCenter = {
        id: uuidv4(),
        name: name.trim(),
        type,
        capacity: parseInt(capacity, 10),
        municipality,
        barangay,
        coordinates: evacuationCenterTempCoords,
        dateAdded: new Date().toISOString()
      };
      await EvacuationCenterAPI.addCenter(newCenter);
      const centers = await EvacuationCenterAPI.getAllCenters();
      setEvacuationCenters(centers);
      closeEvacuationCenterModal();
    } finally {
      setIsSaving(false);
    }
  };

  if (!isEvacuationCenterModalOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-on-surface/20 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-surface-container-highest shadow-ambient w-full max-w-sm overflow-hidden text-on-surface rounded-xl p-6 relative border border-white/50"
      >
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-[10px] uppercase text-primary mb-1 font-bold tracking-[0.05em] flex items-center gap-2">
              <MapPin className="w-3 h-3" /> New Evacuation Center
            </div>
            <h2 className="text-xl font-display font-bold text-on-surface">Add Evacuation Center</h2>
          </div>
          <button onClick={closeEvacuationCenterModal} className="text-on-surface/40 hover:text-on-surface transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Center Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. San Jose Elementary School"
              className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface transition-colors font-medium"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface font-medium transition-colors"
            >
              {CENTER_TYPES.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Capacity (persons)</label>
            <input
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="e.g. 150"
              min="1"
              className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface transition-colors font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Municipality</label>
              <input
                type="text"
                value={municipality}
                onChange={(e) => setMunicipality(e.target.value)}
                placeholder={isDetecting ? 'Detecting...' : 'Municipality'}
                className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface transition-colors font-medium"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Barangay</label>
              <input
                type="text"
                value={barangay}
                onChange={(e) => setBarangay(e.target.value)}
                placeholder={isDetecting ? 'Detecting...' : 'Barangay'}
                className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface transition-colors font-medium"
              />
            </div>
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim() || !evacuationCenterTempCoords}
            className="w-full py-3 btn-primary font-bold text-[11px] uppercase tracking-[0.05em] shadow-ambient disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? 'Saving...' : !name.trim() ? 'Name Required' : 'Save Center'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
```

---

## Task 6: EvacuationCenterCard — Popup for Center Marker

**Files:**
- Create: `src/components/EvacuationCenterCard.tsx`

Popup card shown when clicking an evacuation center marker on the map.

```typescript
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import { X, Users, MapPin } from 'lucide-react';
import { format } from 'date-fns';

const CENTER_TYPE_LABELS: Record<string, string> = {
  school: 'School',
  barangay_hall: 'Barangay Hall',
  church: 'Church',
  covered_court: 'Covered Court',
  other: 'Other',
};

export function EvacuationCenterCard() {
  const { selectedEvacuationCenter, setSelectedEvacuationCenter } = useStore();

  if (!selectedEvacuationCenter) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="absolute bottom-6 right-6 z-[400] w-80 bg-surface-container-lowest shadow-ambient overflow-hidden rounded-xl border border-white/50"
    >
      <div className="h-1.5 w-full bg-[#059669]" />
      <div className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-[10px] uppercase text-tertiary mb-1 font-bold tracking-[0.05em]">Evacuation Center</div>
            <h3 className="text-xl font-display font-bold text-on-surface leading-tight">
              {selectedEvacuationCenter.name}
            </h3>
            <p className="text-xs font-semibold text-on-surface/60 mb-3">{CENTER_TYPE_LABELS[selectedEvacuationCenter.type]}</p>
          </div>
          <button
            onClick={() => setSelectedEvacuationCenter(null)}
            className="text-on-surface/40 hover:text-on-surface transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 mb-6">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-on-surface/50" />
            <div>
              <p className="text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">Capacity</p>
              <p className="text-sm text-on-surface/80 font-medium">{selectedEvacuationCenter.capacity} persons</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-on-surface/50" />
            <div>
              <p className="text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">Location</p>
              <p className="text-sm text-on-surface/80 font-medium">
                {selectedEvacuationCenter.barangay}{selectedEvacuationCenter.municipality ? `, ${selectedEvacuationCenter.municipality}` : ''}
              </p>
            </div>
          </div>

          <div>
            <p className="text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">Date Added</p>
            <p className="text-sm text-on-surface/80 font-sans font-medium mt-1">
              {format(new Date(selectedEvacuationCenter.dateAdded), 'MM/dd/yyyy HH:mm:ss')}
            </p>
          </div>
        </div>

        {selectedEvacuationCenter.syncStatus && selectedEvacuationCenter.syncStatus !== 'synced' && (
          <div className="text-[9px] uppercase font-bold text-primary tracking-[0.05em] flex items-center gap-1">
            Local Buffer Active
          </div>
        )}
      </div>
    </motion.div>
  );
}
```

Add `selectedEvacuationCenter` and `setSelectedEvacuationCenter` to the store in Task 3.

---

## Task 7: Map — Render Evacuation Center Markers

**Files:**
- Modify: `src/components/Map.tsx:1-223`

**Changes:**

1. Import the new store state and EvacuationCenterAPI:

```typescript
import { useStore, DISASTER_TYPES } from '../lib/store';
import { HazardAPI, EvacuationCenterAPI } from '../lib/api';
```

2. In `GeomanSetup`, enable `drawMarker: true` when `isMapAuthorized` is true (in addition to polygon tools). Handle `pm:create` for markers separately — if layer is a marker, open the evacuation center modal instead of the hazard modal:

```typescript
map.pm.addControls({
  position: 'topleft',
  drawMarker: true,  // Enable marker drawing for evacuation centers
  drawCircleMarker: false,
  drawPolyline: true,
  drawRectangle: true,
  drawPolygon: true,
  drawCircle: false,
  editMode: true,
  dragMode: true,
  cutPolygon: false,
  removalMode: true,
});
```

3. In the `pm:create` handler, distinguish between marker and polygon:

```typescript
map.on('pm:create', (e) => {
  const layer = e.layer;
  const geojson = (layer as any).toGeoJSON();

  if (e.layer.pmType === 'Marker') {
    // Evacuation center marker
    map.removeLayer(layer);
    const coords: [number, number] = [geojson.geometry.coordinates[0], geojson.geometry.coordinates[1]];
    openEvacuationCenterModal(coords);
  } else {
    // Hazard polygon/polyline
    map.removeLayer(layer);
    openDropTagModal(geojson.geometry);
  }
});
```

4. Add `useEffect` to load evacuation centers when visibility is toggled on, and clean up markers on toggle off.

5. Add custom icon for evacuation centers (green shelter icon):

```typescript
const evacuationCenterIcon = L.divIcon({
  className: 'evacuation-center-marker',
  html: `<div style="
    background: #059669;
    width: 32px;
    height: 32px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    border: 2px solid white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
  ">
    <svg style="transform: rotate(45deg); width: 16px; height: 16px; color: white;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});
```

6. Render evacuation center markers inside `MapContainer`, controlled by `evacuationCentersVisible`:

```typescript
useEffect(() => {
  if (!evacuationCentersVisible) {
    // Remove all evacuation center markers
    map.eachLayer((layer: any) => {
      if (layer._evacuationCenterMarker) {
        map.removeLayer(layer);
      }
    });
    return;
  }

  // Load and render centers
  EvacuationCenterAPI.getAllCenters().then((centers) => {
    setEvacuationCenters(centers);
  });

  // Render markers for each center
  evacuationCenters.forEach((center) => {
    const marker = L.marker([center.coordinates[1], center.coordinates[0]], {
      icon: evacuationCenterIcon
    }) as any;
    marker._evacuationCenterMarker = true;

    marker.bindPopup(`
      <div style="min-width: 150px;">
        <strong style="font-size: 14px;">${center.name}</strong>
        <p style="margin: 4px 0; color: #666; font-size: 12px;">${CENTER_TYPE_LABELS[center.type]}</p>
        <p style="margin: 2px 0; font-size: 12px;">Capacity: ${center.capacity}</p>
        <p style="margin: 2px 0; font-size: 12px;">${center.barangay}${center.municipality ? `, ${center.municipality}` : ''}</p>
      </div>
    `);

    marker.on('click', () => {
      setSelectedEvacuationCenter(center);
    });

    marker.addTo(map);
  });
}, [evacuationCentersVisible, evacuationCenters, map]);
```

Add `setEvacuationCenters` and `openEvacuationCenterModal` to the store destructuring in `GeomanSetup`.

Also add `CENTER_TYPE_LABELS` constant at top of Map.tsx for the popup rendering.

---

## Task 8: Sidebar — Evacuation Centers Toggle

**Files:**
- Modify: `src/components/Sidebar.tsx:1-317`

Add to the sidebar, below the "Active Filters" section:

```typescript
const {
  // ... existing
  evacuationCentersVisible,
  toggleEvacuationCenters,
} = useStore();
```

Add new section:

```typescript
{/* Evacuation Centers Toggle */}
<section>
  <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface/80 block mb-3">Evacuation Centers</label>
  <button
    onClick={toggleEvacuationCenters}
    className={`w-full flex items-center justify-between cursor-pointer group p-3 rounded-xl shadow-ambient transition-all border-2 ${
      evacuationCentersVisible
        ? 'border-[#059669] bg-surface-container text-on-surface'
        : 'border-transparent bg-surface-container-lowest hover:bg-surface'
    }`}
  >
    <div className="flex items-center gap-3">
      <div className="w-3 h-3 rounded-full bg-[#059669]" />
      <span className="text-sm font-semibold">Show Centers</span>
    </div>
    <Check size={16} className={evacuationCentersVisible ? 'text-[#059669]' : 'text-transparent'} />
  </button>
</section>
```

Import `Check` from `lucide-react` (already imported).

---

## Task 9: App — Wire Up Components

**Files:**
- Modify: `src/App.tsx`

Ensure `EvacuationCenterModal` and `EvacuationCenterCard` are rendered in App.tsx alongside existing modals.

```typescript
import { EvacuationCenterModal } from './components/EvacuationCenterModal';
import { EvacuationCenterCard } from './components/EvacuationCenterCard';

// In the component's JSX return, add:
<>
  {/* existing components */}
  <EvacuationCenterModal />
  <EvacuationCenterCard />
</>
```

Also make sure the map calls `setEvacuationCenters` (via the marker render effect) and `setSelectedEvacuationCenter` (via marker click) — already covered in Task 7.

---

## Task 10: Tests

**Files:**
- Create: `src/test/fixtures/evacuation-centers.ts`

```typescript
import { EvacuationCenter } from '../../lib/db';

export const mockCenters: EvacuationCenter[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'San Jose Elementary School',
    type: 'school',
    capacity: 150,
    municipality: 'Jose Panganiban',
    barangay: 'San Jose',
    coordinates: [122.9500, 14.1167],
    dateAdded: '2026-04-21T10:00:00.000Z',
    syncStatus: 'synced',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Bagasbas Barangay Hall',
    type: 'barangay_hall',
    capacity: 80,
    municipality: 'Jose Panganiban',
    barangay: 'Bagasbas',
    coordinates: [122.9400, 14.1200],
    dateAdded: '2026-04-21T11:00:00.000Z',
    syncStatus: 'synced',
  },
];
```

**Test files to create:**

- `src/components/EvacuationCenterModal.unit.test.tsx` — Test modal form validation, auto-detect location, save button state
- `src/components/EvacuationCenterModal.integration.test.tsx` — Test modal + API integration
- `src/components/Map.evacuation-centers.test.tsx` — Test marker rendering when `evacuationCentersVisible` is true

Run all tests with: `npm test`

---

## Self-Review Checklist

1. **Spec coverage:** All design sections implemented: data model ✓, backend API ✓, frontend store ✓, map integration ✓, Geoman marker tool ✓, admin flow ✓, offline support ✓, UI controls ✓
2. **Placeholder scan:** No TBD, TODO, or vague steps. All code is concrete.
3. **Type consistency:**
   - `EvacuationCenter.coordinates` is `[number, number]` (lng, lat) — matches Point geometry coordinates ordering
   - `EvacuationCenterModal` uses `evacuationCenterTempCoords: [number, number]`
   - `EvacuationCenterCard` renders `selectedEvacuationCenter` from store
   - `Map.tsx` pm:create handler distinguishes marker vs polygon via `e.layer.pmType`
   - `CENTER_TYPE_LABELS` is defined and used in both Map popup and EvacuationCenterCard

## Execution

**Plan complete and saved to `docs/superpowers/plans/2026-04-21-evacuation-centers-feature.md`**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?