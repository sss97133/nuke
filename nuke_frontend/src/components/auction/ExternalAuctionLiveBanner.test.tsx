// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../hooks/useExternalAuctionSync', () => ({ useExternalAuctionSync: () => ({ syncResult: null }) }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('../bidding/PlatformCredentialForm', () => ({ default: () => null }));
import ExternalAuctionLiveBanner from './ExternalAuctionLiveBanner';

let container: HTMLDivElement, root: Root;
const props = { externalListingId: null, platform: 'bat', listingUrl: 'https://bringatrailer.com/listing/synthetic-soft-close', currentBid: 118888, bidCount: 10, watcherCount: 2000, commentCount: 79, endDate: '2026-10-04T17:36:00Z', listingStatus: 'active', lastUpdatedAt: '2026-10-04T16:45:00Z' };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T17:38:00Z'));
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
