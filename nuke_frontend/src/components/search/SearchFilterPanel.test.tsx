// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SearchFilterPanel } from './SearchFilterPanel';
import type { VehicleFilters } from '../../hooks/useSearchPage';
it('exposes the filter disclosure, labelled fields, status selection and clear action', async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  function Harness(){const [filters,set]=useState<VehicleFilters>({make:'',priceMin:'',priceMax:'',yearMin:'',yearMax:'',mileageMax:'',transmission:'',listingStatus:'',showFilters:false});return <SearchFilterPanel filters={filters} onChange={set} vehicleCount={12} displayVehicleCount={4}/>;}
  try {
    await act(async()=>root.render(<Harness/>)); const toggle=host.querySelector<HTMLButtonElement>('[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await act(async()=>toggle.click()); expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[id="'+toggle.getAttribute('aria-controls')+'"]')).not.toBeNull();
    for(const name of ['Make','Minimum recorded price','Maximum recorded price','Earliest year','Latest year','Maximum mileage','Transmission']) expect(host.querySelector('[aria-label="'+name+'"]')).not.toBeNull();
    const sold=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Sold')!;
    await act(async()=>sold.click()); expect(sold.getAttribute('aria-pressed')).toBe('true');
    const clear=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Clear all')!;
    await act(async()=>clear.click()); expect(sold.getAttribute('aria-pressed')).toBe('false'); expect(host.textContent).toContain('12 loaded vehicles');
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
