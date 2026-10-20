import { describe, expect, it, vi, beforeEach } from 'vitest';

// A real Postgrest builder exposes then() and no catch(); calling .catch on it threw a TypeError,
// so the sidebar counts never loaded.
const read = vi.hoisted(() => ({ outcome: { data: null as unknown, error: null as unknown }, reject: false }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          (read.reject ? Promise.reject(new Error('network')) : Promise.resolve(read.outcome)).then(resolve, reject),
      })),
    })),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

import { readInboxCounts } from './TeamInbox';

describe('readInboxCounts', () => {
  beforeEach(() => { read.reject = false; read.outcome = { data: null, error: null }; });

  it('reads per-mailbox totals through a then-only builder', async () => {
    read.outcome = { data: [{ to_address: 'support@example.invalid', total: 4, unread: 1 }], error: null };
    await expect(readInboxCounts()).resolves.toEqual({ 'support@example.invalid': { total: 4, unread: 1 } });
  });

  it('returns null when the read fails instead of throwing', async () => {
    read.reject = true;
    await expect(readInboxCounts()).resolves.toBeNull();
  });
});
