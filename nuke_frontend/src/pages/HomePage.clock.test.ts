import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { ledgerViewsClock } from './HomePage';

describe('the ledger map legend clock', () => {
  it('names the refresh time when the ledger recorded one', () => {
    expect(ledgerViewsClock('2026-10-14T09:10:41.123+00:00')).toBe(' · as of 2026-10-14 09:10 UTC');
  });
  it('keeps the old wording without a recorded refresh', () => {
    expect(ledgerViewsClock(null)).toBe(' · as of the last refresh of the ledger’s views');
    expect(ledgerViewsClock('not a time')).toBe(' · as of the last refresh of the ledger’s views');
  });
});
