import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('service worker shell', () => {
  it('precaches the built JavaScript and CSS referenced by the app shell', async () => {
    let install: ((event: { waitUntil(promise: Promise<unknown>): void }) => void) | undefined;
    const addAll = vi.fn().mockResolvedValue(undefined);
    const cache = { addAll, put: vi.fn().mockResolvedValue(undefined) };
    const html = '<script src="/assets/app-123.js"></script><link href="/assets/app-123.css">';
    runInNewContext(readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8'), {
      self: {
        addEventListener: (type: string, listener: typeof install) => { if (type === 'install') install = listener; },
        clients: { claim: vi.fn() },
        skipWaiting: vi.fn(),
      },
      caches: { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue([]), delete: vi.fn() },
      fetch: vi.fn().mockResolvedValue({ clone: () => ({ text: async () => html }) }),
      URL,
      Response,
      Promise,
    });
    let completion = Promise.resolve();
    install?.({ waitUntil: promise => { completion = Promise.resolve(promise); } });
    await completion;

    expect(addAll).toHaveBeenCalledWith(['/PDRRMO.jpg', '/baranggays.geojson', '/assets/app-123.js', '/assets/app-123.css']);
  });
});
