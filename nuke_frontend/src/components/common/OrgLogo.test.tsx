// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgLogo } from './OrgLogo';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

describe('OrgLogo: the recorded logo or the type icon, never a guessed one', () => {
  it('draws the recorded logo', async () => {
    await act(async () => root.render(<OrgLogo logoUrl="https://cdn.example.test/logo.png" website="https://shop.example.test" businessType="dealership" />));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.test/logo.png');
  });

  it('draws the type icon for a website without a recorded logo, and requests nothing', async () => {
    for (const variant of ['icon', 'logo', 'card'] as const) {
      await act(async () => root.render(<OrgLogo website="https://www.shop.example.test" businessType="dealership" variant={variant} businessName="Shop" />));
      expect(container.querySelector('img')).toBeNull();
      expect(container.innerHTML).not.toMatch(/clearbit|google\.com\/s2\/favicons|gstatic/);
    }
  });

  it('replaces a recorded logo that fails to load with the type icon', async () => {
    await act(async () => root.render(<OrgLogo logoUrl="https://files/broken.png" website="https://shop.example.test" businessType="auction_house" variant="card" />));
    const img = container.querySelector('img')!;
    await act(async () => { img.dispatchEvent(new Event('error')); });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
