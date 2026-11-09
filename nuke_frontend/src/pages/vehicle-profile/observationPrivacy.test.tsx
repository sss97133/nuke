// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicObservationData, publicObservationArtifact } from './observationPrivacy';
import ObservationPage from './ObservationPage';
import DayPage from './DayPage';

// This contract inspects the resolved public reader, not the auth-loading gate.
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

const { example, related } = vi.hoisted(() => ({
  example: {
    id: 'observation-example', vehicle_id: 'vehicle-example', kind: 'condition',
    observed_at: '2026-04-03T12:00:00Z', ingested_at: '2026-04-04T12:00:00Z',
    content_text: 'Work discussed with buyer Morgan Example.', confidence_score: 0.9,
    source_url: 'https://example.invalid/Morgan-Example/document.png',
    structured_data: {
      total_paid: 317, balance_remaining: 33, completion_pct: 75,
      build_phase: 'pre-delivery', next_milestone: 'paint_completion',
      first_name: 'Morgan', last_name: 'Example', merchant: 'Example workshop',
      summary: 'Morgan Example approved the work.',
      participants: [{ profile: { fullName: 'Morgan Example' } }],
      text_regions: [{ text: 'Morgan Example', bbox: [1, 2, 3, 4] }],
      name_publication_consent: true, // Caller input is not trusted consent.
    },
    is_superseded: false, superseded_by: null, property_id: null,
    observation_sources: null,
  },
  related: { id: 'related-example', vehicle_id: 'vehicle-example', kind: 'condition', observed_at: '2026-04-02T12:00:00Z', content_text: 'Morgan Example paid.', structured_data: {} },
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from(table: string) {
      let dayRead = false;
      const query: any = {
        select: () => query, eq: () => query, neq: () => query,
        filter: () => query, gte: () => { dayRead = true; return query; }, lte: () => query, lt: () => query, order: () => query, abortSignal: () => query,
        maybeSingle: () => Promise.resolve({ data: table === 'vehicles' ? { id: 'vehicle-example', year: 1983, make: 'GMC', model: 'K2500' } : example }),
        limit: () => query,
        then: (resolve: any) => Promise.resolve({ data: dayRead ? [example] : [example, related] }).then(resolve),
      };
      return query;
    },
    rpc: () => ({ abortSignal: () => Promise.resolve({ data: null, error: null }) }),
  },
}));
vi.mock('react-router-dom', async (original) => ({
  ...await original<typeof import('react-router-dom')>(),
  useParams: () => ({ vehicleId: 'vehicle-example', obsId: 'observation-example', date: '2026-04-03' }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
async function mount(page: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MemoryRouter>{page}</MemoryRouter>); });
}
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  document.body.replaceChildren();
});

describe('observation privacy boundary', () => {
  it('retains typed measurements and controlled build states while withholding nested identity/prose', () => {
    expect(publicObservationData(example.structured_data)).toEqual({
      total_paid: 317, balance_remaining: 33, completion_pct: 75,
      build_phase: 'pre-delivery', next_milestone: 'paint_completion',
    });
  });

  it('withholds unknown fields and strings disguised as measurements or controlled states', () => {
    expect(publicObservationData({ total_paid: 'Morgan Example', build_phase: 'Morgan Example',
      value: 'Morgan Example', Morgan_Example: 7, currency: 'Morgan Example',
      confidence_score: NaN, quantity: Infinity, constructor: 'Morgan Example',
    })).toEqual({});
    expect(publicObservationData(null)).toEqual({});
    expect(publicObservationData({ value: false, quantity: 0 })).toEqual({ value: false, quantity: 0 });
    expect(publicObservationArtifact()).toBeNull();
  });

  it('shows qualified auction quantities without exposing nested source prose or implying a sale for a high bid', () => {
    const claim = { status: 'no_sale', amount: 4600, currency: null, fee_basis: 'unknown',
      literal: 'Morgan Example bid $4,600', participants: ['Morgan Example'] };
    expect(publicObservationData({ kind_detail: 'auction_listing', result_claim: claim })).toEqual({
      source_reported_outcome: 'no_sale', source_reported_amount_type: 'high_bid',
      source_reported_amount: 4600, source_reported_currency: 'not_stated', source_reported_fee_basis: 'unknown',
    });
    expect(publicObservationData({ kind_detail: 'auction_listing', result_claim: {
      ...claim, status: 'sold', amount: 16324, currency: 'USD', fee_basis: 'Morgan Example',
    } })).toEqual({
      source_reported_outcome: 'sold', source_reported_amount_type: 'sale_price',
      source_reported_amount: 16324, source_reported_currency: 'USD', source_reported_fee_basis: 'unknown',
    });
  });

  it('keeps the auction projection closed to arbitrary strings, invalid quantities and consent flags', () => {
    const base = { status: 'sold', amount: 16324, currency: 'Morgan Example', literal: 'Morgan Example' };
    const project = (result_claim: unknown, kind_detail = 'auction_listing') =>
      publicObservationData({ kind_detail, result_claim, name_publication_consent: true });
    expect(project(base).source_reported_currency).toBe('not_stated');
    expect(JSON.stringify(project(base))).not.toContain('Morgan');
    for (const amount of ['Morgan Example', NaN, Infinity, -1, null]) expect(project({ ...base, amount })).toEqual({});
    expect(project({ ...base, status: 'Morgan Example' })).toEqual({});
    expect(project(base, 'payment')).toEqual({});
    expect(project([base])).toEqual({});
    expect(project(null)).toEqual({});
  });

  it('does not render raw names in the observation heading, related rows, JSON, OCR or artifact URLs', async () => {
    await mount(<ObservationPage />);
    expect(host.querySelector('h1')?.textContent).toBe('Condition observation');
    expect(host.textContent).toContain('317');
    expect(host.textContent).toContain('pre-delivery');
    expect(host.textContent).toContain('privacy review');
    expect(host.innerHTML).not.toContain('Morgan');
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('a[href*="example.invalid"]')).toBeNull();
    expect(host.querySelector('a[href*="related-example"]')).not.toBeNull();
  });

  it('renders source-reported auction quantities through the public observation reader while withholding prose', async () => {
    const original = example.structured_data;
    Object.assign(example, { structured_data: { kind_detail: 'auction_listing', result_claim: {
      status: 'no_sale', amount: 4600, currency: null, fee_basis: 'unknown', literal: 'Morgan Example bid $4,600',
    } } });
    try {
      await mount(<ObservationPage />);
      expect(host.textContent).toContain('Source Reported Amount');
      expect(host.textContent).toContain('4600');
      expect(host.textContent).toContain('high_bid');
      expect(host.textContent).toContain('not_stated');
      expect(host.textContent).toContain('privacy review');
      expect(host.innerHTML).not.toContain('Morgan');
      expect(host.querySelector('img')).toBeNull();
    } finally { Object.assign(example, { structured_data: original }); }
  });

  it('also withholds the same name in collapsed and expanded day observations', async () => {
    await mount(<DayPage />);
    expect(host.innerHTML).not.toContain('Morgan');
    const observationButton = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('condition observation'));
    expect(observationButton).toBeDefined();
    await act(async () => { observationButton!.click(); });
    expect(host.textContent).toContain('317');
    expect(host.textContent).toContain('privacy review');
    expect(host.innerHTML).not.toContain('Morgan');
    expect(host.querySelector('a[href*="example.invalid"]')).toBeNull();
  });
});
