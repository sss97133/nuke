// @vitest-environment jsdom
// Parts hand-off: the one eBay link builder (plain item pages while no campaign id is set) and the /jobs/:id/parts page
// over a synthetic work_order_operations_read payload (fixture shapes from the 20261022013000 contract; invented values).
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
const auth = vi.hoisted(() => ({ user: null as {id:string} | null, loading: false }));
vi.mock('../../hooks/useAuth', () => ({useAuth: () => auth}));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc, functions: { invoke: fixture.invoke } } }));
import { buildEbayHref, ebayHref, ebayLinkNote } from './ebayLink';
import JobPartsHandoff, { approvedParts, approvedTotals } from './JobPartsHandoff';
import PartsFinder from './PartsFinder';

const ITEM = 'https://www.ebay.com/itm/157375338850?fits=Year%3A1977%7CModel%3AK5%20Blazer';

describe('ebay links', () => {
  it('is the plain item page while no campaign id is configured', () => {
    expect(ebayHref(ITEM)).toBe(ITEM);
    expect(ebayLinkNote()).toMatch(/plain eBay item page/);
  });
  it('adds the EPN parameters only through the one builder, from a configured id', () => {
    const href = buildEbayHref(ITEM, '5550000000')!;   // synthetic id; real ids live only in the deploy environment
    const u = new URL(href);
    expect(u.pathname).toBe('/itm/157375338850');
    expect(u.searchParams.get('fits')).toBe('Year:1977|Model:K5 Blazer');
    expect(u.searchParams.get('campid')).toBe('5550000000');
    expect(u.searchParams.get('mkrid')).toBe('711-53200-19255-0');
    expect(ebayLinkNote('5550000000')).toMatch(/may earn a commission/);
  });
  it('refuses anything that is not an eBay item page', () => {
    for (const bad of ['https://evil.example/itm/157375338850', 'javascript:alert(1)', 'https://www.ebay.com/itm/157375338850#x', null]) {
      expect(buildEbayHref(bad, null)).toBeNull();
    }
  });
});

const WO = '00000000-0000-4000-a000-0000000000aa';
const listing = (id: string, total: number | null, price: number) => ({ marketplace: 'ebay', item_id: id, item_url: `https://www.ebay.com/itm/${id}`,
  title: `Fixture pump ${id}`, price, currency: 'USD', shipping: total === null ? null : total - price, total, condition: 'New', fit: 'exact',
  observed_at: '2026-10-20T18:00:00Z' });
