// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import OrganizationSourceInventory, { currentSourceRows, type SourceInventory } from './OrganizationSourceInventory';
const mock = vi.hoisted(() => ({ query: {} as any }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => mock.query }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../PrefetchLink', () => ({ PrefetchLink: ({ to, children }: any) => <a href={to}>{children}</a> }));
const data: SourceInventory = { source: 'mccormicks', checked_at: new Date().toISOString(), refresh_failed: false, stale: false,
  sales: [{ sale_key: 'mccormicks-91', name: 'Synthetic auction', starts_on: '2099-11-20', ends_on: '2099-11-22', location: 'Synthetic venue', source_url: 'https://www.classic-carauction.com/Auction-91', lots_listed: 1 },
    { sale_key: 'mccormicks-92', name: 'Later auction', starts_on: '2100-02-19', ends_on: '2100-02-21', location: 'Synthetic venue', source_url: 'https://www.classic-carauction.com/news_stories.cfm?newsid=1', lots_listed: null }],
  inventory: [
    { native_id: '1', source_url: 'https://www.classic-carauction.com/auction-cars?auctionid=1', inventory_kind: 'auction', sale_key: 'mccormicks-91', lot_number: '1', year: 1970, make: 'FORD', model: 'MUSTANG', source_status: 'scheduled', run_on: '2099-11-20', asking_amount: null, currency: null, vehicle_id: 'public-car' },
    { native_id: 'showroom:1', source_url: 'https://www.classic-carauction.com/Showroom-Inventory?sp=1&id=1', inventory_kind: 'showroom', sale_key: null, lot_number: '41', year: 2007, make: 'AUDI', model: 'A4', source_status: 'available', run_on: null, asking_amount: 8500, currency: null, vehicle_id: null },
    { native_id: 'showroom:2', source_url: 'https://www.classic-carauction.com/Showroom-Inventory?sp=1&id=2', inventory_kind: 'showroom', sale_key: null, lot_number: '42', year: 2008, make: 'AUDI', model: 'A4', source_status: 'sold', run_on: null, asking_amount: null, currency: null, vehicle_id: null },
  ] };
let root: Root | undefined;
let container: HTMLDivElement;
function renderPage(fallback?: React.ReactNode, initialFilter?: 'all' | 'auction') { container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container); act(()=>root!.render(<MemoryRouter><OrganizationSourceInventory organizationId="test" fallback={fallback} initialFilter={initialFilter} /></MemoryRouter>)); return container; }
afterEach(()=>{ act(()=>root?.unmount()); root=undefined; document.body.innerHTML=''; });
describe('publisher schedule and inventory', () => {
  it('does not turn a missing first reading into an empty inventory count', () => {
    mock.query={data:{...data,checked_at:null,sales:[],inventory:[],stale:true}};renderPage();
    expect(container.querySelector('[role=status]')?.textContent).toContain('first complete source reading is pending');
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).not.toContain('0 cars');
  });
  it('opens the Auctions tab with auction entries selected', () => {
    mock.query={data};renderPage(undefined,'auction');
    expect(container.querySelector('select')?.value).toBe('auction');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.querySelector('a[href="/vehicle/public-car"]')).toBeTruthy();
  });
  it('retains existing inventory for an organization without a publisher roster', () => {
    mock.query={data:null};renderPage(<p>Existing inventory</p>);
    expect(container.textContent).toBe('Existing inventory');
  });
  it('replaces legacy inventory with the publisher catalog used by overview', () => {
    mock.query={data};renderPage(<p>Existing inventory</p>);
    expect(container.textContent).not.toContain('Existing inventory');
    expect(container.querySelector('a[href="/vehicle/public-car"]')).toBeTruthy();
  });
  it('excludes sold showroom and ended-sale entries; filters by actual inventory type', () => {
    expect(currentSourceRows(data,'all','').map(r=>r.native_id)).toEqual(['1','showroom:1']);
    expect(currentSourceRows(data,'showroom','audi').map(r=>r.native_id)).toEqual(['showroom:1']);
    expect(currentSourceRows({...data,sales:[]},'all','').map(r=>r.native_id)).toEqual(['showroom:1']);
  });
  it('shows future unknown catalog, canonical link and source-only stock without a null vehicle route', () => {
    mock.query={ data };
    const container = renderPage();
    expect(container.textContent).toContain('Catalog not published');
    expect(container.querySelector('a[href="/vehicle/public-car"]')).toBeTruthy();
    expect(container.querySelector('a[href="/vehicle/null"]')).toBeNull();
    expect([...container.querySelectorAll('a')].filter(a=>a.textContent==='McCormick’s listing')).toHaveLength(2);
    act(()=>{ const select=container.querySelector('select')!; select.value='showroom'; select.dispatchEvent(new Event('change',{bubbles:true})); });
    expect(container.querySelector('a[href="/vehicle/public-car"]')).toBeNull();
  });
  it('keeps retained inventory visible with a delayed refresh warning', () => {
    mock.query={ data:{...data,stale:true,refresh_failed:true},isError:true };
    renderPage();
    expect(container.querySelector('[role=status]')?.textContent).toContain('last complete source reading');
    expect(container.textContent).toContain('Available showroom stock');
  });
});
