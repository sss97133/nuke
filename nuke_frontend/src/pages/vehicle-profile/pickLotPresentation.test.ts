import { describe, expect, it } from 'vitest';
import { pickLotPresentation } from './ProfileHeader';

const vehicle = '1acbaf04-e12d-467a-b4b3-f4080dbff6c9';
const row = (lot: string, start: number, extra: Record<string, unknown> = {}) => ({
  vehicle_id: vehicle,
  structured_data: {
    media: { video_id: 'c9fxArnD3IY', start_seconds: start, end_seconds: start + 286 },
    value: { lot, displayed_outcome: 'unknown' },
    ...extra,
  },
});

describe('pickLotPresentation', () => {
  it('attaches the presentation of the cited lot', () => {
    expect(pickLotPresentation([row('S138', 6708)], vehicle, 's138')).toEqual({
      videoUrl: 'https://www.youtube.com/watch?v=c9fxArnD3IY', startSeconds: 6708, endSeconds: 6994,
    });
  });

  it('refuses a presentation of another lot, another vehicle or without a cited lot', () => {
    expect(pickLotPresentation([row('S139', 6708)], vehicle, 'S138')).toBeNull();
    expect(pickLotPresentation([{ ...row('S138', 6708), vehicle_id: 'other' }], vehicle, 'S138')).toBeNull();
    expect(pickLotPresentation([row('S138', 6708)], vehicle, null)).toBeNull();
    expect(pickLotPresentation(null, vehicle, 'S138')).toBeNull();
  });

  it('refuses a malformed video locator or seek', () => {
    expect(pickLotPresentation([{ vehicle_id: vehicle, structured_data: {
      media: { video_id: 'bad id', start_seconds: 10 }, value: { lot: 'S138' } } }], vehicle, 'S138')).toBeNull();
    expect(pickLotPresentation([{ vehicle_id: vehicle, structured_data: {
      media: { video_id: 'c9fxArnD3IY', start_seconds: -1 }, value: { lot: 'S138' } } }], vehicle, 'S138')).toBeNull();
  });

  it('keeps an unknown end unknown instead of inventing a span', () => {
    const r = { vehicle_id: vehicle, structured_data: { media: { video_id: 'c9fxArnD3IY', start_seconds: 6708 }, value: { lot: 'S138' } } };
    expect(pickLotPresentation([r], vehicle, 'S138')?.endSeconds).toBeNull();
  });

  it('prefers the crossing the screen showed as sold when a lot crossed twice', () => {
    const first = row('916', 100);
    const sold = { ...row('916', 900), structured_data: { ...row('916', 900).structured_data, value: { lot: '916', displayed_outcome: 'sold' } } };
    expect(pickLotPresentation([first, sold], vehicle, '916')?.startSeconds).toBe(900);
  });
});
