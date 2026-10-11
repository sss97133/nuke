// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  tabs: [] as { vehicleId: string; title: string }[],
  navigate: vi.fn(), close: vi.fn(), activate: vi.fn(),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => fixture.navigate }));
vi.mock('./AppLayoutContext', () => ({ useAppLayoutContext: () => ({
  vehicleTabs: fixture.tabs, activeVehicleId: 'porsche',
  closeVehicleTab: fixture.close, setActiveVehicleTab: fixture.activate,
}) }));
import { VehicleTabBar } from './VehicleTabBar';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  fixture.tabs = [{ vehicleId: 'porsche', title: '1997 Porsche 911 Turbo' }];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const mount = async () => { await act(async () => root.render(<VehicleTabBar />)); };

it('does not reserve a tab strip or intercept close-tab for a single vehicle', async () => {
  await mount();
  expect(host.children).toHaveLength(0);
  const close = new KeyboardEvent('keydown', { key: 'w', metaKey: true, cancelable: true });
  document.dispatchEvent(close);
  expect(close.defaultPrevented).toBe(false);
  expect(fixture.close).not.toHaveBeenCalled();
});

it('names the active vehicle and preserves switching and closing between vehicles', async () => {
  fixture.tabs.push({ vehicleId: 'corvette', title: '1963 Chevrolet Corvette' });
  await mount();
  expect(host.querySelector('[aria-current="page"]')!.textContent).toBe('1997 Porsche 911 Turbo');
  await act(async () => host.querySelector<HTMLButtonElement>('[title="1963 Chevrolet Corvette"]')!.click());
  expect(fixture.navigate).toHaveBeenLastCalledWith('/vehicle/corvette');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close tab"]')!.click());
  expect(fixture.close).toHaveBeenCalledWith('porsche');
  expect(fixture.activate).toHaveBeenLastCalledWith('corvette');
  expect(fixture.navigate).toHaveBeenLastCalledWith('/vehicle/corvette');
});
