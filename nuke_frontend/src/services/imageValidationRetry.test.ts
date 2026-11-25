import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ row: null as any, updates: [] as any[] }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      single: () => Promise.resolve({ data: db.row, error: null }),
      update: (values: any) => { db.updates.push({ table, values }); return { eq: () => Promise.resolve({ error: null }) }; },
    };
    return q;
  },
} }));
import { markImageValidationRetry } from './imageValidationRetry';

const mark = { status: 'failed' as const, error: 'not found', retry_at: '2026-11-25T14:00:00Z' };
beforeEach(() => { db.row = null; db.updates.length = 0; });

describe('markImageValidationRetry', () => {
  it('keeps keys written after insert and adds validation', async () => {
    db.row = { ai_scan_metadata: { source: 'bat', skipped: true, duplicate_of: 'img-0', classification: { view: 'front' } } };
    await markImageValidationRetry('img-1', { source: 'bat' }, mark);
    expect(db.updates).toEqual([{ table: 'vehicle_images', values: { ai_scan_metadata: {
      source: 'bat', skipped: true, duplicate_of: 'img-0', classification: { view: 'front' }, validation: mark } } }]);
  });
  it('falls back to the insert-time document when the row cannot be read', async () => {
    await markImageValidationRetry('img-1', { source: 'bat' }, mark);
    expect(db.updates[0].values).toEqual({ ai_scan_metadata: { source: 'bat', validation: mark } });
  });
});
