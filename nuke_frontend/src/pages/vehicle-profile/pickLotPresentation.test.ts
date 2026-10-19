import { describe, expect, it } from 'vitest';
import { pickLotPresentations } from './ProfileHeader';

const vehicle = '1acbaf04-e12d-467a-b4b3-f4080dbff6c9';
const episodeKeys = new Set(['auction_events:synthetic-event']);
const row = (lot: string, start: number, extra: Record<string, unknown> = {}) => ({
  vehicle_id: vehicle,
  structured_data: {
    media: { video_id: 'c9fxArnD3IY', start_seconds: start, end_seconds: start + 286 },
    value: { lot, displayed_outcome: 'unknown' },
    event_context: { matched_event: { table: 'auction_events', id: 'synthetic-event' }, resolution_status: 'scoped_event_match' },
    ...extra,
  },
});
const pick = (rows: any[] | null, lot: string | null = 'S138') => pickLotPresentations(rows, vehicle, lot, episodeKeys);

describe('pickLotPresentations', () => {
  it('retains the presentation explicitly bound to the cited episode and lot', () => {
    expect(pick([row('S138', 6708)], 's138')).toEqual([{
      videoUrl: 'https://www.youtube.com/watch?v=c9fxArnD3IY', startSeconds: 6708, endSeconds: 6994,
    }]);
  });

  it('refuses another lot, another vehicle, an unbound episode or a missing cited lot', () => {
    expect(pick([row('S139', 6708)])).toEqual([]);
    expect(pick([{ ...row('S138', 6708), vehicle_id: 'other' }])).toEqual([]);
    expect(pick([row('S138', 6708)], null)).toEqual([]);
    expect(pick(null)).toEqual([]);
    expect(pick([row('S138', 6708, { event_context: null })])).toEqual([]);
    expect(pickLotPresentations([row('S138', 6708)], vehicle, 'S138', new Set())).toEqual([]);
  });

  it('refuses a malformed video locator or a nonfinite or negative seek', () => {
    expect(pick([row('S138', 10, { media: { video_id: 'bad id', start_seconds: 10 } })])).toEqual([]);
    for (const start of [-1, NaN, Infinity]) expect(pick([row('S138', start)])).toEqual([]);
  });

  it('keeps a zero start and an unknown end without inventing a span', () => {
    expect(pick([row('S138', 0, { media: { video_id: 'c9fxArnD3IY', start_seconds: 0 } })])[0]).toEqual({
      videoUrl: 'https://www.youtube.com/watch?v=c9fxArnD3IY', startSeconds: 0, endSeconds: null,
    });
  });

  it('retains all eligible locators for the existing consumer consensus instead of preferring SOLD', () => {
    const first = row('916', 100);
    const sold = row('916', 900, { value: { lot: '916', displayed_outcome: 'sold' } });
    expect(pick([first, sold], '916').map(r => r.startSeconds)).toEqual([100, 900]);
    expect(pick([sold, first], '916').map(r => r.startSeconds)).toEqual([900, 100]);
  });
});