const ops = {
  work_order_id: WO, display_title: 'Fuel system', as_of: '2026-10-20T19:00:00Z',
  vehicle_label: { year: 1977, make: 'Chevrolet', model: 'Blazer', text: '1977 Chevrolet Blazer' },
  parts: [
    { id: 'p1', part_name: 'fuel pump', quantity: 1, approved_listings: [
      { approval_id: 'a1', approved_at: '2026-10-20T18:05:00Z', approver_role: 'organization_owner', listing: listing('157375338850', 23.59, 23.59) },
      { approval_id: 'a2', approved_at: '2026-10-20T18:06:00Z', approver_role: 'customer', listing: listing('306697039583', null, 15.99) }] },
    { id: 'p2', part_name: 'radiator', quantity: 1, approved_listings: [] },
  ],
};

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  auth.user = null; auth.loading = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation(() => Promise.resolve({ data: ops, error: null }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('parts hand-off page', () => {
  it('lists each approved listing once with its eBay link, and totals at approval time', async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={[`/jobs/${WO}/parts`]}>
      <Routes><Route path="/jobs/:workOrderId/parts" element={<JobPartsHandoff />} /></Routes></MemoryRouter>));
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(fixture.rpc).toHaveBeenCalledWith('work_order_operations_read', { p_work_order_id: WO });
    const links = [...host.querySelectorAll('a')].filter(a => a.textContent === 'Open on eBay').map(a => a.getAttribute('href'));
    expect(links).toEqual(['https://www.ebay.com/itm/157375338850', 'https://www.ebay.com/itm/306697039583']);
    expect(host.textContent).toContain('$23.59 delivered');
    expect(host.textContent).toContain('$15.99 + shipping not stated');
    expect(host.textContent).toContain('Total, 1 of 2 listings');
    expect(host.textContent).toContain('One listing states no shipping cost');
    expect(host.textContent).toContain('Nuke earns nothing from them');
    expect(host.textContent).not.toContain('radiator');
  });
  it('parts finder: a search writes nothing; only the confirmed Sign approves, with the reason and the part line', async () => {
    const shortlisted = { ...listing('157375338850', 23.59, 23.59), rank: 1, why: ['Exact fit: eBay matched Year 1977', '$23.59 delivered: lowest of 44'],
      seller: { username: 'fixture_seller', feedback_percentage: 99.9, feedback_score: 63715 }, item_location: { postal_prefix: '372**', country: 'US' } };
    fixture.invoke.mockResolvedValue({ error: null, data: { ok: true, refused: null, calls: { browse: 1, taxonomy: 7 }, quota: { daily_cap: 300, used_today: 4 },
      parts: [{ query: 'fuel pump', status: 'searched', ebay_total: 1288, read: 50, exact_read: 50, observed_at: '2026-10-20T18:00:00Z', browse_calls: 1,
        category: { id: '33555', name: 'Fuel Pumps & Sending Units' },
        fitment: { established: true, note: 'eBay checks fit on Year, Make, Model, Trim; not checked: Engine',
          steps: [{ property: 'Engine', ours: 'LS3 (swap)', ebay: null, basis: 'recorded as an engine swap' }] }, shortlist: [shortlisted] }] } });
    fixture.rpc.mockResolvedValue({ data: { approval_id: 'a9' }, error: null });
    const onApproved = vi.fn();
    await act(async () => root.render(<MemoryRouter><PartsFinder workOrderId={WO} vehicleId="00000000-0000-4000-a000-0000000000bb" onApproved={onApproved}
      parts={[{ id: 'p1', part_name: 'fuel pump', status: 'quoted' }, { id: 'p3', part_name: 'gasket', status: 'installed' }]} /></MemoryRouter>));
    expect(host.textContent).not.toContain('gasket');                 // installed parts are not offered for search
    const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { box.click(); });
    const find = [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('Find exact-fit listings'))!;
    await act(async () => { find.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(fixture.invoke).toHaveBeenCalledWith('extract-ebay-motors', { body: { action: 'parts', vehicle_id: '00000000-0000-4000-a000-0000000000bb',
      delivery_postal_code: undefined, parts: [{ query: 'fuel pump', part_number: null, work_order_part_id: 'p1' }] } });
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Engine: recorded as an engine swap');
    expect(host.textContent).toContain('1,288 listings fit');
    const open = [...host.querySelectorAll('a')].find(a => a.textContent === 'Open on eBay')!;
    expect(open.getAttribute('href')).toBe('https://www.ebay.com/itm/157375338850');
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Approve for this job')!.click(); });
    expect(fixture.rpc).not.toHaveBeenCalled();                       // opening the confirm is not approval
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Sign: approve this listing')!.click(); });
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    const [rpcName, args] = fixture.rpc.mock.calls[0];
    expect(rpcName).toBe('approve_job_part_listing');
    expect(args).toMatchObject({ p_work_order_id: WO, p_work_order_part_id: 'p1', p_part_name: null, p_quantity: 1,
      p_reason: 'Exact fit: eBay matched Year 1977; $23.59 delivered: lowest of 44',
      p_listing: { marketplace: 'ebay', item_id: '157375338850', fit: 'exact', seller_feedback_percentage: 99.9 } });
    expect(onApproved).toHaveBeenCalled();
  });
  it('reads approvals and totals per currency', () => {
    const rows = approvedParts(ops);
    expect(rows.map(r => r.part.id)).toEqual(['p1']);
    expect(approvedTotals(rows)).toEqual({ totals: [['USD', 23.59]], unpriced: 1 });
  });
});

it('does not carry an approval reason across viewer changes or late reads', async () => {
  const draw = async () => act(async () => root.render(<MemoryRouter initialEntries={[`/jobs/${WO}/parts`]}><Routes><Route path="/jobs/:workOrderId/parts" element={<JobPartsHandoff/>}/></Routes></MemoryRouter>));
  auth.user={id:'viewer-a'};let finish!:(value:unknown)=>void;
  fixture.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})); await draw();
  auth.user=null;fixture.rpc.mockResolvedValue({data:ops,error:null});await draw();
  await act(async()=>finish({data:{...ops,display_title:'PRIVATE APPROVAL REASON'},error:null}));
  expect(host.textContent).not.toContain('PRIVATE APPROVAL REASON');expect(host.textContent).toContain('Fuel system');
});
