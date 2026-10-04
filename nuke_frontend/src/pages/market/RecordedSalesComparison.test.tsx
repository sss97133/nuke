// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordedSalesReceipt, SalesScopeOption, SalesRequest } from './useRecordedSales';

const fixture = vi.hoisted(() => ({ catalog: {} as any, query: {} as any, request: null as SalesRequest | null, retry: vi.fn() }));
vi.mock('./useRecordedSales', async original => ({ ...await original<typeof import('./useRecordedSales')>(),
  useSalesScopes: () => fixture.catalog, useRecordedSales: (request: SalesRequest | null) => { fixture.request = request; return fixture.query; } }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, ...props }: any) => <a href={to} {...props} /> }));
import RecordedSalesComparison from './RecordedSalesComparison';

const make: SalesScopeOption = { key: 'make:fixture-make', label: 'FIXTURE MAKE', make: 'FIXTURE MAKE',
  scope: { kind: 'canonical_make', canonical_make_id: 'fixture-make' } };
const subject: SalesScopeOption = { key: 'subject:fixture-subject', label: 'FIXTURE MAKE model · 1976–1980 · supported grouping', make: 'FIXTURE MAKE',
  scope: { kind: 'supported_subject', subject_id: 'fixture-subject' } };
const bucket = '2026-10-03T00:00:00+00:00';
function receipt(): RecordedSalesReceipt {
  return { contract_version: 1, metric_id: 'recorded_sale_events', state: 'partial', reason: 'external_capture_and_result_completeness_unverified',
    scope: { label: 'FIXTURE MAKE', comparison_basis: 'make population, not condition-equivalent valuation cohort' },
    knowledge_mode: 'current_recorded_state', knowledge_cutoff: '2026-10-04T09:00:00Z', generated_at: '2026-10-04T09:00:00Z',
    event_from: '2026-10-02T00:00:00Z', event_to: '2026-10-04T00:00:00Z', candidate_limit: 2000, captured_candidates: 45, truncated: false,
    coverage: { unresolved_scope: 3, conflicting_alias_episodes: 1, eligible_recorded_episodes: 44, complete_external_capture: false },
    series: (['selected', 'benchmark'] as const).map(series => ({ bucket_start: bucket, series,
      value: series === 'selected' ? 2 : 10, denominator: series === 'selected' ? 4 : 40,
      ratio: null, absolute_change: null, relative_change: null, source_observed_at: null,
      coverage: { captured_eligible: series === 'selected' ? 4 : 40, ended_pending: 1, explicit_no_sale: 1,
        bid_to: 1, sold_without_supported_amount: 0, source_clock_known: 0, source_clock_unknown: series === 'selected' ? 4 : 40,
        incomplete_bucket: false, bucket_elapsed_seconds: 86400, full_bucket_seconds: 86400 } })),
    evidence: { has_more: false, pagination_supported: false, per_bucket_series_limit: 20,
      contributors: [{ auction_event_id: 'fixture-auction', vehicle_id: 'fixture-vehicle',
        source_url: 'https://bringatrailer.com/listing/fixture/', event_at: '2026-10-03T18:00:00Z', bucket_start: bucket, series: 'selected',
        source_read_basis: 'unknown', source_observed_at: null, latest_source_row_write: '2026-10-04T08:59:00Z' }] } };
}
let container: HTMLDivElement, root: Root;
async function render(makeName: string | null = 'FIXTURE MAKE') {
  await act(async () => root.render(<RecordedSalesComparison make={makeName} />));
}
function countButton(prefix: string) { return [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label')?.includes(prefix))!; }
async function select(label: string, value: string) {
  const element = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T09:30:00Z'));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.retry.mockReset(); fixture.request = null;
  fixture.catalog = { data: [make, subject], isLoading: false, isError: false, refetch: fixture.retry };
  fixture.query = { data: receipt(), isFetching: false, isError: false, refetch: fixture.retry };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

describe('recorded sales evidence comparison', () => {
  it('resolves the registered make ID, preserves partial denominators and refuses invented ratios/changes', async () => {
    await render('fixture make');
    expect(fixture.request).toMatchObject({ scope: make.scope, event_from: '2026-10-02T00:00:00.000Z', event_to: '2026-10-04T00:00:00.000Z', evidence_limit: 20 });
    expect(container.textContent).toContain('2 recorded sales · 4 captured ended listings');
    expect(container.textContent).toContain('10 recorded sales · 40 captured ended listings');
    expect(container.textContent).toContain('3 unresolved memberships excluded from both series');
    expect(container.textContent).toContain('Source clocks: 0 recorded · 4 unknown. Ended pending: 1');
    expect(container.textContent).toContain('Ratios and period changes: unknown');
    expect(container.textContent).toContain('Partial capture');
    expect(container.textContent).not.toMatch(/50%|25%|USD|sell-through|market strength/);
    expect(container.querySelector('time')?.dateTime).toBe('2026-10-04T09:00:00Z');
    expect(container.querySelector('[aria-label="Recorded sales contributors"]')).toBeNull();
  });
  it('drills the exact bucket/series with a new cutoff and only its real contributor links', async () => {
    await render(); await act(async () => countButton('FIXTURE MAKE: 2 recorded').click());
    expect(fixture.request).toMatchObject({ evidence_bucket: bucket, evidence_series: 'selected' });
    const next = receipt(); next.knowledge_cutoff = '2026-10-04T09:31:00Z'; next.evidence.has_more = true;
    next.evidence.contributors.push({ ...next.evidence.contributors[0], auction_event_id: 'wrong-series', vehicle_id: 'excluded', series: 'benchmark' });
    fixture.query.data = next; await render();
    const drill = container.querySelector('[aria-label="Recorded sales contributors"]')!;
    expect(drill.textContent).toContain('Showing 1; limit 20');
    expect(drill.textContent).toContain('More contributors omitted; no pagination cursor');
    expect(drill.textContent).toContain('Source read time unknown');
    expect(drill.querySelector('a[href="/vehicle/fixture-vehicle"]')).toBeTruthy();
    expect(drill.querySelector('a[href="/vehicle/excluded"]')).toBeNull();
    expect(drill.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe('https://bringatrailer.com/listing/fixture/');
    expect(drill.querySelector('a[target="_blank"]')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.querySelector('time')?.dateTime).toBe(next.knowledge_cutoff);
  });
  it('preserves direct/cached clocks and never substitutes the row write for unknown source time', async () => {
    await render(); await act(async () => countButton('FIXTURE MAKE: 2 recorded').click());
    const data = receipt();
    data.evidence.contributors.push({ ...data.evidence.contributors[0], auction_event_id: 'cache', source_read_basis: 'cached_snapshot', source_observed_at: '2026-10-01T08:00:00Z' },
      { ...data.evidence.contributors[0], auction_event_id: 'direct', source_read_basis: 'direct_fetch', source_observed_at: '2026-10-04T08:00:00Z' });
    fixture.query.data = data; await render();
    const drill = container.querySelector('[aria-label="Recorded sales contributors"]')!;
    expect(drill.textContent).toContain('Source cached snapshot 2026-10-01 08:00:00 UTC');
    expect(drill.textContent).toContain('Source direct read 2026-10-04 08:00:00 UTC');
    expect(drill.textContent).not.toContain('08:59:00');
  });
  it('refuses capped counts instead of showing zero, bar lengths or contributors', async () => {
    const data = receipt(); data.truncated = true; data.captured_candidates = 2001;
    data.series.forEach(p => { p.value = null; p.denominator = null; }); fixture.query.data = data;
    await render();
    expect(container.textContent).toContain('Candidate limit exceeded (2,001 captured; limit 2,000)');
    expect(container.textContent).not.toContain('0 recorded sales');
    expect(countButton('FIXTURE MAKE: counts refused').disabled).toBe(true);
    expect(container.querySelector('[aria-label="Daily recorded sales counts"] [aria-hidden="true"]')).toBeNull();
  });
  it('explains supported grouping zero coverage and sends its registered subject ID over seven days', async () => {
    await render(); await select('Recorded sales scope', subject.key); await select('Recorded sales event window', '7');
    expect(fixture.request).toMatchObject({ scope: subject.scope, event_from: '2026-09-27T00:00:00.000Z', event_to: '2026-10-04T00:00:00.000Z' });
    const data = receipt(); data.series[0].value = 0; data.series[0].denominator = 0; fixture.query.data = data; await render();
    expect(container.textContent).toContain('0 recorded sales · 0 captured ended listings');
    expect(container.textContent).toContain('No matched captured episodes; this does not establish zero demand');
    expect(countButton('supported grouping: 0 recorded').disabled).toBe(true);
  });
  it('separates a real captured zero from unavailable scope, loading and API failure', async () => {
    await render(null); expect(fixture.request).toBeNull();
    expect(container.querySelector('[aria-label="Daily recorded sales counts"]')).toBeNull();
    await render('UNREGISTERED'); expect(fixture.request).toBeNull();
    expect(container.textContent).toContain('No unique registered make matches UNREGISTERED');
    const zero = receipt(); zero.series[0].value = 0; fixture.query.data = zero; await render();
    expect(container.textContent).toContain('0 recorded sales · 4 captured ended listings');
    expect(container.textContent).not.toContain('No matched captured episodes');
    fixture.query.data = undefined;
    await render(); fixture.query.isFetching = true; await render();
    expect(container.textContent).toContain('Reading recorded outcomes');
    fixture.query.isFetching = false; fixture.query.data = { state: 'unavailable', reason: 'unsupported_or_unknown_subject' }; await render();
    expect(container.textContent).toContain('unsupported or unknown subject');
    expect(container.querySelector('[aria-label="Daily recorded sales counts"]')).toBeNull();
    fixture.query.data = undefined; fixture.query.isError = true; await render();
    const retry = [...container.querySelectorAll('button')].find(b => b.textContent === 'Retry recorded outcomes')!;
    await act(async () => retry.click()); expect(fixture.retry).toHaveBeenCalledOnce();
  });
  it('starts the owner Porsche case by unique registry resolution and refreshes the current read', async () => {
    fixture.catalog.data = [{ ...make, label: 'PORSCHE', make: 'PORSCHE' }];
    await render(null); expect(fixture.request?.scope).toEqual(make.scope);
    const refresh = [...container.querySelectorAll('button')].find(b => b.textContent === 'Refresh recorded evidence')!;
    await act(async () => refresh.click()); expect(fixture.retry).toHaveBeenCalledOnce();
  });
});
