// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }));
import { PriceBreakdownPopup } from './VideoMomentPopups';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it.each(['mecum', 'barrett_jackson', 'unrecorded-house', undefined])(
  'withholds fees and proceeds without lot-specific terms for %s', async source => {
    await act(async () => root.render(
      <PriceBreakdownPopup hammerPrice={100000} source={source} onClose={() => {}} />,
    ));
    const text = document.body.textContent;
    expect(text).toContain('Hammer Price$100,000');
    expect(text).toContain('Fees and proceedsUnrecorded');
    expect(text).not.toContain('Buyer Total');
    expect(text).not.toContain('Seller Net');
    expect(text).not.toContain('House Take');
    expect(text).not.toContain('$110,000');
    expect(text).not.toContain('$89,650');
  },
);

it('preserves the supplied amount and source estimate without inventing fee terms', async () => {
  await act(async () => root.render(
    <PriceBreakdownPopup hammerPrice={100000} estimateLow={90000} estimateHigh={110000} onClose={() => {}} />,
  ));
  expect(document.body.textContent).toContain('Estimate Range$90K - $110K');
  expect(document.body.textContent).toContain('vs EstimateWithin range');
  expect(document.body.textContent).toContain('Fees and proceedsUnrecorded');
});
