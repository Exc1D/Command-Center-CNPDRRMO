// The server is bundled into _server.mjs at build time (see vercel.json), because Node's ESM
// loader can't resolve the extensionless imports in the TypeScript sources.
import { createConfiguredApp } from './_server.mjs';

// Built once per serverless instance, then reused across requests.
const app = createConfiguredApp();

export default async function handler(request, response) {
  (await app)(request, response);
}
