// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import NotFound from './NotFound';

describe('NotFound', () => {
  let root: Root, container: HTMLDivElement;
  beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('names the missing path and opens the doors, on kit roles', async () => {
    await act(async () => { root.render(<MemoryRouter initialEntries={['/no-such-page-2026']}><NotFound /></MemoryRouter>); });
    expect(container.querySelector('h1')?.textContent).toBe('No such page');
    expect(container.querySelector('h1')?.className).toContain('k-entity');
    expect(container.textContent).toContain('/no-such-page-2026');
    const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['/?tab=market', '/search', '/journal', '/about']);
    expect(container.querySelector('[style]')).toBeNull();
    expect(document.title).toContain('No such page');
  });
});
