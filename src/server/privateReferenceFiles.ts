import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { types } from 'node:util';
import { municipalities } from '../lib/reference';
import type { Database } from './database';

const filenames = ['population-exposure.json', ...municipalities.map(name => `population/${name}.geojson`)];
const maxFileBytes = 32 * 1024 * 1024;
const digest = (contents: Buffer) => createHash('sha256').update(contents).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export async function uploadPrivateReferenceFiles(db: Database, directory = path.join(process.cwd(), '.private')) {
  const files: { name: string; content: Buffer; sha256: string }[] = [];
  for (const name of filenames) {
    let contents: Buffer;
    try { contents = await fs.readFile(path.join(directory, name)); }
    catch (error) { if (name !== filenames[0] && missing(error)) continue; throw error; }
    if (contents.length > maxFileBytes) throw new Error('Private reference file exceeds size limit');
    JSON.parse(contents.toString('utf8'));
    files.push({ name, content: gzipSync(contents), sha256: digest(contents) });
  }
  if (files.length < 2) throw new Error('At least one population municipality is required');
  await db.batch([
    { sql: 'DELETE FROM private_reference_files', args: [] },
    ...files.map(file => ({
      sql: 'INSERT INTO private_reference_files (name, content, sha256) VALUES (?, ?, ?)',
      args: [file.name, file.content, file.sha256],
    })),
  ], 'write');
  return files.length;
}

export async function restorePrivateReferenceFiles(db: Database, directory = path.join(process.cwd(), '.private')) {
  const names = (await db.execute('SELECT name FROM private_reference_files')).rows.map(row => row.name);
  if (!names.length) return 0;
  if (names.length < 2 || !names.includes(filenames[0]) || names.some(name => typeof name !== 'string' || !filenames.includes(name))) {
    throw new Error('Invalid private reference filenames');
  }
  const files: { name: string; content: Buffer }[] = [];
  // ponytail: finish uploads before restarting; use a read transaction if live dataset replacement is added.
  // Validate every file before replacing any local data; request one compressed file at a time.
  for (const name of names as string[]) {
    const row = (await db.execute({ sql: 'SELECT content, sha256 FROM private_reference_files WHERE name = ?', args: [name] })).rows[0];
    if (!row || !types.isArrayBuffer(row.content) || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) {
      throw new Error('Invalid private reference content');
    }
    const content = gunzipSync(Buffer.from(row.content), { maxOutputLength: maxFileBytes });
    if (digest(content) !== row.sha256) throw new Error('Private reference checksum mismatch');
    JSON.parse(content.toString('utf8'));
    files.push({ name, content });
  }
  for (const folder of [directory, path.join(directory, 'population')]) {
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    if (!(await fs.lstat(folder)).isDirectory()) throw new Error('Private reference directory must not be a symbolic link');
  }
  for (const file of files) {
    const handle = await fs.open(path.join(directory, file.name), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    try { await handle.chmod(0o600); await handle.writeFile(file.content); }
    finally { await handle.close(); }
  }
  for (const name of filenames.filter(name => !names.includes(name))) {
    await fs.unlink(path.join(directory, name)).catch(error => { if (!missing(error)) throw error; });
  }
  return files.length;
}
