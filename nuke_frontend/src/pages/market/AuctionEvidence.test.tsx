// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ query: {} as any, activity: {} as any }));
vi.mock('../../hooks/useAuctionComments', () => ({ EPISODE_READ_LIMIT: 100, useAuctionEpisode: () => fixture.query }));
vi.mock('./useLotMovement', () => ({ useLotMovement: () => fixture.activity }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, ...p }: any) => <a href={to} {...p} /> }));
import AuctionEvidence from './AuctionEvidence';
let root: Root, container: HTMLDivElement;
const id = '46dd9cc6-20ec-47cb-a563-159a8005115c';
const source = 'https://bringatrailer.com/listing/1937-packard-115c-convertible-8/';
function row(id: string, type: string, at: string | null, extra = {}) {
  return { id, comment_type: type, posted_at: at, comment_text: null, bid_amount: null, media_urls: null,
    is_seller: false, bat_comment_id: 123, source_url: source, ...extra };
}
async function render() { await act(async () => root.render(<AuctionEvidence vehicleId={id} onClose={() => {}} />)); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.query = { data: { vehicle: { id, title: 'Public source case' }, sourceUrl: source, fetchedAt: '2026-10-04T17:00:00Z',
    truncated: false, specs: [{ field: 'transmission', label: 'Transmission', value: null, reported_value: '700R4',
      source_observation_id: id, reported_conflict: true }], interactions: [
      row('b2', 'bid', '2026-10-04T11:00:00Z', { bid_amount: 2000 }),
      row('seller', 'seller_response', '2026-10-04T10:30:00Z', { media_urls: ['https://example.com/video.mp4', 'javascript:alert(1)'] }),
      row('q1', 'question', '2026-10-04T10:20:00Z', { comment_text: 'Which component is leaking?' }),
      row('b1', 'bid', '2026-10-04T10:00:00Z', { bid_amount: 1000 }),
      row('unknown-date', 'bid', null, { bid_amount: 500 }),
    ] } };
  fixture.activity = { coverage: { lots: [] } };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('draws only dated source bids, preserves unknown/conflict and links the selected bid', async () => {
  await render();
  expect(container.querySelectorAll('svg [role="button"]')).toHaveLength(2);
  expect(container.textContent).toContain('Canonical unknown');
  expect(container.textContent).toContain('Reported: 700R4');
  expect(container.textContent).toContain('Conflicting reports');
  expect(container.textContent).not.toMatch(/Running hot|Running cold|fair value|[0-9]×/);
  await act(async () => container.querySelector('svg [role="button"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(container.querySelector('.auction-evidence-event')?.textContent).toContain('1,000');
  expect(container.querySelector('.auction-evidence-event a')?.getAttribute('href')).toBe(source + '#comment-123');
});
it('keeps chronological multi-part questions and empty-text media replies without inventing a pair or stance', async () => {
  await render();
  const articles = [...container.querySelectorAll('article')];
  expect(articles[0].textContent).toContain('Which component is leaking?');
  expect(articles[1].textContent).toContain('Seller statement');
  expect(articles[1].querySelector('.auction-evidence-media')?.getAttribute('href')).toBe('https://example.com/video.mp4');
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(container.textContent).toContain('adjacent statements are not automatically an answer pair');
  expect(container.textContent).toContain('No measured commentary score yet');
});
it('separates source capture from browser response and refuses completeness from a full read', async () => {
  fixture.activity.coverage.lots = [{ vehicle_id: id, source_url: source, source_read_at: '2026-10-03T10:00:00Z', source_read_basis: 'cached_snapshot' }];
  fixture.query.data.truncated = true;
  await render();
  expect(container.textContent).toContain('Earlier interactions omitted by the limit');
  const times = [...container.querySelectorAll('.auction-evidence-receipt time')].map(t => t.getAttribute('datetime'));
  expect(times).toEqual(['2026-10-04T17:00:00Z', '2026-10-03T10:00:00Z']);
  expect(container.textContent).toContain('cached snapshot');
});
it('does not lend a newer listing clock to another episode on the same vehicle', async () => {
  fixture.activity.coverage.lots = [{ vehicle_id: id, source_url: 'https://bringatrailer.com/listing/another-episode/',
    source_read_at: '2026-10-03T10:00:00Z', source_read_basis: 'direct_fetch' }];
  await render();
  expect(container.querySelectorAll('.auction-evidence-receipt time')).toHaveLength(1);
  expect(container.textContent).toContain('Listing-page read time unavailable');
});
it('exposes reported disagreement with a populated canonical field and identifies a missing source anchor', async () => {
  fixture.query.data.specs[0].value = 'Canonical transmission';
  fixture.query.data.interactions[3].bat_comment_id = null;
  await render();
  expect(container.textContent).toContain('Canonical transmission');
  expect(container.textContent).toContain('Reported: 700R4');
  const buttons = container.querySelectorAll('svg [role="button"]');
  expect([...buttons].filter(b => b.getAttribute('tabindex') === '0')).toHaveLength(1);
  await act(async () => buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(container.querySelector('.auction-evidence-event a')?.textContent).toContain('event anchor unavailable');
  expect(container.querySelector('.auction-evidence-event a')?.getAttribute('href')).toBe(source);
});
it('handles denial, empty, loading and failed reads explicitly', async () => {
  fixture.query = { data: null }; await render();
  expect(container.textContent).toContain('No publicly readable BaT vehicle listing');
  expect(container.querySelector('svg')).toBeNull();
  fixture.query = { isPending: true }; await render(); expect(container.textContent).toContain('Reading listing evidence');
  fixture.query = { isError: true }; await render(); expect(container.textContent).toContain('could not be read');
  fixture.query = { data: { vehicle: { id, title: 'Empty public case' }, sourceUrl: source, specs: [], interactions: [] } };
  await render(); expect(container.textContent).toContain('No dated bids'); expect(container.textContent).toContain('Capture completeness unknown');
});
it('connects recorded identity to sale context with subject exclusion, without lending the bid units', async () => {
  fixture.query.data.vehicle = { id, title: 'Public source case', year: 1937, make: 'Packard', model: 'Series 115-C Convertible Coupe', high_bid: 45000 };
  await render();
  const link = container.querySelector<HTMLAnchorElement>('a[href^="/valuation?"]')!;
  const params = new URL(link.href).searchParams;
  expect(params.get('year')).toBe('1937');
  expect(params.get('make')).toBe('Packard');
  expect(params.get('model')).toBe('Series 115-C Convertible Coupe');
  expect(params.get('vehicle_id')).toBe(id);
  expect(params.has('price')).toBe(false);
  expect(params.has('currency')).toBe(false);
});

it('keeps the first inspection concise and puts the outbound listing behind Sources', async () => {
  const scroll = vi.fn(); const previous = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  fixture.query.data.vehicle = { id, year: 1937, make: 'Packard', model: '115-C', title: 'Promotional source headline' };
  fixture.query.data.specs[0].rooted = true;
  try {
    await act(async () => root.render(<AuctionEvidence vehicleId={id} compact onClose={() => {}} />));
    expect(container.querySelector('section')?.id).toBe(`lot-inspection-${id}`);
    expect(container.textContent).toContain('Latest recorded bid 2,000');
    expect(container.textContent).toContain('+1,000 from the previous retained bid');
    expect(container.querySelector('a[href^="https://bringatrailer.com"]')).toBeNull();
    expect(container.querySelector('.auction-evidence-layout')).toBeNull();
    expect(container.querySelector('svg')?.closest('details')?.open).toBe(false);
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => [...container.querySelectorAll('nav button')].find(b => b.textContent === 'Vehicle')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).toContain('1937 Packard 115-C');
    expect(container.textContent).toContain('Reports differ');
    expect(container.textContent).not.toContain('Promotional source headline');
    await act(async () => [...container.querySelectorAll('nav button')].find(b => b.textContent === 'Sources')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('a[href^="https://bringatrailer.com"]')?.getAttribute('href')).toBe(source);
    expect(container.textContent).toContain('Promotional source headline');
  } finally { HTMLElement.prototype.scrollIntoView = previous; }
});
