// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VehicleCardDense from './VehicleCardDense';

/** The price badge names the kind of money it shows. A bare number was nine kinds at once. */
describe('VehicleCardDense price badge', () => {
  let root: Root, container: HTMLDivElement;
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('IntersectionObserver', Observer);
    vi.stubGlobal('ResizeObserver', Observer); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  async function render(extra: Record<string, unknown>) {
    const vehicle: any = { id: 'v-badge', year: 1973, make: 'Porsche', model: '911', ...extra };
    await act(async () => { root.render(<MemoryRouter><VehicleCardDense vehicle={vehicle} /></MemoryRouter>); });
    return (container.textContent || '').replace(/\s+/g, ' ');
  }

  it('labels an estimate as one', async () => {
    const text = await render({ current_value: 31911 });
    expect(text).toMatch(/EST\s*\$31,911/);
  });
  it('labels an asking price when the vehicle is for sale', async () => {
    const text = await render({ asking_price: 55000, is_for_sale: true });
    expect(text).toMatch(/ASKING\s*\$55,000/);
  });
  it('labels a recorded sale', async () => {
    const text = await render({ sale_price: 112800 });
    expect(text).toMatch(/SOLD\s*\$112,800/);
  });
  it('shows no badge when there is no money to show', async () => {
    const text = await render({});
    expect(text).not.toMatch(/\$\d/);
  });
});
