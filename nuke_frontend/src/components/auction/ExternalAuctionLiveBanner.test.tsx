// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ temperature: null as any }));
vi.mock('../../pages/market/useLiveLotTemperature', () => ({ useLiveLotTemperature: () => ({ data: fixture.temperature }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../PrefetchLink', () => ({ PrefetchLink: ({ to, children }: any) => <a href={to}>{children}</a> }));
vi.mock('../../hooks/useExternalAuctionSync', () => ({ useExternalAuctionSync: () => ({ syncResult: null }) }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('../bidding/PlatformCredentialForm', () => ({ default: () => null }));
import ExternalAuctionLiveBanner, { liveMetricRank } from './ExternalAuctionLiveBanner';

let container: HTMLDivElement, root: Root;
const props = { externalListingId: null, platform: 'bat', listingUrl: 'https://bringatrailer.com/listing/synthetic-soft-close', currentBid: 118888, bidCount: 10, watcherCount: 2000, commentCount: 79, endDate: '2026-10-04T17:36:00Z', listingStatus: 'active', lastUpdatedAt: '2026-10-04T16:45:00Z' };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T17:38:00Z'));
  fixture.temperature = null;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

describe('visible soft-close state', () => {
  it('does not announce an active lot ended at zero and follows a later extension', async () => {
    await act(async () => root.render(<ExternalAuctionLiveBanner {...props} />));
    expect(container.textContent).toContain('RESULT PENDING');
    expect(container.textContent).toContain('Last observed bid');
    expect(container.textContent).not.toContain('ENDED');
    expect(container.textContent).not.toContain('BID NOW');
    await act(async () => root.render(<ExternalAuctionLiveBanner {...props} endDate="2026-10-04T17:40:00Z" currentBid={122000} lastUpdatedAt="2026-10-04T17:38:00Z" />));
    expect(container.textContent).toContain('$122,000');
    expect(container.textContent).toContain('BID NOW');
    expect(container.textContent).not.toContain('RESULT PENDING');
  });

  it('allows an explicit result to end the auction even before a stale future deadline', async () => {
    await act(async () => root.render(<ExternalAuctionLiveBanner {...props} listingStatus="sold" endDate="2026-10-04T17:40:00Z" />));
    expect(container.textContent).toContain('ENDED');
    expect(container.textContent).not.toContain('BID NOW');
  });
});

it('ranks tied live readings only with valid denominators and a sufficient clock-matched sample', () => {
  expect(liveMetricRank({ n:244, below:117, same:35 } as any, 8)).toBe(55);
  for (const count of [{n:3,below:1,same:0}, {n:8,below:9,same:0}, {n:8,below:-1,same:0}, {n:8,below:0,same:Infinity}, {n:8.5,below:2,same:0}]) expect(liveMetricRank(count as any,8)).toBeNull();
});
it('places a matching snapshot in its age-matched stack and withholds a rank when the bid state or close changes', async () => {
  fixture.temperature = { make:'Chevrolet', model:'Corvette', minComparables:8, vehiclesCap:300, readAt:Date.parse('2026-10-04T16:45:00Z'), endsAt:Date.parse('2026-10-04T18:00:00Z'), hoursLeft:1.25,
    price:{bid:118888,n:10,below:3,same:0,comps:[1,2,3]}, bids:{value:10,n:10,below:4,same:2,comps:[1,2,3]}, bidders:{value:5,n:10,below:5,same:0,comps:[1,2,3]} };
  await act(async () => root.render(<ExternalAuctionLiveBanner {...props} vehicleId="subject" endDate="2026-10-04T18:00:00Z" />));
  expect(container.textContent).toContain('P30'); expect(container.textContent).toContain('P50');
  expect(container.querySelector('img')!.alt).toBe('Bring a Trailer');
  expect(container.textContent!.match(/118,888/g)).toHaveLength(1);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Inspect watching stack"]')!.click());
  expect(container.querySelector('[role="dialog"]')!.textContent).toContain('no age-matched percentile');
  await act(async () => root.render(<ExternalAuctionLiveBanner {...props} currentBid={120000} bidCount={11} endDate="2026-10-04T18:01:00Z" />));
  expect(container.textContent).not.toMatch(/P30|P50/);
  expect(container.querySelector('[aria-label="Inspect bidders stack"]')).toBeNull();
});
