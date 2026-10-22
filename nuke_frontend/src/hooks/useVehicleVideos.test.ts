import { describe, expect, it } from 'vitest';
import { momentFromPresentation, withScreenOutcomes } from './useVehicleVideos';

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

  it('retains descending timed asks and raw screen readings without promoting them to bid outcomes', () => {
    const m = momentFromPresentation({ ...presentation, structured_data: { ...presentation.structured_data,
      value: { ...presentation.structured_data.value,
        ask_ladder: [{ t: 6709, amount: 50000 }, { t: 6715, amount: 35000 }, { t: 7000, amount: 1 }],
        displayed_bid_readings: [{ t: 6710, amount: 30000 }, { t: 6711, amount: 25000 }],
        bid_ladder: [{ t: 6710, amount: 30000 }, { t: NaN, amount: 1 }, { t: 6711, amount: Infinity }],
        status_changes: [{ t: 6718, status: 'reserve_off' }, { t: 7000, status: 'sold' }],
      } } })!;
    expect(m.displayed_asks).toEqual([{ t: 6709, amount: 50000 }, { t: 6715, amount: 35000 }]);
    expect(m.raw_displayed_bids).toEqual([{ t: 6710, amount: 30000 }, { t: 6711, amount: 25000 }]);
    expect(m.displayed_bids).toEqual([{ t: 6710, amount: 30000 }]);
    expect(m.screen_status_changes).toEqual([{ t: 6718, status: 'reserve_off' }]);
    expect(m.winning_bid).toBeNull();
  });

  it('binds a retained Bid Goes On frame to the exact video/lot interval without inventing a sale', () => {
    const moment = momentFromPresentation(presentation)!;
    const frame = { vehicle_id: moment.vehicle_id, structured_data: {
      property: 'outcome_label_displayed', value: 'bid_goes_on', media: { video_id: 'c9fxArnD3IY', start_seconds: 6800 },
      event_context: { lot: 'S138' },
    } };
    const out = withScreenOutcomes(moment, [frame]);
    expect(out.screen_status_changes).toEqual([{ t: 6800, status: 'bid_goes_on' }]);
    expect(out.winning_bid).toBeNull();
    const withDisplay = { ...moment, screen_status_changes: [{ t: 6800, status: 'current_bid' }] };
    expect(withScreenOutcomes(withDisplay, [frame]).screen_status_changes).toEqual([
      { t: 6800, status: 'current_bid' }, { t: 6800, status: 'bid_goes_on' },
    ]);
    expect(withScreenOutcomes(moment, [{ ...frame, vehicle_id: 'other' }]).screen_status_changes).toEqual([]);
    expect(withScreenOutcomes(moment, [{ ...frame, structured_data: { ...frame.structured_data,
      media: { ...frame.structured_data.media, start_seconds: 7000 } } }]).screen_status_changes).toEqual([]);
    expect(withScreenOutcomes(moment, [frame, { ...frame, structured_data: { ...frame.structured_data, value: 'sold' } }]).screen_status_changes).toEqual([]);
  });
});
