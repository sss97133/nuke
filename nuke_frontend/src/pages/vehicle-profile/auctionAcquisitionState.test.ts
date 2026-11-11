import { describe, expect, it } from 'vitest';
import { auctionAcquisitionState, type AcquisitionEpisode } from './auctionAcquisitionState';
const event: AcquisitionEpisode = { id: 'episode', event_type: 'auction', event_status: 'upcoming', source_platform: 'mccormicks',
  source_url: 'https://www.classic-carauction.com/auction-cars?auctionid=15411', source_organization_id: 'source-org',
  metadata: { sale_starts_on: '2026-11-20', sale_ends_on: '2026-11-22', auction_session_days: ['2026-11-20'], lot_number: '1',
    auction_name: 'McCormick’s Auction 81', source_observed_at: '2026-11-11T12:14:04.972Z' } };
describe('source-backed auction acquisition state', () => {
  it('recognizes the upcoming source episode and preserves native lot identity', () => {
    const state = auctionAcquisitionState(event, new Date(2026, 10, 11, 12).getTime())!;
    expect(state.stage).toBe('Upcoming auction · offered for sale');
    expect(state.timer).toBe('in 9 days'); expect(state.house).toBe('McCormick’s'); expect(state.lot).toBe('1');
    expect(state.sourceUrl).toContain('auctionid=15411');
  });
  it('awaits evidence after the lot day, without inferring sold or reserve failure', () => {
    expect(auctionAcquisitionState(event, new Date(2026, 10, 21, 12).getTime())?.stage).toBe('Awaiting auction result');
    expect(auctionAcquisitionState(event, new Date(2026, 10, 20, 12).getTime())?.timer).toBe('running today');
  });
  it('uses an explicit source outcome and keeps the record after the auction', () => {
    expect(auctionAcquisitionState({ ...event, event_status: 'sold' })?.stage).toBe('Sold');
    expect(auctionAcquisitionState({ ...event, event_status: 'no_sale' })?.stage).toBe('Not sold');
    expect(auctionAcquisitionState({ ...event, event_status: 'cancelled' })?.stage).toBe('Withdrawn');
  });
  it('refuses unrelated source URLs, duplicates and non-auction appearances', () => {
    for (const patch of [{ source_url: 'https://classic-carauction.com.evil.test/auction-cars' }, { duplicate_of_event_id: 'other' }, { event_type: 'classified' }]) {
      expect(auctionAcquisitionState({ ...event, ...patch })).toBeNull();
    }
  });
  it('keeps unknown schedules unknown and ignores invalid run days', () => {
    expect(auctionAcquisitionState({ ...event, metadata: {} })?.timer).toBeNull();
    expect(auctionAcquisitionState({ ...event, metadata: { ...event.metadata, auction_session_days: ['2026-02-30', '2025-11-20'] } })?.runOn).toEqual([]);
    expect(auctionAcquisitionState({ ...event, metadata: {}, event_status: 'sold' })).toBeNull();
  });
});
