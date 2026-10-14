// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  user: null as null | { id: string },
  listing: null as any,
  error: null as any,
  selects: [] as string[],
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock('../components/auction/OwnerAuctionDashboard', () => ({ default: () => <div>owner dashboard</div> }));
vi.mock('../components/auction/AuctionBiddingInterface', () => ({ default: () => <div>bidding</div> }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from(table: string) {
    let cols = '';
    const query: any = {
      select: (c: string) => { cols = c; if (table === 'vehicle_listings') fixture.selects.push(c); return query; },
      eq: () => query,
      maybeSingle: () => {
        if (table === 'vehicles') return Promise.resolve({ data: { id: 'vehicle-1', year: 1971, make: 'Synthetic', model: 'Coupe' }, error: null });
        if (cols.includes('reserve_price_cents')) return Promise.resolve({ data: { reserve_price_cents: 1_500_000 }, error: null });
        return Promise.resolve({ data: fixture.listing, error: fixture.error });
      },
      single: () => { throw new Error('single() 406s on an unknown id'); },
    };
    return query;
  },
  rpc: vi.fn(),
} }));
import AuctionListing from './AuctionListing';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  fixture.user = null; fixture.listing = null; fixture.error = null; fixture.selects = [];
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});
async function open(id: string) {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/auction/${id}`]}><Routes><Route path="/auction/:listingId" element={<AuctionListing />} /></Routes></MemoryRouter>,
  ));
}
const listing = { id: 'listing-1', vehicle_id: 'vehicle-1', seller_id: 'seller-1', sale_type: 'auction', status: 'active',
  auction_start_time: null, auction_end_time: null, auction_duration_minutes: null, current_high_bid_cents: null, bid_count: 0 };

describe('AuctionListing: the lot or a not-found, never a raw error', () => {
  it('an unknown id reads as not found', async () => {
    await open('9d032caa-51f0-4ee6-b028-85ca8a6ad853');
    expect(container.textContent).toContain('No auction at this address.');
    expect(container.textContent).not.toMatch(/coerce|JSON object/i);
  });

  it('a failed read says so without the database message', async () => {
    fixture.error = { code: '57014', message: 'canceling statement due to statement timeout' };
    await open('listing-1');
    expect(container.textContent).toContain('This auction could not be read.');
    expect(container.textContent).not.toContain('statement timeout');
  });

  it("a visitor reads no seller columns and sees no reserve or invented bid", async () => {
    fixture.listing = listing;
    await open('listing-1');
    expect(fixture.selects).toHaveLength(1);
    expect(fixture.selects[0]).not.toMatch(/reserve_price_cents|list_price_cents|premium_budget_cents/);
    expect(container.textContent).toContain('1971 Synthetic Coupe');
    expect(container.textContent).toContain('No bids');
    expect(container.textContent).not.toContain('Reserve');
  });

  it('the seller reads their reserve', async () => {
    fixture.user = { id: 'seller-1' }; fixture.listing = listing;
    await open('listing-1');
    expect(fixture.selects).toHaveLength(2);
    expect(container.textContent).toContain('$15,000');
  });
});
