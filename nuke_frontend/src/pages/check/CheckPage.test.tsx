// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from './fixtures/evaluate_listing.json';
import CheckPage from './CheckPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const sse = (result: unknown) => new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function render(url: string) {
  await act(async () => root.render(<MemoryRouter initialEntries={[`/check?url=${encodeURIComponent(url)}`]}><CheckPage /></MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

describe('CheckPage', () => {
  it('refuses a Cars & Bids link without calling the advisor', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await render('https://carsandbids.com/auctions/KDwzE4XM/2024-chevrolet-corvette');
    expect(host.textContent).toContain('Bring a Trailer only for now');
    expect(host.textContent).toContain("Cars & Bids listings aren't supported yet");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls /mcp/advisor anonymously and draws the sold card with comps linking to BaT', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = JSON.parse(String(init.body));
      return body.params.name === 'evaluate_listing' ? sse(fixtures.sold) : sse({ structuredContent: { links: {} } });
    }));
    await render('https://bringatrailer.com/listing/1970-porsche-911t-targa-44/');
    expect(calls[0].url).toBe('/mcp/advisor');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(Object.keys(headers).map(h => h.toLowerCase())).not.toContain('authorization');
    expect(host.textContent).toContain('Sold within what similar cars sold for');
    expect(host.textContent).toContain('$73,411');
    const compLinks = [...host.querySelectorAll('.check-comps a')].map(a => a.getAttribute('href'));
    expect(compLinks.length).toBe(3);
    expect(compLinks.every(h => h?.startsWith('https://bringatrailer.com/listing/'))).toBe(true);
    expect(host.querySelectorAll('.check-comps img[src="/source-logos/bat.png"]').length).toBe(3);
  });

  it('says plainly when there is nothing to price with', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse(fixtures.unpriced)));
    await render('https://bringatrailer.com/listing/go-kart-210/');
    expect(host.textContent).toContain('Not enough sales to price this one');
    expect(host.textContent).not.toContain('Fair price');
  });
});
