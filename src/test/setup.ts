import { beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom';

beforeEach(() => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine') || {};
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    writable: true,
    configurable: true,
    ...descriptor,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
