// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedToolbar, type FeedToolbarProps } from './FeedToolbar';

let root: Root, host: HTMLDivElement, props: FeedToolbarProps;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  props = { sort: 'newest', direction: 'desc', viewMode: 'grid', cardsPerRow: 2, fontSize: 14,
    showScores: false, imageFit: 'auto', onSortChange: vi.fn(), onDirectionChange: vi.fn(),
    onViewModeChange: vi.fn(), onCardsPerRowChange: vi.fn(), onFontSizeChange: vi.fn(),
    onToggleScores: vi.fn(), onImageFitChange: vi.fn(), onHeroPanelToggle: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(next: Partial<FeedToolbarProps> = {}) {
  props = { ...props, ...next }; await act(async () => root.render(<FeedToolbar {...props} />));
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(el => el.textContent === text)!;
  await act(async () => button.click());
}

describe('feed display controls', () => {
  it('names each view and exposes selection while preserving the existing callbacks', async () => {
    await render();
    expect(host.querySelector('[aria-label="Grid view"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[aria-label="Table view"]')?.getAttribute('aria-pressed')).toBe('false');
    await click('Table'); expect(props.onViewModeChange).toHaveBeenCalledWith('technical');
    await render({ viewMode: 'technical' });
    expect(host.querySelector('[aria-label="Sort vehicles"]')).toBeNull();
    expect(host.querySelector('[aria-label="Table view"]')?.getAttribute('aria-pressed')).toBe('true');
  });
  it('allows one or two columns and legible text sizes through labelled native sliders', async () => {
    await render();
    const columns = host.querySelector<HTMLInputElement>('[aria-label="Vehicle columns"]')!;
    expect(columns.min).toBe('1'); expect(columns.max).toBe('12'); expect(columns.value).toBe('2');
    const text = host.querySelector<HTMLInputElement>('[aria-label="Card text size"]')!;
    expect(text.max).toBe('18'); expect(text.value).toBe('14');
    expect(text.getAttribute('aria-valuetext')).toBe('14 pixels');
  });
  it('preserves sort-panel opening, closing and rank direction behavior', async () => {
    await render(); await click('Newest ↓'); expect(props.onHeroPanelToggle).toHaveBeenCalledWith('newest');
    await render({ activeHeroPanel: 'newest' }); await click('Newest ↓');
    expect(props.onHeroPanelToggle).toHaveBeenLastCalledWith(null);
    await render({ sort: 'popular' }); await click('Rank ↓');
    expect(props.onDirectionChange).toHaveBeenCalledWith('asc');
    await click('Deals'); expect(props.onSortChange).toHaveBeenCalledWith('deal_score');
    expect(props.onHeroPanelToggle).toHaveBeenLastCalledWith('deal_score');
  });
  it('cycles fit, exposes score selection and routes For you to the existing finds sort', async () => {
    await render({ hasInterests: true }); await click('For you');
    expect(props.onSortChange).toHaveBeenCalledWith('finds');
    await click('Images: Auto'); expect(props.onImageFitChange).toHaveBeenCalledWith('cover');
    await click('Show scores'); expect(props.onToggleScores).toHaveBeenCalledOnce();
    await render({ showScores: true });
    expect([...host.querySelectorAll('button')].find(el => el.textContent === 'Hide scores')?.getAttribute('aria-pressed')).toBe('true');
  });
});
