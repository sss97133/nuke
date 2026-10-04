// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import Valuation from './Valuation';

function evidence(n = 10, currency = 'USD') {
  const eligible = Array.from({ length: n }, (_, i) => ({ vehicleId: `synthetic-${i}`, sourceUrl: `https://bringatrailer.com/listing/synthetic-${i}/`,
    amount: (i + 1) * 1000, outcome: 'sold', eventAt: '2025-06-15', knownAt: '2025-06-16T00:00:00Z',
    currency, priceBasis: 'published_bid_excluding_fees', unitSource: `https://bringatrailer.com/listing/synthetic-${i}/`, conditionEvidence: 'unknown' }));
  return { query: { year: 1970, make: 'Synthetic', model: 'Coupe' }, stats: { sold_count: n, median: n>=10 ? (n+1)*500 : null,
    p10: n>=10 ? 1000+(n-1)*100 : null, p90: n>=10 ? 1000+(n-1)*900 : null, min: n>=10 ? 1000 : null, max: n>=10 ? n*1000 : null,
      avg: n>=10 ? (n+1)*500 : null, last_sale: '2025-06-15', first_sale: '2025-06-15', avg_bid_count: null, avg_comment_count: null }, comparables: [],
    receipt: { cohort: { key: 'synthetic', label: '1970 Synthetic Coupe', basis: 'registered_same_year_model_context', complete: true }, eligible,
      event_from: '2024-01-01T00:00:00Z', event_before: '2026-01-01T00:00:00Z', evidence_as_of: '2026-01-02T00:00:00Z', computed_at: '2026-01-03T00:00:00Z',
      knowledge_mode: 'retrospective', currency, minimum_sales: 10, coverage: { member_rows: 20, qualified_sales: n, condition_scalar_recorded: 0,
        body_recorded: 4, engine_recorded: 3, transmission_recorded: 2, conflicting_source_lots: 1,
        inline_raw_verified: n, archived_admitted: 0 }, exclusions: { currency_unknown: 2 } } };
}
let container: HTMLDivElement, root: Root;
let navigate: (path: string) => void, exports: Blob[];
const OriginalURL = URL;
function RoutedValuation() { navigate = useNavigate(); return <Valuation />; }
async function render(query = 'year=1970&make=Synthetic&model=Coupe&price=5000&as_of=2026-01-01&currency=USD') {
  await act(async () => root.render(<MemoryRouter initialEntries={[`/valuation?${query}`]}><RoutedValuation /></MemoryRouter>));
}
async function submit() { await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit',{ bubbles: true,cancelable: true })); }); }
const saveButton = () => [...container.querySelectorAll('button')].find(b => b.textContent==='Save this evidence receipt')!;
async function exportedReceipt() {
  await act(async () => saveButton().click());
  const blob=exports[exports.length-1];
  return new Promise<any>((resolve,reject) => {
    const reader=new FileReader(); reader.onload=() => resolve(JSON.parse(reader.result as string)); reader.onerror=reject; reader.readAsText(blob);
  });
}
function deferred() {
  let resolve!: (value: { data: ReturnType<typeof evidence>; error: null }) => void, reject!: (error: Error) => void;
  const promise=new Promise<{ data: ReturnType<typeof evidence>; error: null }>((yes,no) => { resolve=yes; reject=no; });
  return { promise,resolve,reject };
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
  exports=[];
  vi.stubGlobal('URL',class extends OriginalURL {
    static createObjectURL(blob: Blob | MediaSource) { exports.push(blob as Blob); return 'blob:synthetic-receipt'; }
    static revokeObjectURL() {}
  });
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(() => {});
  container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('qualified cohort sale-price reader UI', () => {
  it('retains the existing all-years action when no source sale qualifies, without rendering an empty price graph', async () => {
    fixture.rpc.mockResolvedValue({ data: evidence(0), error: null }); await render();
    expect(container.querySelector('svg')).toBeNull();
    expect([...container.querySelectorAll('button')].filter(b => b.textContent === 'All recorded model years')).toHaveLength(1);
    expect(container.textContent).not.toContain('50.0 percentile');
  });
  it('pages the whole qualified receipt rather than the ten-lot recent preview without sampling the calculation', async () => {
    const data = evidence(33);
    fixture.rpc.mockResolvedValue({ data, error: null }); await render();
    const section = () => container.querySelector('[aria-label="Qualified sale source records"]')!;
    expect(section().textContent).toContain('Showing 1–25 of 33 source lots');
    expect(section().querySelectorAll('li')).toHaveLength(25);
    expect((await exportedReceipt()).comparison.counts.eligibleSales).toBe(33);
    const next = [...container.querySelectorAll('button')].find(b => b.textContent === 'Next source lots')!;
    await act(async () => next.click());
    expect(section().textContent).toContain('Showing 26–33 of 33 source lots'); expect(section().querySelectorAll('li')).toHaveLength(8);
    expect(next.disabled).toBe(true); expect(fixture.rpc).toHaveBeenCalledTimes(1);
    const previous = [...container.querySelectorAll('button')].find(b => b.textContent === 'Previous source lots')!;
    await act(async () => previous.click()); expect(section().querySelectorAll('li')).toHaveLength(25);
  });

  it('explicitly broadens model years using the same currency, time and subject contract without silently changing the scope', async () => {
    const data = evidence(33), broad = { ...data, query: { ...data.query, year: null }, receipt: { ...data.receipt,
      cohort: { ...data.receipt.cohort, label: 'Synthetic Coupe', basis: 'exact_recorded_year_model_context' } } };
    fixture.rpc.mockResolvedValueOnce({ data: evidence(), error: null }).mockResolvedValueOnce({ data: broad, error: null });
    await render('year=1970&make=Synthetic&model=Coupe&price=5000&as_of=2026-01-01&currency=USD&vehicle_id=subject-id');
    expect(fixture.rpc.mock.calls[0][1].p_year).toBe(1970);
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'All recorded model years')!;
    await act(async () => button.click());
    expect(fixture.rpc.mock.calls[1]).toEqual(['valuation_by_ymm', expect.objectContaining({ p_year: null, p_make: 'Synthetic', p_model: 'Coupe',
      p_currency: 'USD', p_event_before: '2026-01-01T00:00:00Z', p_subject_vehicle_id: 'subject-id' })]);
    expect(container.textContent).toContain('All recorded model years · Synthetic Coupe');
    expect(container.textContent).toContain('Related model variants may be absent');
    expect(container.textContent).toContain('generations, condition and equipment are not matched');
    expect((await exportedReceipt()).request.p_year).toBeNull();
    expect(saveButton().disabled).toBe(false); expect(container.textContent).not.toContain('Compare again to apply');
  });

  it('keeps a broader cap failure explicit and does not reinstall or reinterpret the prior narrow receipt', async () => {
    await render(); const prior = await exportedReceipt();
    fixture.rpc.mockResolvedValue({ data: { error: 'Cohort exceeds the 10000-member reader boundary; no sampled percentile is returned.' }, error: null });
    await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'All recorded model years')!.click());
    expect(container.textContent).toContain('10000-member reader boundary'); expect(saveButton().disabled).toBe(true);
    expect(container.textContent).toContain('These records belong to the last completed lookup');
    expect(container.textContent).not.toContain('45.0 percentile'); expect(prior.request.p_year).toBe(1970);
  });

  it('exposes distinct vehicle/capture/source-lot grains, supported ancestry and exact source/vehicle navigation without raw text', async () => {
    const data = evidence(), vehicle = '00000000-0000-4000-8000-000000000001', snapshot = '00000000-0000-4000-8000-000000000002';
    Object.assign(data.receipt.coverage, { dated_source_rows: 16, capture_presentations: 18, qualified_capture_presentations: 12, duplicate_presentations: 2 });
    Object.assign(data.receipt.eligible[0], { vehicleId: vehicle, snapshotId: snapshot, sourceSha256: 'a'.repeat(64),
      snapshotFetchedAt: '2025-06-15T12:00:00Z', snapshotCreatedAt: '2025-06-15T12:05:00Z', parsedAt: '2025-06-16T00:00:00Z',
      sourceVerification: 'per_read_inline_hash_parser', derivedObservationId: null, sourceVehicleEventId: null,
      privateRawText: 'PRIVATE SYNTHETIC TEXT MUST NOT DISPLAY', sourceParser: 'PRIVATE SYNTHETIC PARSER TEXT' });
    fixture.rpc.mockResolvedValue({ data, error: null }); await render();
    expect(container.textContent).toContain('16 dated source vehicle records · 18 linked source captures · 12 qualified capture presentations · 2 duplicate presentations collapsed');
    const records = container.querySelector('[aria-label="Qualified sale source records"]')!;
    expect(records.querySelector(`a[href="/vehicle/${vehicle}"]`)?.textContent).toBe('Vehicle record');
    expect(records.querySelector('a[href="https://bringatrailer.com/listing/synthetic-0/"]')?.textContent).toBe('BaT source');
    await act(async () => container.querySelector('svg [role="button"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('.source-sales-ancestry')?.textContent).toContain(`Snapshot reference: ${snapshot}`);
    expect(container.querySelector('.source-sales-ancestry')?.textContent).not.toContain('PRIVATE SYNTHETIC');
    expect(container.textContent).toContain(`Snapshot reference: ${snapshot}`);
    expect(container.textContent).toContain('Inline source hash and parser verified'); expect(container.textContent).toContain('snapshot ingested: 2025-06-15 12:05:00.000 UTC');
    expect(container.textContent).toContain('Native sale-event reference: Unknown'); expect(container.textContent).not.toContain('PRIVATE SYNTHETIC');
    expect(container.textContent).toContain('Platform-wide coverage is unknown');
  });

  it('uses only checked canonical BaT source links and reports optional ancestry/clock gaps as unknown', async () => {
    const data = evidence(), row = data.receipt.eligible[0];
    row.sourceUrl = 'https://bringatrailer.com.attacker.invalid/listing/synthetic-0/'; row.unitSource = row.sourceUrl;
    Object.assign(row, { snapshotFetchedAt: 'PRIVATE SYNTHETIC CLOCK TEXT' });
    fixture.rpc.mockResolvedValue({ data, error: null }); await render();
    expect(container.querySelector('a[href*="attacker.invalid"]')).toBeNull(); expect(container.textContent).toContain('Source link unavailable');
    expect(container.textContent).toContain('Verification ancestry unavailable'); expect(container.textContent).toContain('Snapshot reference: Unknown');
    expect(container.textContent).not.toContain('PRIVATE SYNTHETIC CLOCK'); expect(container.textContent).toContain('Source capture: Unknown');
    expect(container.textContent).toContain('Unknown dated source vehicle records');
  });

  it('accepts the additive all-years basis and typed episode ancestry without requiring it on legacy rows', async () => {
    const data = evidence(), broad = { ...data, query: { ...data.query, year: null }, receipt: { ...data.receipt,
      cohort: { ...data.receipt.cohort, label: 'Synthetic Coupe', basis: 'exact_recorded_make_model_context_all_years' } } };
    Object.assign(broad.receipt.coverage, { typed_sale_episode_links: 1 });
    const event = '00000000-0000-4000-8000-000000000004';
    Object.assign(broad.receipt.eligible[0], { sourceVehicleEventId: event, sourceEpisodeAncestry: 'canonical_current_context_verified',
      sourceParser: 'batParser:1.0.0_sale_grammar_with_ambiguity_refusal', admissionParser: 'batParser:source_sale_qualification_v1' });
    fixture.rpc.mockResolvedValue({ data: broad, error: null }); await render('make=Synthetic&model=Coupe&price=5000&currency=USD');
    expect(container.textContent).toContain('Related model variants may be absent');
    expect(container.textContent).toContain('1 qualified source lots have revalidated native sale-event links');
    expect(container.textContent).toContain(`Native sale-event reference: ${event}`);
    expect(container.textContent).toContain('current canonical sale-event link verified');
    expect(container.textContent).toContain('admission parser: batParser:source_sale_qualification_v1');
    expect(container.textContent).toContain('Native episode ancestry: Unestablished'); expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });

  it('retains distinct sale episodes on one vehicle while collapsing repeated captures of the same source lot', async () => {
    const data = evidence(), vehicle = '00000000-0000-4000-8000-000000000003';
    data.receipt.eligible[0].vehicleId = vehicle; data.receipt.eligible[1].vehicleId = vehicle;
    data.receipt.eligible.push({ ...data.receipt.eligible[0], sourceUrl: 'http://www.bringatrailer.com/listing/SYNTHETIC-0/?ref=synthetic#result' });
    fixture.rpc.mockResolvedValue({ data, error: null }); await render();
    const section = container.querySelector('[aria-label="Qualified sale source records"]')!;
    expect(section.querySelectorAll('li')).toHaveLength(10);
    expect(section.querySelectorAll(`a[href="/vehicle/${vehicle}"]`)).toHaveLength(2);
    expect((await exportedReceipt()).comparison.counts.eligibleSales).toBe(10);
    expect(section.textContent).toContain('Showing 1–10 of 10 source lots');
  });

  it('connects each source amount with the candidate position locally without a new query', async () => {
    await render(); const section = container.querySelector('[aria-label="Qualified sale source records"]')!;
    expect([...section.querySelectorAll('li')].filter(li => li.textContent?.includes('Lower than candidate'))).toHaveLength(4);
    expect([...section.querySelectorAll('li')].filter(li => li.textContent?.includes('Equal to candidate'))).toHaveLength(1);
    await enter('Candidate bid / price', '8000');
    expect([...section.querySelectorAll('li')].filter(li => li.textContent?.includes('Lower than candidate'))).toHaveLength(7);
    expect([...section.querySelectorAll('li')].filter(li => li.textContent?.includes('Equal to candidate'))).toHaveLength(1);
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });

  it('loads the declared currency/date/subject contract and explains the full denominator and unmatched condition', async () => {
    await render('year=1970&make=Synthetic&model=Coupe&price=5000&as_of=2026-01-01&currency=USD&vehicle_id=subject-id');
    expect(fixture.rpc).toHaveBeenCalledWith('valuation_by_ymm',expect.objectContaining({ p_event_before: '2026-01-01T00:00:00Z', p_currency: 'USD', p_subject_vehicle_id: 'subject-id' }));
    expect(container.textContent).toContain('45.0 percentile');
    expect(container.textContent).toContain('10 qualified source lots from 20 public cohort records');
    expect(container.textContent).toContain('Condition and equipment remain unmatched');
    expect(container.textContent).toContain('Earlier sales discovered later');
    expect(container.textContent).toContain('actual snapshot ingestion');
    expect(container.textContent).toContain('when the verified sale receipt arrived');
    expect(container.textContent).toContain('10 verified inline source lots · 0 admitted archived source lots');
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
    expect(container.textContent).toContain('Compare again to apply the changed cohort, currency, date or vehicle');
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

  it('exports evaluated request and resolved receipt while candidate-only changes preserve the source universe and cutoff', async () => {
    await render(); const first=await exportedReceipt(); await enter('Candidate bid / price','8000'); const next=await exportedReceipt();
    expect(next.request).toEqual(first.request);
    expect(next.request).toMatchObject({ p_year: 1970,p_make: 'Synthetic',p_model: 'Coupe',p_price: null,p_evidence_as_of: null });
    expect(next.resolvedRequest).toMatchObject({ p_event_from: '2024-01-01T00:00:00Z',p_event_before: '2026-01-01T00:00:00Z',p_evidence_as_of: '2026-01-02T00:00:00Z' });
    expect(next.sourceReceipt).toEqual(first.sourceReceipt);
    expect(next.comparison.eligible).toEqual(first.comparison.eligible);
    expect(first.comparison.subject.amount).toBe(5000); expect(next.comparison.subject.amount).toBe(8000);
    expect(first.comparison.percentile).toBe(45); expect(next.comparison.percentile).toBe(75);
    expect(next.comparison.evidenceAsOf).toBe(first.comparison.evidenceAsOf); expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });

  it('withholds a prior subject receipt after same-component URL navigation and binds the next export to the new subject', async () => {
    const query='year=1970&make=Synthetic&model=Coupe&price=5000&as_of=2026-01-01&currency=USD';
    await render(`${query}&vehicle_id=00000000-0000-4000-8000-000000000001`); const first=await exportedReceipt();
    await act(async () => navigate(`/valuation?${query}&vehicle_id=00000000-0000-4000-8000-000000000002`));
    expect(container.textContent).not.toContain('45.0 percentile'); expect(saveButton().disabled).toBe(true);
    await submit(); const next=await exportedReceipt();
    expect(next.request.p_subject_vehicle_id).toBe('00000000-0000-4000-8000-000000000002');
    expect(next.comparison.subject.vehicleId).toBe(next.request.p_subject_vehicle_id);
    expect(first.request.p_subject_vehicle_id).toBe('00000000-0000-4000-8000-000000000001');
  });

  it.each(['success','error'])('does not let late request A %s replace newer completed request B or its export', async outcome => {
    const a=deferred(),b=deferred(); fixture.rpc.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await render('year=1970&make=Synthetic&model=Coupe&price=5000&as_of=2026-01-01&currency=USD&vehicle_id=subject-a');
    await act(async () => navigate('/valuation?vehicle_id=subject-b'));
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    await submit(); await act(async () => b.resolve({ data: evidence(11),error: null }));
    const before=await exportedReceipt();
    await act(async () => { if (outcome==='success') a.resolve({ data: evidence(),error: null }); else a.reject(new Error('Old A failure')); });
    const after=await exportedReceipt();
    expect(after.request).toEqual(before.request); expect(after.sourceReceipt).toEqual(before.sourceReceipt);
    expect(after.request.p_subject_vehicle_id).toBe('subject-b');
    expect(container.textContent).toContain('11 qualified source lots'); expect(container.textContent).not.toContain('Old A failure');
  });

  it('keeps newer B loading when A completes first, without installing an A receipt', async () => {
    const a=deferred(),b=deferred(); fixture.rpc.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await render('year=1970&make=Synthetic&model=Coupe&price=5000&vehicle_id=subject-a');
    await act(async () => navigate('/valuation?vehicle_id=subject-b')); await submit();
    await act(async () => a.resolve({ data: evidence(),error: null }));
    expect(container.textContent).toContain('Looking'); expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[aria-label="Sale comparison evidence"]')).toBeNull();
    await act(async () => b.resolve({ data: evidence(11),error: null })); expect(container.textContent).toContain('11 qualified source lots');
  });

  it('keeps edited form inputs out of old exports and preserves saved receipt A across a later refresh', async () => {
    await render(); const first=await exportedReceipt(); const preserved=structuredClone(first);
    await enter('Make','Changed'); expect(saveButton().disabled).toBe(true); await act(async () => saveButton().click()); expect(exports).toHaveLength(1);
    const next=evidence(11); next.query.make='Changed'; next.receipt.evidence_as_of='2026-01-04T00:00:00Z'; next.receipt.computed_at='2026-01-05T00:00:00Z';
    fixture.rpc.mockResolvedValue({ data: next,error: null }); await submit(); const saved=await exportedReceipt();
    expect(saved.request.p_make).toBe('Changed'); expect(saved.sourceReceipt.evidence_as_of).toBe('2026-01-04T00:00:00Z');
    expect(saved.comparison.evidenceAsOf).toBe(saved.sourceReceipt.evidence_as_of); expect(first).toEqual(preserved);
    expect(container.textContent).toContain('Save this receipt to keep this calculation');
  });

  it('withholds a response whose returned context disagrees with the evaluated request', async () => {
    fixture.rpc.mockResolvedValue({ data: evidence(10,'EUR'),error: null }); await render();
    expect(container.textContent).toContain('Returned evidence does not match');
    expect(container.querySelector('[aria-label="Sale comparison evidence"]')).toBeNull();
  });
});
