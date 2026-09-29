import 'dotenv/config';
import fs from 'node:fs/promises';
import { createDatabase } from '../src/server/database';
import { uploadPrivateReferenceFiles } from '../src/server/privateReferenceFiles';

async function main() {
  // The optional configuration file stays outside Git and public build output.
  if (process.argv[2]) {
    const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
    process.env.TURSO_DATABASE_URL = config.TURSO_DATABASE_URL;
    process.env.TURSO_AUTH_TOKEN = config.TURSO_AUTH_TOKEN;
  }
  if (!/^(libsql|https):\/\//.test(process.env.TURSO_DATABASE_URL ?? '') || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error('Hosted database configuration required');
  }
  const db = await createDatabase();
  try {
    const count = await uploadPrivateReferenceFiles(db);
    console.log(`Uploaded ${count} private reference files. Restart the service to load them.`);
  } finally { db.close(); }
}

main().catch(() => {
  console.error('Private reference upload failed. Check the hosted database configuration and prepared dataset files.');
  process.exitCode = 1;
});
