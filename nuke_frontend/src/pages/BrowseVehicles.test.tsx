// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
const fixture=vi.hoisted(() => ({ executeBrowse:vi.fn(), error:null as string|null, results:[] as any[] }));
vi.mock('../lib/supabase', () => ({supabase:{}}));
vi.mock('../hooks/useViewHistory', () => ({useViewHistory:() => ({recordView:() => {}})}));
vi.mock('../components/layout/hooks/useSearch', () => ({ useSearch:() => ({ executeBrowse:fixture.executeBrowse, browseResults:fixture.results, totalCount:0, browseStats:null, browseLoading:false, browseError:fixture.error }) }));
import BrowseVehicles from './BrowseVehicles';
it('applies non-model search constraints and reports query failure distinctly', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div'),root=createRoot(host);
  try {
    fixture.error='Vehicle reader unavailable';
    await act(async () => root.render(<MemoryRouter initialEntries={['/browse?yearMin=1973&yearMax=1987&bodyStyle=Truck&era=1970s']}><BrowseVehicles /></MemoryRouter>));
    expect(fixture.executeBrowse).toHaveBeenCalledWith(expect.objectContaining({yearMin:1973,yearMax:1987,bodyStyle:'Truck',era:'1970s'}));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Vehicle reader unavailable');
    expect(host.textContent).not.toContain('No vehicles');
  } finally { await act(async () => root.unmount());fixture.error=null; }
});
