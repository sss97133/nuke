// @vitest-environment jsdom
import React, { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FeedVehicle } from '../../feed/types/feed';
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: async () => ({ data: null, error: null }) } }));
vi.mock('../../hooks/useViewHistory', () => ({ useViewHistory: () => ({ recordView() {}, endView() {} }) }));
vi.mock('../../hooks/useInterests', () => ({ useInterests: () => ({ recordInterest() {} }) }));
vi.mock('./MakePopup', () => ({ MakePopup: () => null }));
vi.mock('./ModelPopup', () => ({ ModelPopup: () => null }));
vi.mock('./SourcePopup', () => ({ SourcePopup: () => null }));
import { PopupStackContext, PopupStackProvider } from './PopupStack';
import { VehiclePopup } from './VehiclePopup';
const vehicle = { id: '00000000-0000-4000-8000-000000000001', year: 2000, make: 'Ford', model: 'Coupe' } as FeedVehicle;
let host: HTMLDivElement, root: Root;
function Launcher() {
  const stack = useContext(PopupStackContext)!;
  const location = useLocation();
  return <><output>{location.pathname}</output><button onClick={() => {
    stack.push(<p>Earlier source record</p>, 'Source');
    stack.push(<VehiclePopup vehicle={vehicle} />, 'Vehicle');
  }}>Open preview</button></>;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={['/market']}><PopupStackProvider><Launcher /></PopupStackProvider></MemoryRouter>));
  await act(async () => host.querySelector('button')!.click());
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const profile = () => document.querySelector<HTMLAnchorElement>(`a[href="/vehicle/${vehicle.id}"]`)!;
it('opens the full profile in the current route and clears every covering popup', async () => {
  await act(async () => profile().click());
  expect(host.querySelector('output')?.textContent).toBe(`/vehicle/${vehicle.id}`);
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  expect(document.body.textContent).not.toContain('Earlier source record');
});
it.each([{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}])('preserves the current stack for modified or auxiliary activation: %j', async modifiers => {
  const stopNative = (event: Event) => event.preventDefault();
  document.addEventListener('click', stopNative, { once: true });
  await act(async () => profile().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...modifiers })));
  expect(host.querySelector('output')?.textContent).toBe('/market');
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
});
