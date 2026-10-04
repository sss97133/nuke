// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../hooks/useVehiclesDashboard', () => ({ useVehiclesDashboard: () => ({}) }));
vi.mock('../components/onboarding/OnboardingSlideshow', () => ({ OnboardingSlideshow: () => null }));
vi.mock('./market/MarketPulse', () => ({ default: () => <div role="region" aria-label="Market screen" /> }));
vi.mock('../feed/components/FeedPage', () => ({ default: () => <div role="region" aria-label="Feed screen" /> }));
vi.mock('../components/garage/GarageTab', () => ({ default: () => <div role="region" aria-label="Garage screen" /> }));
vi.mock('./intake/IntakePage', () => ({ default: () => null }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import HomePage from './HomePage';
let root: Root, container: HTMLDivElement;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  // Node 25 exposes a native storage placeholder to Vitest's worker. Supply
  // browser storage for this navigation test instead of using that host API.
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    clear: () => saved.clear(),
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render() {
  await act(async () => root.render(<BrowserRouter><HomePage /></BrowserRouter>));
}
async function navigate(url: string) {
  await act(async () => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}
function screen() { return container.querySelector('[role="region"]')?.getAttribute('aria-label'); }

describe('public market navigation', () => {
  it('opens the market on arrival even when a previous session saved Garage', async () => {
    localStorage.setItem('nuke_hub_tab_v2', 'garage');
    await render();
    expect(screen()).toBe('Market screen');
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe('Market');
  });
  it('updates the displayed screen for header navigation and history changes', async () => {
    await render();
    await navigate('/?tab=feed&make=Porsche');
    expect(screen()).toBe('Feed screen');
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe('Feed');
    await navigate('/?tab=garage');
    expect(screen()).toBe('Garage screen');
    await navigate('/?tab=market&make=Porsche');
    expect(screen()).toBe('Market screen');
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(1);
  });
  it('uses real links on mobile and defaults an unsupported tab to the market', async () => {
    await navigate('/?tab=invalid');
    await render();
    expect(screen()).toBe('Market screen');
    const feed = container.querySelector<HTMLAnchorElement>('a[href="/?tab=feed"]')!;
    await act(async () => feed.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
    expect(screen()).toBe('Feed screen');
    expect(window.location.search).toBe('?tab=feed');
  });
});
