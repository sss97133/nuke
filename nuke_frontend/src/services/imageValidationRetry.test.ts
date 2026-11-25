import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ row: null as any, readError: null as any, updates: [] as any[] }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      single: () => Promise.resolve({ data: db.readError ? null : db.row, error: db.readError }),
      update: (values: any) => {
        const call: any = { table, values, filters: {} as Record<string, unknown> };
        db.updates.push(call);
        const u: any = {
          eq: (k: string, v: unknown) => { call.filters[k] = v; return u; },
          is: (k: string, v: unknown) => { call.filters[k] = v; return u; },
          then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej),
        };
        return u;
      },
    };
    return q;
  },
} }));
import { markImageValidationRetry } from './imageValidationRetry';

const mark = { status: 'failed' as const, error: 'not found', retry_at: '2026-11-25T14:00:00Z' };
beforeEach(() => { db.row = null; db.readError = null; db.updates.length = 0; });

describe('markImageValidationRetry', () => {
  it('keeps keys written after insert, adds validation, and swaps only on the read updated_at', async () => {
    db.row = { updated_at: '2026-11-25T13:00:00Z',
      ai_scan_metadata: { source: 'bat', skipped: true, duplicate_of: 'img-0', classification: { view: 'front' } } };
    await markImageValidationRetry('img-1', { source: 'bat' }, mark);
    expect(db.updates).toEqual([{ table: 'vehicle_images', filters: { id: 'img-1', updated_at: '2026-11-25T13:00:00Z' },
      values: { ai_scan_metadata: { source: 'bat', skipped: true, duplicate_of: 'img-0', classification: { view: 'front' }, validation: mark } } }]);
  });
  it('writes nothing when the row cannot be read (e.g. 42501 after a column revoke)', async () => {
    db.readError = { code: '42501', message: 'permission denied for column ai_scan_metadata' };
    const error = await markImageValidationRetry('img-1', { source: 'bat' }, mark);
    expect(error).toEqual(db.readError);
    expect(db.updates).toHaveLength(0);
  });
  it('falls back to the insert-time document when the row holds none', async () => {
    db.row = { updated_at: null, ai_scan_metadata: null };
    await markImageValidationRetry('img-1', { source: 'bat' }, mark);
    expect(db.updates[0].values).toEqual({ ai_scan_metadata: { source: 'bat', validation: mark } });
    expect(db.updates[0].filters).toEqual({ id: 'img-1', updated_at: null });
  });
});
