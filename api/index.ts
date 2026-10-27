import type { Request, Response } from 'express';
import { createConfiguredApp } from '../server';

// Built once per serverless instance, then reused across requests.
const app = createConfiguredApp();

export default async function handler(request: Request, response: Response) {
  (await app)(request, response);
}
