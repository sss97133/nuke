import { describe, it, expect } from 'vitest';
import { pickWriteUps } from './writeUps';

describe('pickWriteUps', () => {
  it('takes the latest raw write-up per vehicle, falls back to the summary, skips empties', () => {
    const raw = [
      { vehicle_id: 'a', field_value: 'old write-up', extracted_at: '2026-03-30T05:41:15Z', source_url: null },
      { vehicle_id: 'a', field_value: 'new write-up', extracted_at: '2026-07-02T21:02:09Z', source_url: null },
      { vehicle_id: 'b', field_value: '   ', extracted_at: '2026-07-02T21:02:09Z', source_url: null },
      { vehicle_id: null, field_value: 'orphan', extracted_at: '2026-07-02T21:02:09Z', source_url: null },
    ];
    const summaries = new Map<string, string | null>([['b', 'b summary'], ['c', 'c summary'], ['d', null]]);
    const out = pickWriteUps(['a', 'b', 'c', 'd'], raw, summaries);
    expect(out.get('a')).toEqual({ text: 'new write-up', source: 'raw_listing_description', extractedAt: '2026-07-02T21:02:09Z' });
    expect(out.get('b')).toMatchObject({ text: 'b summary', source: 'vehicles.description' });
    expect(out.get('c')).toMatchObject({ text: 'c summary', source: 'vehicles.description' });
    expect(out.has('d')).toBe(false);
  });
});
