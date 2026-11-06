// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ProfileActivity, { selectProfileActivity, elapsedActivity } from './ProfileActivity';
import type { AuctionPulse } from './types';

const now = Date.parse('2026-10-30T20:00:00Z');
const pulse = (extra = {}) => ({ platform: 'bat', listing_status: 'active', listing_url: 'https://bringatrailer.com/listing/synthetic',
  end_date: '2026-10-30T21:00:00Z', source_observed_at: '2026-10-30T19:59:00Z', ...extra }) as AuctionPulse;
it('uses occurrence dates, excludes other vehicles, superseded records, plans and future dates', () => {
  const result = selectProfileActivity('v', [
    { id: 'old', vehicle_id: 'v', event_type: 'work_session', event_date: '2024-01-01', created_at: '2026-10-30' } as any,
    { id: 'other', vehicle_id: 'other', event_type: 'work_session', event_date: '2026-10-30' },
    { id: 'future', event_type: 'work_session', event_date: '2027-01-01' },
    { id: 'plan', event_type: 'work_session', event_date: '2026-10-29', metadata: { status: 'planned' } },
    { id: 'withdrawn', event_type: 'sale', event_date: '2026-10-29', is_superseded: true },
    { id: 'processing', event_type: 'analysis_failed', event_date: '2026-10-30' },
  ], null, now);
  expect(result.latest?.id).toBe('old'); expect(result.live).toBe(false);
});
it('counts the timeline bar\'s contribution days as activity: photos filed, work and paper, never plain events', () => {
  const days = [
    { day: '2025-10-06', kind: 'photo', n: 4 }, { day: '2026-10-28', kind: 'photo', n: 391 }, { day: '2026-10-30', kind: 'event', n: 1 },
    { day: '2026-10-29', kind: 'document', n: 2 }, { day: '2026-10-27', kind: 'work', n: 0 }, { day: '2027-01-01', kind: 'photo', n: 1 }];
  const result = selectProfileActivity('v', [{ id: 'old', vehicle_id: 'v', event_type: 'work_session', event_date: '2025-10-07' }], null, now, days);
  expect(result.latest?.event_date).toBe('2026-10-29');
  expect(result.latest?.title).toBe('2 receipts on file');
  expect(selectProfileActivity('v', [], null, now, [{ day: '2026-10-28', kind: 'photo', n: 391 }]).latest?.title).toBe('391 photos filed');
  expect(selectProfileActivity('v', [], null, now, [{ day: '2026-10-30', kind: 'event', n: 3 }]).latest).toBeUndefined();
});
it('shows live only for an active auction with a fresh source-feed clock and future close', () => {
  expect(selectProfileActivity('v', [], pulse(), now).live).toBe(true);
  for (const invalid of [pulse({ end_date: '2026-10-30T19:00:00Z' }), pulse({ listing_status: 'sold' }),
    pulse({ source_observed_at: null, updated_at: '2026-10-30T19:59:00Z' }), pulse({ source_observed_at: '2026-10-30T19:00:00Z' }),
    pulse({ source_observed_at: '2026-10-30T21:00:00Z' }), pulse({ platform: 'craigslist' })]) {
    expect(selectProfileActivity('v', [], invalid, now).live).toBe(false);
  }
});
it('formats elapsed activity without a database refresh', () => {
  expect(elapsedActivity('2026-10-30T19:59:59Z', now)).toBe('just now');
  expect(elapsedActivity('2026-10-28T20:00:00Z', now)).toBe('2d ago');
  expect(elapsedActivity('2026-10-30', now)).toBe('today');
});
it('expires the displayed live indicator at the recorded close without fetching or scrolling', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(now);
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ProfileActivity vehicleId="v" events={[]} pulse={pulse({ end_date: '2026-10-30T20:00:02Z' })}
      open={false} onToggle={() => {}} onClose={() => {}} boundaryRef={{ current: host }} />));
    expect(host.querySelector('button')?.textContent).toContain('Live');
    await act(async () => vi.advanceTimersByTime(2001));
    expect(host.querySelector('button')?.textContent).not.toContain('Live');
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});
