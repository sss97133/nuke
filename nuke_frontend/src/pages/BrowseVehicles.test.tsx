// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
const fixture=vi.hoisted(() => ({ executeBrowse:vi.fn(), error:null as string|null, results:[] as unknown[], rpc:vi.fn() }));
vi.mock('../lib/supabase', () => ({supabase:{rpc:fixture.rpc}}));
vi.mock('../hooks/useViewHistory', () => ({useViewHistory:() => ({recordView:() => {}})}));
vi.mock('../components/layout/hooks/useSearch', () => ({ useSearch:() => ({ executeBrowse:fixture.executeBrowse, browseResults:fixture.results, totalCount:0, browseStats:null, browseLoading:false, browseError:fixture.error }) }));
import BrowseVehicles from './BrowseVehicles';
it('applies non-model search constraints and reports query failure distinctly', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div'),root=createRoot(host);
  try {
    fixture.error='Vehicle reader unavailable';
    await act(async () => root.render(<MemoryRouter initialEntries={['/browse?yearMin=1973&yearMax=1987&bodyStyle=Truck&era=1970s']}><BrowseVehicles /></MemoryRouter>));
    expect(fixture.executeBrowse).toHaveBeenCalledWith(expect.objectContaining({yearMin:1973,yearMax:1987,bodyStyle:'Truck',era:'1970s'}));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Vehicle reader unavailable');
    expect(host.textContent).not.toContain('No vehicles');
  } finally { await act(async () => root.unmount());fixture.error=null; }
});
it('opens one source at /browse?source= and reads that source alone, not the all-sources grid', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
  fixture.executeBrowse.mockClear();
  fixture.rpc.mockReset();
  fixture.rpc.mockResolvedValue({ data:{ as_of:'2026-10-20T12:00:00Z', status:'ok', median_floor:5,
    source:{ slug:'example_market', name:'Example Market', category:'marketplace', species:'auth_walled_marketplace', species_label:'Auth-walled marketplaces', unit:'listings held', logo_url:null, base_url:null },
    holdings:{ episodes:19518, vehicles:17663, folded_at:'2026-10-20T09:45:12Z' }, level:'makes', scope:{ make:null, model:null },
    makes:[{ make:'Porsche', episodes:1203 }], models:[], listings:{ total:0, page:1, page_size:60, rows:[] } }, error:null });
  const host=document.createElement('div'),root=createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/browse?source=example_market']}><BrowseVehicles /></MemoryRouter>));
    expect(fixture.rpc).toHaveBeenCalledWith('browse_source_read', expect.objectContaining({ p_source:'example_market', p_make:null, p_model:null }));
    expect(fixture.rpc.mock.calls.map(call => call[0])).not.toContain('treemap_by_brand');
    expect(fixture.executeBrowse).not.toHaveBeenCalled();
    expect(host.querySelector('h1')?.textContent).toBe('Example Market');
    expect(host.textContent).not.toContain('ALL MAKES');
  } finally { await act(async () => root.unmount()); }
});
it('carries make and model into the source read and ignores the all-sources filters', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
  fixture.executeBrowse.mockClear();
  fixture.rpc.mockReset();
  fixture.rpc.mockResolvedValue({ data:{ as_of:'2026-10-20T12:00:00+00:00', status:'ok', median_floor:5,
    source:{ slug:'example_market', name:'Example Market', category:'marketplace', species:'auth_walled_marketplace', species_label:'Auth-walled marketplaces', unit:'listings held', logo_url:null, base_url:null },
    holdings:{ episodes:19518, vehicles:17663, upcoming:0, board:null, folded_at:'2026-10-20T09:45:12+00:00' }, level:'listings', scope:{ make:'Porsche', model:'911', status:null },
    makes:[], models:[], listings:{ total:0, page:1, page_size:60, rows:[] } }, error:null });
  const host=document.createElement('div'),root=createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/browse?source=example_market&make=Porsche&model=911&yearMin=1973&bodyStyle=Truck']}><BrowseVehicles /></MemoryRouter>));
    expect(fixture.rpc).toHaveBeenCalledWith('browse_source_read', { p_source:'example_market', p_make:'Porsche', p_model:'911', p_page:1, p_page_size:60, p_sort:'newest' });
    expect(fixture.executeBrowse).not.toHaveBeenCalled();
    expect(host.textContent).toContain('This source holds no Porsche 911 listings.');
  } finally { await act(async () => root.unmount()); }
});
it('reads a blank source as no source and shows the all-sources page', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
  fixture.executeBrowse.mockClear();
  fixture.rpc.mockReset();
  const host=document.createElement('div'),root=createRoot(host);
  try {
    fixture.error='Vehicle reader unavailable';
    await act(async () => root.render(<MemoryRouter initialEntries={['/browse?source=%20&yearMin=1973&yearMax=1987&bodyStyle=Truck&era=1970s']}><BrowseVehicles /></MemoryRouter>));
    expect(fixture.executeBrowse).toHaveBeenCalledWith(expect.objectContaining({ yearMin:1973, yearMax:1987, bodyStyle:'Truck', era:'1970s' }));
    expect(fixture.rpc.mock.calls.map(call => call[0])).not.toContain('browse_source_read');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Vehicle reader unavailable');
  } finally { await act(async () => root.unmount());fixture.error=null; }
});
