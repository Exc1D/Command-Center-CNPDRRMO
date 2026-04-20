# Command Center - CNPDRRMO

**Camarines Norte Provincial Disaster Risk Reduction & Management Office**

A real-time hazard tracking and management system for the Province of Camarines Norte, Philippines. Enables field operatives to report, monitor, and analyze disaster events with offline-first capability.

## Features

- **Interactive Hazard Map** — Leaflet-based map with Geoman drawing tools for marking hazard zones (floods, landslides, storm surges, earthquakes, vehicular accidents, tsunami)
- **Offline-First Architecture** — IndexedDB via Dexie stores data locally; syncs automatically when connectivity returns
- **Multi-Layer Topography** — Switch between street (OSM), topographic contour, and ESRI satellite layers
- **Barangay-Level Targeting** — Navigate to any of the 287 barangays across 12 municipalities
- **Analytics Dashboard** — Visualize hazard distribution and trends with Recharts
- **PDF Report Export** — Generate mission-ready PDF reports with map snapshots via html2canvas + jsPDF
- **PIN-Protected Operations** — Map editing requires authorization to prevent unauthorized modifications
- **Real-Time Sync Status** — Visual indicator of sync state between local database and server

## Tech Stack

**Frontend**
- React 19 + TypeScript
- Vite (build tool)
- Tailwind CSS v4
- Zustand (state management)
- Framer Motion (animations)
- Leaflet + React-Leaflet (mapping)
- @geoman-io/leaflet-geoman-free (drawing tools)
- Recharts (analytics)
- Dexie (IndexedDB wrapper)
- Lucide React (icons)

**Backend**
- Express.js
- better-sqlite3 (SQLite)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Opens the app at `http://localhost:5173` with the Express server running on port 3001.

### Build

```bash
npm run build
```

### Production

```bash
npm start
```

Runs the built Express server from `dist/server.cjs`.

## Project Structure

```
src/
├── App.tsx              # Root component with layout
├── main.tsx             # Entry point
├── index.css            # Global styles + Tailwind
├── components/
│   ├── Sidebar.tsx      # Navigation, filters, incident logs
│   ├── Map.tsx          # Leaflet map with hazard layers
│   ├── Modals.tsx       # DropTag, Pin, PopUp modals
│   ├── EditHazardModal.tsx
│   └── AnalyticsPanel.tsx
└── lib/
    ├── db.ts            # Dexie IndexedDB schema
    ├── api.ts           # Online/offline API wrapper
    ├── store.ts         # Zustand state + disaster types
    ├── utils.ts         # Utility functions
    └── barangays.json   # All 287 barangays with coordinates
```

## Hazard Types

| ID | Label | Color |
|---|---|---|
| `flood` | Flood | `#1d4ed8` |
| `storm_surge` | Storm Surge | `#0369a1` |
| `landslide` | Landslide | `#f59e0b` |
| `vehicular_accident` | Vehicular Accident | `#dc2626` |
| `earthquake` | Earthquake Fault | `#991b1b` |
| `tsunami` | Tsunami | `#0ea5e9` |

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/hazards` | Fetch all hazards |
| POST | `/api/hazards` | Create a hazard |
| PUT | `/api/hazards/:id` | Update a hazard |
| DELETE | `/api/hazards/:id` | Delete a hazard |

## Sync Mechanism

The app operates in three states per record:
- `synced` — confirmed on server
- `pending_add` — created offline, awaiting sync
- `pending_update` — modified offline, awaiting sync
- `pending_delete` — marked for deletion, awaiting sync

When the browser goes online (`online` event), `HazardAPI.syncPending()` uploads all pending changes.

## License

Private — Provincial Disaster Risk Reduction & Management Office, Camarines Norte
