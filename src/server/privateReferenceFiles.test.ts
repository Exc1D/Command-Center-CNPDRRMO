import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createClient, type Client } from '@libsql/client';
import { restorePrivateReferenceFiles, uploadPrivateReferenceFiles } from './privateReferenceFiles';

let db: Client;
let root: string;
let source: string;
let destination: string;
const aggregate = '{"version":1,"buckets":[]}\n';
const population = '{"type":"FeatureCollection","features":[]}\n';

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await db.execute('CREATE TABLE private_reference_files (name TEXT PRIMARY KEY, content BLOB NOT NULL, sha256 TEXT NOT NULL)');
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'private-reference-test-'));
  source = path.join(root, 'source');
  destination = path.join(root, 'destination');
  await fs.mkdir(path.join(source, 'population'), { recursive: true });
  await fs.writeFile(path.join(source, 'population-exposure.json'), aggregate);
  await fs.writeFile(path.join(source, 'population/Daet.geojson'), population);
});

afterEach(async () => { db.close(); await fs.rm(root, { recursive: true, force: true }); });

it('roundtrips exact private files, restricts permissions, and removes stale source coverage on reupload', async () => {
  await fs.writeFile(path.join(source, 'population/Labo.geojson'), population);
  expect(await uploadPrivateReferenceFiles(db, source)).toBe(3);
  expect(await restorePrivateReferenceFiles(db, destination)).toBe(3);
  expect(await fs.readFile(path.join(destination, 'population-exposure.json'), 'utf8')).toBe(aggregate);
  expect(await fs.readFile(path.join(destination, 'population/Daet.geojson'), 'utf8')).toBe(population);
  expect((await fs.stat(path.join(destination, 'population/Daet.geojson'))).mode & 0o777).toBe(0o600);
  await fs.unlink(path.join(source, 'population/Labo.geojson'));
  expect(await uploadPrivateReferenceFiles(db, source)).toBe(2);
  expect(await restorePrivateReferenceFiles(db, destination)).toBe(2);
  expect((await db.execute('SELECT count(*) AS total FROM private_reference_files')).rows[0].total).toBe(2);
  await expect(fs.stat(path.join(destination, 'population/Labo.geojson'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('preserves local files for an empty database and preserves the database if a required upload source is missing', async () => {
  expect(await restorePrivateReferenceFiles(db, source)).toBe(0);
  expect(await fs.readFile(path.join(source, 'population/Daet.geojson'), 'utf8')).toBe(population);
  await uploadPrivateReferenceFiles(db, source);
  await fs.unlink(path.join(source, 'population-exposure.json'));
  await expect(uploadPrivateReferenceFiles(db, source)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await db.execute('SELECT count(*) AS total FROM private_reference_files')).rows[0].total).toBe(2);
});

it('rejects traversal, corrupted gzip, and bad hashes before writing any restored files', async () => {
  await uploadPrivateReferenceFiles(db, source);
  await db.execute("UPDATE private_reference_files SET name = '../outside.json' WHERE name = 'population/Daet.geojson'");
  await expect(restorePrivateReferenceFiles(db, destination)).rejects.toThrow(/filenames/);
  await expect(fs.stat(path.join(root, 'outside.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await uploadPrivateReferenceFiles(db, source);
  await db.execute({ sql: 'UPDATE private_reference_files SET content = ? WHERE name = ?', args: [Buffer.from('broken gzip'), 'population/Daet.geojson'] });
  await expect(restorePrivateReferenceFiles(db, destination)).rejects.toThrow();
  await uploadPrivateReferenceFiles(db, source);
  await db.execute({ sql: 'UPDATE private_reference_files SET sha256 = ? WHERE name = ?', args: ['0'.repeat(64), 'population/Daet.geojson'] });
  await expect(restorePrivateReferenceFiles(db, destination)).rejects.toThrow(/checksum/);
  await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('bounds decompression and does not follow destination symlinks', async () => {
  await uploadPrivateReferenceFiles(db, source);
  const oversized = Buffer.alloc(32 * 1024 * 1024 + 1, 32);
  await db.execute({ sql: 'UPDATE private_reference_files SET content = ?, sha256 = ? WHERE name = ?', args: [gzipSync(oversized), createHash('sha256').update(oversized).digest('hex'), 'population/Daet.geojson'] });
  await expect(restorePrivateReferenceFiles(db, destination)).rejects.toThrow();
  await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  await uploadPrivateReferenceFiles(db, source);
  await fs.mkdir(destination);
  await fs.symlink(source, path.join(destination, 'population'));
  await expect(restorePrivateReferenceFiles(db, destination)).rejects.toThrow(/symbolic link/);
  expect(await fs.readFile(path.join(source, 'population-exposure.json'), 'utf8')).toBe(aggregate);
});
