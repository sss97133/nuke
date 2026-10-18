// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
import { CommentsPopup } from './CommentsPopup';

const vehicleId = '00000000-0000-4000-8000-00000000c001';
const refusal = 'Synthetic comments read refused';
const retained = [
  { comment_id: 'synthetic-bid', comment_text: 'Alpha original bid text.', observed_at: '2019-09-12T12:00:00Z',
    author_username: 'Bidder', comment_type: 'bid', bid_amount: 12345, is_seller: false, platform: 'bat' },
  { comment_id: 'synthetic-seller', comment_text: 'Beta original seller text.', observed_at: '2019-09-11T12:00:00Z',
    author_username: 'Owner', comment_type: 'comment', bid_amount: null, is_seller: true, platform: 'carsandbids' },
];
type Read = { url: URL; resolve: (response: Response) => void };
let root: Root, host: HTMLDivElement, reads: Read[], frames: { summary: ReturnType<typeof summary>; body: string | null }[];
const main = () => host.firstElementChild as HTMLElement;
const summary = () => { const spans = main().children[0].children[0].querySelectorAll('span'); return {
  label: spans[0].textContent!.trim(), value: spans[1].textContent!.trim(), qualifier: spans[2]?.textContent!.trim() ?? null,
}; };
const body = () => main().children[1] as HTMLElement;
const rows = () => [...body().querySelectorAll<HTMLElement>('[style*="border-left"]')];
const expectedRows = () => [
  `Bidder$${Number(12345).toLocaleString()}bat${new Date(retained[0].observed_at).toLocaleDateString()}${retained[0].comment_text}`,
  `OwnerSELLERcarsandbids${new Date(retained[1].observed_at).toLocaleDateString()}${retained[1].comment_text}`,
];
async function draw(searchQuery?: string, expectedCount: number | undefined = 4) {
  await act(async () => root.render(<React.Profiler id="comments" onRender={() => frames.push({ summary: summary(), body: body().textContent })}>
    <CommentsPopup vehicleId={vehicleId} expectedCount={expectedCount} searchQuery={searchQuery} />
  </React.Profiler>));
}
async function settle(data: unknown = retained, status = 200) {
  await act(async () => reads[0].resolve(new Response(JSON.stringify(status === 200 ? data : { code: '42501', message: refusal }),
    { status, headers: { 'Content-Type': 'application/json' } })));
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; reads = []; frames = [];
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  fixture.client = createClient('https://comments-read.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'synthetic-comments-read' },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(init?.method ?? 'GET').toBe('GET'); expect(url.pathname).toBe('/rest/v1/vehicle_comments_unified');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        select: 'comment_id,comment_text,observed_at,author_username,comment_type,bid_amount,is_seller,platform',
        vehicle_id: `eq.${vehicleId}`, order: 'observed_at.desc', limit: '200',
      });
      return new Promise<Response>(resolve => reads.push({ url, resolve }));
    } },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it('comments-read: scopes the first pending summary without changing its loading count or body', async () => {
  await draw(); expect(frames[0]).toEqual({ summary: { label: 'IN THIS READ', value: '...', qualifier: null }, body: 'Loading comments...' });
  expect(reads).toHaveLength(1);
});
it('comments-read: refuses a numeric-zero count when the actual current read errors', async () => {
  await draw(); await settle([], 403); expect(summary().value).toBe('?');
  expect(summary().qualifier).toBe('/ 4 expected'); expect(body().textContent).toBe(refusal); expect(reads).toHaveLength(1);
});
it('comments-read: labels the successful limited count without changing expectedCount', async () => {
  await draw(); await settle(); expect(summary()).toEqual({ label: 'IN THIS READ', value: '2', qualifier: '/ 4 expected' }); expect(reads).toHaveLength(1);
});
it('comments-read: qualifies a successful empty current read without an extraction-absence claim', async () => {
  await draw(); await settle([]); expect(body().textContent).toBe('No comments in this read.');
  expect(summary().value).toBe('0'); expect(summary().qualifier).toBe('/ 4 expected'); expect(rows()).toHaveLength(0); expect(reads).toHaveLength(1);
});
it('comments-read: qualifies local no-match without changing its successful denominator or query', async () => {
  await draw(); await settle(); await draw('unmatched phrase'); expect(body().textContent).toBe('No matching comments in this read.');
  expect(summary().value).toBe('0'); expect(summary().qualifier).toBe('/ 2'); expect(reads).toHaveLength(1);
});
it('comments-read: preserves retained row text, authors, event dates, bid and seller widgets', async () => {
  const raw = structuredClone(retained); await draw(); await settle();
  expect(rows().map(row => row.textContent)).toEqual(expectedRows());
  expect(rows().map(row => row.lastElementChild!.textContent)).toEqual(retained.map(row => row.comment_text));
  expect(rows()[0].style.borderLeft).toBe('3px solid rgb(42, 111, 160)'); expect(rows()[1].style.borderLeft).toBe('3px solid rgb(138, 0, 32)');
  expect([...main().children[0].children].slice(1).map(widget => widget.textContent)).toEqual(['BIDS1', 'SELLER1']);
  expect(retained).toEqual(raw); expect(reads).toHaveLength(1);
});
it.each([
  { search: '  ALPHA  ', index: 0, widgets: ['BIDS1'] },
  { search: ' oWnEr ', index: 1, widgets: ['SELLER1'] },
])('comments-read: preserves local text/author search $search without another read', async ({ search, index, widgets }) => {
  await draw(); await settle(); await draw(search);
  expect(summary().value).toBe('1'); expect(summary().qualifier).toBe('/ 2'); expect(rows().map(row => row.textContent)).toEqual([expectedRows()[index]]);
  expect([...main().children[0].children].slice(1).map(widget => widget.textContent)).toEqual(widgets); expect(reads).toHaveLength(1);
});
it.each([
  { expected: null, qualifier: null }, { expected: 2, qualifier: null },
  { expected: 0, qualifier: '/ 0 expected' }, { expected: 4, qualifier: '/ 4 expected' },
])('comments-read: preserves existing expectedCount=$expected semantics', async ({ expected, qualifier }) => {
  // null here means an omitted optional prop; draw's default is used only by other controls.
  await act(async () => root.render(<CommentsPopup vehicleId={vehicleId} expectedCount={expected === null ? undefined : expected} />));
  await settle(); expect(summary().value).toBe('2'); expect(summary().qualifier).toBe(qualifier); expect(reads).toHaveLength(1);
});
it('comments-read: preserves the existing raw error body and request boundary', async () => {
  await draw(); await settle([], 403); expect(body().textContent).toBe(refusal); expect(rows()).toHaveLength(0); expect(reads).toHaveLength(1);
});
it('comments-read: keeps a pending current read useful across search and expected-count prop changes', async () => {
  await draw(); await draw('alpha', 8); expect(reads).toHaveLength(1); await settle();
  expect(summary().value).toBe('1'); expect(summary().qualifier).toBe('/ 2'); expect(rows().map(row => row.textContent)).toEqual([expectedRows()[0]]); expect(reads).toHaveLength(1);
});
it('comments-read: preserves cancellation when a popup closes before its response', async () => {
  await draw(); await act(async () => root.render(null)); await settle([], 403); expect(host.textContent).toBe(''); expect(reads).toHaveLength(1);
});

