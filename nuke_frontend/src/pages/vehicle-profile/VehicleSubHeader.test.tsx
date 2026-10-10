// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ vehicle: { id: 'synthetic-public-vehicle', canonical_body_style: 'COUPE', engine_size: '3.6L Flat-Six', transmission: '6-Speed Manual', drivetrain: 'AWD', city: 'Example City', state: 'CA' } }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => fixture }));
vi.mock('../../components/vehicle/OdometerBadge', () => ({ OdometerBadge: () => null }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../stacks/VehicleCohort', () => ({ VehiclePerformance: ({vehicleId,facet}:any) => <div data-subject={vehicleId} data-dimension={facet.dimension} data-value={facet.value}>Scoped stack</div> }));
import VehicleSubHeader from './VehicleSubHeader';
let root:Root, host:HTMLDivElement;
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
  await act(async()=>root.render(<VehicleSubHeader/>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('opens the actual attribute dimension and selected vehicle, with one reversible drawer', async()=>{
  const buttons=[...host.querySelectorAll<HTMLButtonElement>('.vp-facet-button')];
  const dimensions=['body_style','engine','transmission','drivetrain','location'];
  for(let i=0;i<buttons.length;i++) {
    await act(async()=>buttons[i].click());
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    const stack=host.querySelector('[data-dimension]')!;
    expect(stack.getAttribute('data-dimension')).toBe(dimensions[i]);
    expect(stack.getAttribute('data-subject')).toBe('synthetic-public-vehicle');
    expect(buttons[i].getAttribute('aria-expanded')).toBe('true');
  }
  expect(host.querySelector('[data-value]')!.getAttribute('data-value')).toBe('Example City, CA');
  await act(async()=>buttons[4].click());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it('can switch doors on mousedown without outside-dismiss toggling them closed',async()=>{
  const buttons=host.querySelectorAll<HTMLButtonElement>('.vp-facet-button');
  await act(async()=>buttons[0].click());
  await act(async()=>{buttons[1].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));buttons[1].click();});
  expect(host.querySelector('[data-dimension]')!.getAttribute('data-dimension')).toBe('engine');
  expect(buttons[0].getAttribute('aria-expanded')).toBe('false');
});
it('dismisses on Escape or an outside click and keeps the drawer outside the scroll-clipping badge row',async()=>{
  const button=host.querySelector<HTMLButtonElement>('.vp-facet-button')!;
  await act(async()=>button.click());
  expect(host.querySelector('[role="dialog"]')!.closest('.vp-sub-header__badges')).toBeNull();
  await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(button.getAttribute('aria-expanded')).toBe('false');
  await act(async()=>button.click());
  await act(async()=>document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
