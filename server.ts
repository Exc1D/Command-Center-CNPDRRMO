import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Database from "better-sqlite3";

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

// Set up SQLite Database
const dbPath = path.resolve(process.cwd(), 'camarines_drrmc.db');
const db = new Database(dbPath);

// Initialize DB Table
db.prepare(`
  CREATE TABLE IF NOT EXISTS hazards (
    id TEXT PRIMARY KEY,
    type TEXT,
    severity TEXT,
    notes TEXT,
    geometry TEXT,
    dateAdded TEXT
  )
`).run();

// API Routes
app.get("/api/hazards", (req, res) => {
  try {
    const hazards = db.prepare('SELECT * FROM hazards').all();
    res.json(hazards);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch hazards' });
  }
});

app.post("/api/hazards", (req, res) => {
  try {
    const { id, type, severity, notes, geometry, dateAdded } = req.body;
    const stmt = db.prepare(`
      INSERT INTO hazards (id, type, severity, notes, geometry, dateAdded)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, type, severity, notes, JSON.stringify(geometry), dateAdded);
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save hazard' });
  }
});

app.put("/api/hazards/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { type, severity, notes, geometry, dateAdded } = req.body;
    
    // Check if hazard exists
    const existing = db.prepare('SELECT * FROM hazards WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Hazard not found' });
    }

    const stmt = db.prepare(`
      UPDATE hazards 
      SET type = COALESCE(?, type), 
          severity = COALESCE(?, severity), 
          notes = COALESCE(?, notes), 
          geometry = COALESCE(?, geometry),
          dateAdded = COALESCE(?, dateAdded)
      WHERE id = ?
    `);
    stmt.run(
      type, 
      severity, 
      notes, 
      geometry ? JSON.stringify(geometry) : undefined,
      dateAdded,
      id
    );
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update hazard' });
  }
});

app.delete("/api/hazards/:id", (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM hazards WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete hazard' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
