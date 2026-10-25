// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroNewestPanel } from './HeroNewestPanel';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc } }));

// Synthetic values in the shape returned by public.hero_newest(): SQL aliases
// are cnt/cnt_1h, and the make cohort is make_ingest (not make_heatmap).
const response = {
  total_24h: 48, total_1h: 7,
  source_flow: [{ source: 'bat', cnt: 31, cnt_1h: 4 }],
  make_ingest: [{ make: 'Porsche', cnt: 19 }],
  price_brackets: [{ bracket: 'UNDER $5K', cnt: 11 }],
};
let host: HTMLDivElement, root: Root, client: QueryClient;
let onFilter: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    disconnect() {}
  });
  rpc.mockReset(); rpc.mockResolvedValue({ data: response, error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  onFilter = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><HeroNewestPanel onFilter={onFilter} /></QueryClientProvider>));
  await settle();
}
async function clickText(text: string) {
  const target = [...host.querySelectorAll('span, div')].find(el => el.textContent === text)!;
  expect(target).toBeTruthy();
  await act(async () => target.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('Newest intake reader contract', () => {
  it('renders the real RPC shape and keeps source, make and price drill actions', async () => {
    await render();
    expect(rpc).toHaveBeenCalledWith('hero_newest');
    expect(host.textContent).toContain('+48 LAST 24 HOURS');
    expect(host.textContent).toContain('+7 LAST HOUR');
    expect(host.textContent).toContain('+31');
    expect(host.textContent).toContain('Porsche');
    expect(host.textContent).toContain('+19');
    expect(host.textContent).toContain('11');
    await clickText('BAT'); expect(onFilter).toHaveBeenLastCalledWith({ sources: ['bat'], sort: 'newest' });
    await clickText('Porsche'); expect(onFilter).toHaveBeenLastCalledWith({ makes: ['Porsche'], sort: 'newest' });
    await clickText('UNDER $5K'); expect(onFilter).toHaveBeenLastCalledWith({ priceMax: 5000, sort: 'price_low' });
  });
  it('renders a known empty SQL aggregate as zero', async () => {
    rpc.mockResolvedValue({ data: { total_24h: 0, total_1h: 0, source_flow: null, make_ingest: null, price_brackets: null }, error: null });
    await render(); expect(host.textContent).toContain('+0 LAST 24 HOURS');
  });
  it('preserves unavailable totals without claiming zero', async () => {
    rpc.mockResolvedValue({ data: { ...response, total_24h: null, total_1h: undefined }, error: null });
    await render();
    expect(host.textContent).toContain('24-hour total unavailable');
    expect(host.textContent).not.toContain('+0');
    expect(host.textContent).not.toContain('LAST HOUR');
  });
  it('contains malformed counts and retries without replacing unknown values with zero', async () => {
    rpc.mockResolvedValue({ data: { ...response, source_flow: [{ source: 'bat' }] }, error: null });
    await render();
    expect(host.textContent).toContain('Intake summary is unavailable');
    expect(host.textContent).not.toContain('+0');
    rpc.mockResolvedValue({ data: response, error: null });
    await act(async () => host.querySelector('button')!.click()); await settle();
    expect(host.textContent).toContain('+48 LAST 24 HOURS');
  });
  it('shows a recoverable message when the reader fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Unavailable' } });
    await render();
    expect(host.textContent).toContain('You can still browse the feed.');
    expect(host.querySelector('button')?.textContent).toBe('Try again');
  });
});
