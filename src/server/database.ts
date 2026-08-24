import { createClient, type Client, type InValue, type Row } from '@libsql/client';
import path from 'node:path';

export type Database = Client;

const bind = (values: unknown[]): InValue[] => values.map(value => value === undefined ? null : value as InValue);

export const execute = (db: Database, sql: string, ...args: unknown[]) => db.execute({ sql, args: bind(args) });

export async function all<T extends Record<string, unknown>>(db: Database, sql: string, ...args: unknown[]): Promise<T[]> {
  return (await execute(db, sql, ...args)).rows as unknown as T[];
}

export async function one<T extends Record<string, unknown>>(db: Database, sql: string, ...args: unknown[]): Promise<T | undefined> {
  return (await execute(db, sql, ...args)).rows[0] as unknown as T | undefined;
}

export async function createDatabase(url?: string): Promise<Database> {
  const configuredUrl = url || process.env.TURSO_DATABASE_URL?.trim() || undefined;
  const localPath = process.env.DB_PATH ?? path.resolve(process.cwd(), 'camarines_drrmc.db');
  const remote = configuredUrl && configuredUrl !== ':memory:' && !configuredUrl.startsWith('file:');
  if (remote && !process.env.TURSO_AUTH_TOKEN) throw new Error('TURSO_AUTH_TOKEN is required with TURSO_DATABASE_URL');
  const db = createClient({
    url: configuredUrl ?? `file:${localPath}`,
    authToken: remote ? process.env.TURSO_AUTH_TOKEN : undefined,
  });

  const schema = [
    `CREATE TABLE IF NOT EXISTS hazards (
      id TEXT PRIMARY KEY, type TEXT, severity TEXT, title TEXT, municipality TEXT,
      barangay TEXT, notes TEXT, geometry TEXT, dateAdded TEXT, version INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS evacuation_centers (
      id TEXT PRIMARY KEY, name TEXT, type TEXT, capacity INTEGER, municipality TEXT,
      barangay TEXT, coordinates TEXT, dateAdded TEXT, version INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS operations_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, method TEXT NOT NULL,
      path TEXT NOT NULL, created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS planning_scenarios (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, valid_from TEXT, valid_until TEXT,
      draft_version INTEGER NOT NULL, archived_at TEXT, updated_at TEXT NOT NULL, document TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS planning_revisions (
      id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, revision INTEGER NOT NULL,
      published_at TEXT NOT NULL, snapshot TEXT NOT NULL, UNIQUE(scenario_id, revision),
      FOREIGN KEY(scenario_id) REFERENCES planning_scenarios(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS planning_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, document TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
  ];
  await db.batch(schema.map(sql => ({ sql, args: [] })), 'write');

  const migrations = [
    ['hazards', 'title', 'TEXT'], ['hazards', 'municipality', 'TEXT'], ['hazards', 'barangay', 'TEXT'],
    ['hazards', 'version', 'INTEGER NOT NULL DEFAULT 1'], ['evacuation_centers', 'version', 'INTEGER NOT NULL DEFAULT 1'],
  ];
  for (const [table, column, type] of migrations) {
    const columns = (await db.execute(`PRAGMA table_info(${table})`)).rows as Row[];
    if (!columns.some(item => item.name === column)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  return db;
}
