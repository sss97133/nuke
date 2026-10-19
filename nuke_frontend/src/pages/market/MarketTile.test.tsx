// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MarketCard, VenueMix, type MarketNode } from './MarketTile';

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

// treemap_populations().by_house as skylar-b7 measured it on the v2 fold (2026-10-15).
const byHouse = [
  { house: 'Bring a Trailer', sales: 183497, amount: 1 }, { house: 'Mecum', sales: 61811, amount: 1 },
  { house: 'Barrett-Jackson', sales: 29782, amount: 1 }, { house: 'Cars & Bids', sales: 18833, amount: 1 },
  { house: 'Gooding & Co', sales: 6853, amount: 1 }, { house: 'Bonhams', sales: 5790, amount: 1 },
  { house: 'PCarMarket', sales: 2416, amount: 1 }, { house: "RM Sotheby's", sales: 920, amount: 1 }, { house: null, sales: 3532, amount: 1 },
];

it('shows each larger house\'s share of the map\'s sales, the rest grouped, with the total and the refresh clock', async () => {
  await act(async () => root.render(<VenueMix rows={byHouse} clock=" · updated 7 h ago" />));
  const names = [...container.querySelectorAll('.venue-mix__names > span')].map((s) => s.textContent);
  expect(names.slice(0, 6)).toEqual(['Bring a Trailer 59%', 'Mecum 20%', 'Barrett-Jackson 10%', 'Cars & Bids 6%', 'Gooding & Co 2%', 'Bonhams 2%']);
  // PCarMarket (0.8%), RM (0.3%) and the venue-unrecorded 1.1% go to the rest, which is never colored as a house.
  expect(names).toContain('rest 2%');
  expect(names[names.length - 1]).toBe('313,434 confirmed sales with an amount · updated 7 h ago');
  expect(container.querySelectorAll('.venue-mix__seg')).toHaveLength(7);
  expect(container.querySelector('.venue-mix__bar')?.getAttribute('title')).toContain('Bring a Trailer: 183,497 (59%)');
});

it('stays away until the refresh writes the houses', async () => {
  await act(async () => root.render(<VenueMix rows={undefined} clock="" />));
  expect(container.querySelector('.venue-mix')).toBeNull();
  await act(async () => root.render(<VenueMix rows={[]} clock="" />));
  expect(container.querySelector('.venue-mix')).toBeNull();
});

const aggregate: MarketNode = {
  name: 'Porsche more families', familyKey: 'more', count: 125, usd: 12_500_000,
  sold_12m: 60, sold_prior_12m: 40, usd_12m: 3_000_000, usd_prior_12m: 2_000_000,
};

it.each(['more', 'other'])('qualifies %s without denying its measured sales or dropping its ledger', async (familyKey) => {
  await act(async () => root.render(<MarketCard node={{ ...aggregate, familyKey }} move={{ kind: 'none' }} base={null} x={0} y={0} />));
  expect(container.querySelector('.market-card__move')?.textContent).toContain('no single-family comparison');
  expect(container.querySelector('.market-card__move')?.textContent).not.toContain('no measured sales');
  expect(container.querySelector('.market-card__rows')?.textContent).toContain('$3M vs $2M (▲50%)');
  expect(container.querySelector('.market-card__rows')?.textContent).toContain('125 confirmed sales · $12.5M · all venues and years');
});

it.each(['more', 'other'])('withholds unchanged %s aggregate dollars under a custom window', async (familyKey) => {
  await act(async () => root.render(<MarketCard node={{ ...aggregate, familyKey }} move={{ kind: 'none' }} base={null} x={0} y={0}
    windowLabel="sales over the last 3 months against the 3 months before" />));
  expect(container.querySelector('.market-card__window')?.textContent).toContain('last 3 months');
  expect([...container.querySelectorAll('dt')].map((dt) => dt.textContent)).not.toContain('measured dollars');
  expect(container.querySelector('.market-card__move')?.textContent).toBe('no single-family comparison');
  expect(container.querySelector('.market-card__rows')?.textContent).toContain('125 confirmed sales · $12.5M · all venues and years');
});

it('retains the no-measured-sales answer for an ordinary node without measured sales', async () => {
  await act(async () => root.render(<MarketCard node={{ ...aggregate, familyKey: 'f911', sold_12m: 0, sold_prior_12m: 0, usd_12m: 0, usd_prior_12m: 0 }}
    move={{ kind: 'none' }} base={null} x={0} y={0} />));
  expect(container.querySelector('.market-card__move')?.textContent).toBe('no measured sales');
  expect([...container.querySelectorAll('dt')].map((dt) => dt.textContent)).not.toContain('measured dollars');
});

it('retains an ordinary family’s overridden dollars for its selected window', async () => {
  await act(async () => root.render(<MarketCard node={{ ...aggregate, familyKey: 'f911' }}
    move={{ kind: 'move', sold: 60, prior: 40, raw: 0.5, rel: 0.5 }} base={null} x={0} y={0}
    windowLabel="sales over the last 3 months against the 3 months before" />));
  expect(container.querySelector('.market-card__move')?.textContent).toContain('▲50% against the market');
  expect(container.querySelector('.market-card__rows')?.textContent).toContain('$3M vs $2M (▲50%)');
});
