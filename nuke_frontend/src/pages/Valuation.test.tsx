// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import Valuation from './Valuation';

function evidence(n = 10, currency = 'USD') {
  const eligible = Array.from({ length: n }, (_, i) => ({ vehicleId: `synthetic-${i}`, sourceUrl: `https://bringatrailer.com/listing/synthetic-${i}/`,
    amount: (i + 1) * 1000, outcome: 'sold', eventAt: '2025-06-15', knownAt: '2025-06-16T00:00:00Z',
    currency, priceBasis: 'published_bid_excluding_fees', unitSource: `https://bringatrailer.com/listing/synthetic-${i}/`, conditionEvidence: 'unknown' }));
  return { query: { year: 1970, make: 'Synthetic', model: 'Coupe' }, stats: { sold_count: n, median: n>=10 ? 5500 : null,
    p10: n>=10 ? 1900 : null, p90: n>=10 ? 9100 : null, min: n>=10 ? 1000 : null, max: n>=10 ? 10000 : null,
    avg: n>=10 ? 5500 : null, last_sale: '2025-06-15', first_sale: '2025-06-15', avg_bid_count: null, avg_comment_count: null }, comparables: [],
    receipt: { cohort: { key: 'synthetic', label: '1970 Synthetic Coupe', basis: 'registered_same_year_model_context', complete: true }, eligible,
      event_from: '2024-01-01T00:00:00Z', event_before: '2026-01-01T00:00:00Z', evidence_as_of: '2026-01-02T00:00:00Z', computed_at: '2026-01-03T00:00:00Z',
      knowledge_mode: 'retrospective', currency, minimum_sales: 10, coverage: { member_rows: 20, qualified_sales: n, condition_scalar_recorded: 0,
        body_recorded: 4, engine_recorded: 3, transmission_recorded: 2, conflicting_source_lots: 1 }, exclusions: { currency_unknown: 2 } } };
}
let container: HTMLDivElement, root: Root;
async function render(query = 'year=1970&make=Synthetic&model=Coupe&price=5000&as_of=2026-01-01&currency=USD') {
  await act(async () => root.render(<MemoryRouter initialEntries={[`/valuation?${query}`]}><Valuation /></MemoryRouter>));
}
async function enter(label: string,value: string) {
  const input = [...container.querySelectorAll('label')].find(l => l.textContent?.includes(label))!.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
    input.dispatchEvent(new Event('input',{ bubbles: true }));
  });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.rpc.mockReset(); fixture.rpc.mockResolvedValue({ data: evidence(), error: null });
  container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('qualified cohort sale-price reader UI', () => {
  it('loads the declared currency/date/subject contract and explains the full denominator and unmatched condition', async () => {
    await render('year=1970&make=Synthetic&model=Coupe&price=5000&as_of=2026-01-01&currency=USD&vehicle_id=subject-id');
    expect(fixture.rpc).toHaveBeenCalledWith('valuation_by_ymm',expect.objectContaining({ p_event_before: '2026-01-01T00:00:00Z', p_currency: 'USD', p_subject_vehicle_id: 'subject-id' }));
    expect(container.textContent).toContain('45.0 percentile');
    expect(container.textContent).toContain('10 qualified source lots from 20 public cohort records');
    expect(container.textContent).toContain('Condition and equipment remain unmatched');
    expect(container.textContent).toContain('Earlier sales discovered later');
    expect(container.textContent).toContain('4 lower · 1 equal · 5 higher');
    expect(container.textContent).toContain('condition at sale');
  });

  it('recomputes candidate prices locally from the same evidence, without another query', async () => {
    await render(); await enter('Candidate bid / price','8000');
    expect(container.textContent).toContain('75.0 percentile'); expect(fixture.rpc).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('7 lower · 1 equal · 2 higher');
  });

  it('refuses to reinterpret old USD results after currency or cohort edits', async () => {
    await render();
    const select = container.querySelector('select')!;
    await act(async () => { select.value='EUR'; select.dispatchEvent(new Event('change',{ bubbles: true })); });
    expect(container.textContent).toContain('Compare again to apply the changed cohort, currency or date');
    expect(container.textContent).not.toContain('45.0 percentile');
    expect(container.textContent).toContain('$5,500'); expect(container.textContent).not.toContain('€5,500');
  });

  it('keeps insufficient source coverage unknown instead of a zero value or a fairness verdict', async () => {
    fixture.rpc.mockResolvedValue({ data: evidence(9), error: null }); await render();
    expect(container.textContent).toContain('Price percentile unavailable');
    expect(container.textContent).toContain('At least 10 qualified sales');
    expect(container.textContent).toContain('Aggregate prices are withheld');
    expect(container.textContent).not.toContain('$0'); expect(container.textContent).not.toContain('sold soft');
  });

  it('withholds the legacy unrestricted response and cap-truncated statistics', async () => {
    fixture.rpc.mockResolvedValue({ data: { query: {}, stats: { sold_count: 100,median: 12345 }, comparables: [] }, error: null }); await render();
    expect(container.textContent).toContain('Qualified sale evidence is unavailable');
    expect(container.textContent).not.toContain('$12,345');
    await act(async () => root.unmount()); root=createRoot(container);
    fixture.rpc.mockResolvedValue({ data: { error: 'Cohort exceeds the 10000-member reader boundary', stats: null }, error: null }); await render();
    expect(container.textContent).toContain('10000-member reader boundary');
    expect(container.querySelector('[aria-label="Sale comparison evidence"]')).toBeNull();
  });
});
