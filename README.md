# Command Center - CNPDRRMO

**Camarines Norte Provincial Disaster Risk Reduction & Management Office**

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![License](https://img.shields.io/badge/License-Proprietary-red)](#license)

A real-time hazard tracking and management system for the Province of Camarines Norte, Philippines. Enables field operatives to report, monitor, and analyze disaster events with offline-first capability.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [API Reference](#api-endpoints)
- [Sync Mechanism](#sync-mechanism)
- [Hazard Types](#hazard-types)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

- **Interactive Hazard Map** — Leaflet-based map with Geoman drawing tools for marking hazard zones (floods, landslides, storm surges, earthquakes, vehicular accidents, tsunami)
- **Offline-First Architecture** — IndexedDB via Dexie stores data locally; syncs automatically when connectivity returns
- **Multi-Layer Topography** — Switch between street (OSM), topographic contour, and ESRI satellite layers
- **Barangay-Level Targeting** — Navigate to any of the 287 barangays across 12 municipalities
- **Analytics Dashboard** — Visualize hazard distribution and trends with Recharts (Chart, Table, and List views)
- **PDF Report Export** — Generate mission-ready PDF reports with map snapshots via html2canvas + jsPDF
- **PIN-Protected Operations** — Map editing requires authorization to prevent unauthorized modifications
- **Real-Time Sync Status** — Visual indicator of sync state between local database and server
- **Evacuation Center Management** — Add, view, and manage evacuation shelters with capacity tracking, type classification, and automatic location detection

---

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

---

## Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd Command-Center-CNPDRRMO

# Install dependencies
npm install

# Start development server
npm run dev
```

App opens at `http://localhost:5173` with server on port `3001`.

---

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

---

## Project Structure

```
Command-Center-CNPDRRMO/
├── src/
│   ├── App.tsx              # Root component with layout
│   ├── main.tsx             # Entry point
│   ├── index.css             # Global styles + Tailwind
│   ├── components/
│   │   ├── Sidebar.tsx       # Navigation, filters, incident logs, PDF export
│   │   ├── Map.tsx           # Leaflet map with hazard layers
│   │   ├── Modals.tsx        # DropTag, Pin, PopUp modals
│   │   ├── EditHazardModal.tsx
│   │   ├── AnalyticsPanel.tsx
│   │   ├── EvacuationCenterModal.tsx
│   │   ├── EvacuationCenterCard.tsx
│   │   └── ErrorBoundary.tsx
│   ├── lib/
│   │   ├── db.ts             # Dexie IndexedDB schema (Hazards + EvacuationCenters)
│   │   ├── api.ts            # Online/offline API wrapper (HazardAPI + EvacuationCenterAPI)
│   │   ├── store.ts          # Zustand state + disaster types
│   │   ├── utils.ts          # Utility functions
│   │   └── barangays.json    # All 287 barangays with coordinates
│   └── test/                 # Test fixtures and setup
├── server.ts                 # Express server with SQLite + API routes
├── esbuild.config.ts         # Server bundler config
├── vite.config.ts            # Vite configuration
├── public/
│   ├── baranggays.geojson    # Barangay boundary data
│   └── PDRRMO.jpg           # Logo
└── dist/                     # Built output
```

---

## Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PIN_SECRET` | PIN for authorizing map edits and evacuation center deletion | (required) |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment mode | `development` |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | `http://localhost:5173` |

### Map Tiles

The app uses free tile layers. For production, consider:

- **ESRI Satellite** — Requires no API key (currently used)
- **Mapbox** — Sign up at [mapbox.com](https://www.mapbox.com/) for custom tiles
- **Google Maps** — Requires GCP project and API key

To switch tile providers, edit `src/components/Map.tsx`.

---

## Deployment

### Railway (Recommended)

1. Push to GitHub
2. Connect repository to [Railway](https://railway.app)
3. Railway auto-detects Node.js + SQLite
4. Set environment variables in Railway dashboard
5. Deploy

**Note:** Railway's starter tier includes ephemeral filesystem. SQLite works for development; for production with persistent storage, use Railway's persistent disk or a managed PostgreSQL instance.

### Render

1. Create `render.yaml` in root:

```yaml
services:
  - type: web
    name: command-center
    env: node
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - NODE_ENV: production
```

2. Connect to Render and deploy

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

```bash
docker build -t cnpdrrmo .
docker run -p 3001:3001 cnpdrrmo
```

### Static Frontend Only (GitHub Pages / Vercel / Netlify)

If hosting frontend separately from backend:

```bash
npm run build
```

The compiled frontend is in `dist/` (Vite output) alongside the bundled server. Serve `dist/public/` as static files.

**Vercel Example:**
```bash
npm i -g vercel
vercel --prod
```

---

## API Endpoints

### Hazards

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/hazards` | Fetch all hazards |
| POST | `/api/hazards` | Create a hazard |
| PUT | `/api/hazards/:id` | Update a hazard |
| DELETE | `/api/hazards/:id` | Delete a hazard |

### Evacuation Centers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/evacuation-centers` | Fetch all evacuation centers |
| POST | `/api/evacuation-centers` | Create a new evacuation center |
| PUT | `/api/evacuation-centers/:id` | Update an evacuation center |
| DELETE | `/api/evacuation-centers/:id` | Delete an evacuation center (requires PIN) |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/verify-pin` | Verify authorization PIN |

### Response Format

All responses return JSON. Successful responses return data directly (arrays or objects). Errors include an `error` field:

```json
{
  "error": "Error message"
}
```

POST/PUT operations return `{ success: true, id: "uuid" }`.

---

## Sync Mechanism

The app operates in three states per record:

| State | Description |
|-------|-------------|
| `synced` | Confirmed on server |
| `pending_add` | Created offline, awaiting sync |
| `pending_update` | Modified offline, awaiting sync |
| `pending_delete` | Marked for deletion, awaiting sync |

When the browser regains connectivity (`online` event), `HazardAPI.syncPending()` uploads all pending changes automatically.

---

## Hazard Types

| ID | Label | Color |
|----|-------|-------|
| `flood` | Flood | `#1d4ed8` |
| `storm_surge` | Storm Surge | `#0369a1` |
| `landslide` | Landslide | `#f59e0b` |
| `vehicular_accident` | Vehicular Accident | `#dc2626` |
| `earthquake` | Earthquake Fault | `#991b1b` |
| `tsunami` | Tsunami | `#0ea5e9` |

### Severity Levels

| Level | Description |
|-------|-------------|
| `Minor` | Minimal impact, local monitoring required |
| `Moderate` | Localized damage, coordination needed |
| `Severe` | Significant damage, provincial response activated |
| `Critical` | Mass casualty potential, full mobilization required |

## Evacuation Center Types

| ID | Label |
|----|-------|
| `school` | School |
| `barangay_hall` | Barangay Hall |
| `church` | Church |
| `covered_court` | Covered Court |
| `other` | Other |

---

## Troubleshooting

### `better-sqlite3` fails to build on deployment
```bash
npm rebuild better-sqlite3
```

### Port already in use
Set `PORT` environment variable to a different value:
```bash
PORT=3002 npm start
```

### Database locked errors
Ensure only one instance of the server is running. SQLite does not support concurrent writers.

### Map tiles not loading
Check network connectivity. Free tile servers may have rate limits in production.

---

## License

Proprietary — Provincial Disaster Risk Reduction & Management Office, Camarines Norte

Unauthorized reproduction or distribution is prohibited.
