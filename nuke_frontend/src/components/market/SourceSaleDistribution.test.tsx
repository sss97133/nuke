// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import SourceSaleDistribution, { type SourceSaleGraphProps } from './SourceSaleDistribution';
import input from './SourceSaleDistribution.fixture.json';
import type { DatedSourceSale } from '../../lib/dealRead/batComps';

// Actual anonymous valuation_by_ymm receipt captured 2026-10-04. Public sale facts only;
// fixture success is not deployment verification or market-wide coverage.
let host: HTMLDivElement, root: Root;
const props = { ...input, yearRestricted: true,
  eventFrom: '2023-10-04T00:00:00Z', eventBefore: '2026-10-04T00:00:00Z',
  evidenceAsOf: '2026-10-04T20:00:00Z', knowledgeMode: 'retrospective',
  sales: input.sales as DatedSourceSale[], comparison: { ...input.comparison, eligible: input.sales, excluded: [] } } as unknown as SourceSaleGraphProps;
async function view(name: string) {
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === name)!.click());
}
async function render(change: Partial<SourceSaleGraphProps> = {}) {
  await act(async () => root.render(<MemoryRouter><SourceSaleDistribution {...props} {...change} /></MemoryRouter>));
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('source-qualified sale graph', () => {
  it('draws actual source members, supplied quantiles and audited price position, with explicit unmatched dimensions', async () => {
    await render();
    expect(host.querySelectorAll('svg [role="button"]')).toHaveLength(18);
    expect(host.textContent).toContain('$40,000 · 50.0 percentile');
    expect(host.textContent).toContain('9 sales lower · 0 equal · 9 higher');
    expect(host.textContent).toContain('18 source lots qualify from 1,729 current public cohort records');
    expect(host.textContent).toContain('not complete BaT market coverage');
    expect(host.textContent).toContain('Condition, restoration, modifications, body style, trim, engine, mileage and equipment');
    expect(host.querySelector('.source-sales-band')).not.toBeNull();
    expect(host.querySelectorAll('svg [tabindex="0"]')).toHaveLength(1);
  });
  it('changes the actual source selection with keyboard and retains a native source and vehicle drill', async () => {
    await render();
    await view('Over time');
    const last = host.querySelector<SVGGElement>('svg [tabindex="0"]')!; last.focus();
    await act(async () => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    const rows = [...input.sales].sort((a,b) => a.eventAt.localeCompare(b.eventAt) || a.sourceUrl.localeCompare(b.sourceUrl));
    const previous = rows[rows.length - 2];
    expect(host.querySelector<HTMLAnchorElement>('.source-sales-selected a[target="_blank"]')?.href).toBe(previous.sourceUrl);
    expect(host.querySelector('.source-sales-selected')?.textContent).toContain(previous.eventAt);
    expect(document.activeElement?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.source-sales-selected a')?.getAttribute('href')).toBe(`/vehicle/${previous.vehicleId}`);
  });
  it('changes the encoding while retaining the same source set, selected record and table equivalent', async () => {
    await render();
    const source = host.querySelector('.source-sales-selected a[target="_blank"]')?.getAttribute('href');
    await view('Over time');
    expect(host.querySelector('.source-sales-band')).toBeNull();
    expect(host.querySelector('.source-sales-median')).toBeNull();
    expect(host.querySelector('svg')?.textContent).toContain('2023-10-04');
    expect(host.querySelector('svg')?.textContent).toContain('2026-10-04');
    await view('Price distribution');
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toContain('Sale amount distribution, USD');
    expect(host.querySelectorAll('svg [role="button"]')).toHaveLength(18);
    expect(host.querySelector('.source-sales-selected a[target="_blank"]')?.getAttribute('href')).toBe(source);
    expect(host.textContent).toContain('height is not time or another measure');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(18);
  });
  it('shows retained sparse sales without a fabricated median, percentile or band', async () => {
    await render({ sales: props.sales.slice(0, 2), comparison: null, summary: { median: null, p10: null, p90: null } });
    expect(host.textContent).toContain('Aggregate prices require 10 qualified sales');
    expect(host.querySelectorAll('svg [role="button"]')).toHaveLength(2);
    expect(host.querySelector('.source-sales-band')).toBeNull();
    expect(host.querySelector('.source-sales-candidate')).toBeNull();
  });
  it('exposes requested versus qualifying dates, retrospective knowledge and year qualification', async () => {
    await render();
    expect(host.textContent).toContain('2023-10-04 00:00 to 2026-10-04 00:00 UTC (end excluded)');
    expect(host.textContent).toContain('Latest qualifying sale: 2026-04-03');
    expect(host.textContent).toContain('Gaps mean missing qualifying evidence, not zero market sales');
    expect(host.textContent).toContain('Retrospective: later-discovered sales can enter');
    expect(host.textContent).toContain('Registered make/model/year context');
    await render({ yearRestricted: false });
    expect(host.textContent).toContain('model year unrestricted');
    expect(host.textContent).not.toContain('Registered make/model/year context');
    await render({ modelRestricted: false });
    expect(host.textContent).toContain('Recorded make/year context; model unrestricted');
    expect(host.textContent).not.toContain('Registered make/model/year context');
  });
  it('uses price order for distribution keyboard movement and reverts removed selection to the latest source', async () => {
    await render();
    const latest = host.querySelector<SVGGElement>('svg [tabindex="0"]')!;
    await act(async () => latest.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    const byPrice = [...props.sales].sort((a,b) => a.amount! - b.amount!);
    const highest = byPrice[byPrice.length-1];
    expect(host.querySelector<HTMLAnchorElement>('.source-sales-selected a[target="_blank"]')?.href).toBe(highest.sourceUrl);
    await render({ sales: props.sales.filter(r => r.sourceUrl !== highest.sourceUrl), comparison: null });
    expect(host.querySelector('.source-sales-selected')?.textContent).toContain('Latest qualified source sale');
    expect(host.querySelector('.source-sales-selected')?.textContent).toContain('2026-04-03');
    expect(host.querySelectorAll('svg [tabindex="0"]')).toHaveLength(1);
  });
  it('retains the source-sale scale for an entered amount beyond all sales and has no marker without a candidate', async () => {
    await render();
    const positions = [...host.querySelectorAll('.source-sales-point')].map(p => p.getAttribute('cx'));
    await render({ comparison: { ...props.comparison!, subject: { ...props.comparison!.subject, amount: 1000000 } } });
    expect([...host.querySelectorAll('.source-sales-point')].map(p => p.getAttribute('cx'))).toEqual(positions);
    expect(host.querySelector('.source-sales-candidate')?.getAttribute('x1')).toBe('682');
    expect(host.textContent).toContain('marker is pinned to the upper edge');
    await render({ comparison: null });
    expect(host.querySelector('.source-sales-candidate')).toBeNull();
    expect(host.textContent).toContain('Median recorded sale $40,650');
  });
  it.each(['currency', 'date', 'source', 'unit source', 'knowledge'])('refuses an inconsistent %s receipt instead of silently dropping its members', async field => {
    const sales = props.sales.map(r => ({ ...r }));
    if (field === 'currency') sales[0].currency = 'EUR';
    if (field === 'date') sales[0].eventAt = '2026-02-31';
    if (field === 'source') sales[0].sourceUrl = 'javascript:alert(1)';
    if (field === 'unit source') sales[0].unitSource = props.sales[1].sourceUrl;
    if (field === 'knowledge') sales[0].knownAt = '2027-01-01T00:00:00Z';
    await render({ sales });
    expect(host.querySelector('svg')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('source rows do not match this receipt');
  });
  it('refuses source dates outside the receipt window', async () => {
    await render({ eventBefore: '2026-04-03T12:00:00Z' });
    expect(host.querySelector('svg')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('source dates do not match the event window');
  });
  it('shows a recorded label only for the exact selected source, without turning its words into matched peers', async () => {
    const byDate = [...props.sales].sort((a,b) => a.eventAt!.localeCompare(b.eventAt!));
    const latest = byDate[byDate.length-1];
    await render({ recordedLabels: { [latest.sourceUrl!]: '1966 Ford Mustang Race Car' } });
    expect(host.querySelector('.source-sales-selected')?.textContent).toContain('Current recorded label: 1966 Ford Mustang Race Car');
    await view('Over time');
    await act(async () => host.querySelector('svg [tabindex="0"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(host.querySelector('.source-sales-selected')?.textContent).not.toContain('1966 Ford Mustang Race Car');
    expect(host.querySelector('.source-sales-selected')?.textContent).toContain('Vehicle label not included');
    expect(host.querySelector('.source-sales-selected')?.textContent).toContain('A label does not establish matched build or condition');
  });
});
