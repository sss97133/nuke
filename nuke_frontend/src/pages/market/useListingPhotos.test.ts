import { describe, expect, it, vi } from 'vitest';

const calls: [string, unknown[]][] = [];
const chain: Record<string, (...args: unknown[]) => unknown> = {};
for (const name of ['select', 'in', 'not', 'order', 'limit', 'abortSignal']) chain[name] = (...args: unknown[]) => { calls.push([name, args]); return chain; };
(chain as { then?: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [{ vehicle_id: 'v1', image_url: 'https://images.craigslist.org/a_1200x900.jpg' }], error: null });
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => { calls.push(['from', [table]]); return chain; } } }));
import { readListingPhotos } from './useListingPhotos';

describe('a listing\'s photos', () => {
  it('are read once per photo: a row flagged as another\'s duplicate is left out, an unflagged row stays', async () => {
    const rows = await readListingPhotos(['v1']);
    expect(rows).toHaveLength(1);
    expect(calls).toContainEqual(['from', ['vehicle_images']]);
    expect(calls).toContainEqual(['not', ['is_duplicate', 'is', true]]);
  });
});