it.each([
  { name: 'null projected author', value: null, label: 'Author unavailable' },
  { name: 'omitted projected author', value: undefined, label: 'Author unavailable' },
  { name: 'empty projected author', value: '', label: 'Author unavailable' },
  { name: 'reported name', value: 'Alpha', label: 'Alpha' },
  { name: 'literal reported Anonymous', value: 'Anonymous', label: 'Anonymous' },
  { name: 'literal reported whitespace', value: '   ', label: '   ' },
])('author-read: preserves source facts for $name', async ({ value, label }) => {
  const row: Record<string, unknown> = { ...retained[0] };
  if (value === undefined) delete row.author_username;
  else row.author_username = value;
  const raw = structuredClone(row); await draw(undefined, 1); expect(body().textContent).toBe('Loading comments...');
  await settle([row]); expect(rows()).toHaveLength(1);
  const author = rows()[0].firstElementChild!.querySelector('span')!;
  // Inspect the actual untrimmed author span: whitespace is a retained literal, not the empty-string fallback.
  expect(author.textContent).toBe(label);
  expect(rows()[0].textContent).toBe(`${label}$${Number(12345).toLocaleString()}bat${new Date(retained[0].observed_at).toLocaleDateString()}${retained[0].comment_text}`);
  expect(rows()[0].lastElementChild!.textContent).toBe(retained[0].comment_text);
  expect(summary().value).toBe('1'); expect(summary().qualifier).toBeNull(); expect(row).toEqual(raw); expect(reads).toHaveLength(1);
});
