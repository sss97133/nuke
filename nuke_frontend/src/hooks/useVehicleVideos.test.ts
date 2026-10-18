import { describe, expect, it } from 'vitest';
import { momentFromPresentation } from './useVehicleVideos';

const presentation = {
  id: '35aa2b0c-f680-43cb-a7bf-479f259b89c6',
  vehicle_id: '1acbaf04-e12d-467a-b4b3-f4080dbff6c9',
  structured_data: {
    media: { video_id: 'c9fxArnD3IY', start_seconds: 6708, end_seconds: 6994 },
    value: { lot: 'S138', sale_displayed: 'KISSIMMEE 2026', displayed_outcome: 'sold' },
    event_context: { auction_house: 'mecum', auction: 'KISSIMMEE 2026' },
  },
};

describe('momentFromPresentation', () => {
  it('maps a broadcast lot presentation to a seekable clip', () => {
    const m = momentFromPresentation(presentation)!;
    expect(m.broadcast_video_url).toBe('https://www.youtube.com/watch?v=c9fxArnD3IY');
    expect(m.broadcast_timestamp_start).toBe(6708);
    expect(m.broadcast_timestamp_end).toBe(6994);
    expect(m.lot_number).toBe('S138');
    expect(m.source).toBe('mecum');
    expect(m.auction_name).toBe('KISSIMMEE 2026');
    expect(m.vehicle_id).toBe(presentation.vehicle_id);
  });

  it('never turns a displayed bid into a hammer price', () => {
    const m = momentFromPresentation(presentation)!;
    expect(m.winning_bid).toBeNull();
    expect(m.estimate_low).toBeNull();
    expect(m.source_url).toBeNull();
  });

  it('counts displayed bid changes and ignores malformed ladder steps', () => {
    const withLadder = { ...presentation, structured_data: { ...presentation.structured_data,
      value: { ...presentation.structured_data.value,
        bid_ladder: [{ t: 6710, amount: 1000000 }, { t: 6720, amount: 1100000 }, { t: 'x', amount: 1 }, null, { t: 6730 }] } } };
    expect(momentFromPresentation(withLadder)!.displayed_bid_changes).toBe(2);
    expect(momentFromPresentation(presentation)!.displayed_bid_changes).toBeNull();
    const empty = { ...presentation, structured_data: { ...presentation.structured_data,
      value: { ...presentation.structured_data.value, bid_ladder: [] } } };
    expect(momentFromPresentation(empty)!.displayed_bid_changes).toBeNull();
  });

  it('drops rows without a video seek and an unknown displayed outcome', () => {
    expect(momentFromPresentation({ ...presentation, structured_data: { value: { lot: 'S1' } } })).toBeNull();
    const unknown = momentFromPresentation({ ...presentation,
      structured_data: { ...presentation.structured_data, value: { lot: 'S138', displayed_outcome: 'unknown' } } })!;
    expect(unknown.outcome).toBeNull();
  });
});
