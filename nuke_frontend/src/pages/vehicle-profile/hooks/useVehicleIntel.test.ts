import { expect, it } from 'vitest';
import { qualifyApparitionClocks } from './useVehicleIntel';

const acceptance = { source_platform: 'bat', source_url: null, event_type: 'auction',
  started_at: '2026-09-01T00:00:00Z', ended_at: null, sold_at: null, event_kind: 'bat_acceptance' };
const appearance = { platform: 'bat', url: null, event_type: 'auction', event_date: '2026-09-01T00:00:00+00:00', price: null };
it('separates submission acceptance from an auction date without changing other lots', () => {
  const past = { ...appearance, url: 'https://example.test/lot', event_date: '2025-01-01T00:00:00Z' };
  expect(qualifyApparitionClocks([appearance, past], [acceptance])).toEqual([
    { ...appearance, event_date: null, schedule_status: 'accepted_awaiting_schedule' }, past,
  ]);
});
it('does not replace scheduled, sold, ambiguous or different events with an unscheduled submission', () => {
  for (const events of [[{ ...acceptance, ended_at: '2026-09-08T00:00:00Z' }],
    [{ ...acceptance, event_kind: null }], [acceptance, acceptance],
    [{ ...acceptance, source_url: 'https://example.test/other' }]]) {
    expect(qualifyApparitionClocks([appearance], events)).toEqual([appearance]);
  }
});
