// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchStatsBar } from './SearchStatsBar';
import type { BrowseStats } from '../../hooks/useSearchPage';

const base: BrowseStats = {
  total: 50821, with_images: 37600, with_price: 40139, avg_price: 81000,
  by_source: [{ source: 'bat', count: 20000 }], by_era: [{ era: 'air-cooled', count: 12000 }],
  by_model: [{ model: '911', count: 21000, avg_price: 0 }],
};

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

describe('SearchStatsBar: folded counts carry their date', () => {
  it('shows the fold date, with the population on hover', async () => {
    await act(async () => root.render(
      <SearchStatsBar stats={{ ...base, as_of: '2026-10-14T03:40:12Z', population: 'public vehicles of the canonical make Porsche (mv_market_position)' }} make="Porsche" />,
    ));
    expect(container.textContent).toContain('50,821');
    const asOf = Array.from(container.querySelectorAll('span')).find(s => s.textContent?.startsWith('AS OF'));
    expect(asOf?.textContent).toBe('AS OF OCT 14, 2026');
    expect(asOf?.getAttribute('title')).toContain('canonical make Porsche');
  });

  it('a live aggregate has no date to show', async () => {
    await act(async () => root.render(<SearchStatsBar stats={base} make="Obscura" />));
    expect(container.textContent).toContain('50,821');
    expect(container.textContent).not.toContain('AS OF');
  });
});
