// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import SettingsHubPage from './SettingsHubPage';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('offers concrete account, compute and connection destinations without dead drawer or webhook actions', async () => {
  await act(async () => root.render(<MemoryRouter><SettingsHubPage /></MemoryRouter>));
  const links = [...container.querySelectorAll('a')];
  expect(links.find(link => link.textContent?.includes('AI access'))?.getAttribute('href')).toBe('/settings/ai');
  expect(links.find(link => link.textContent?.includes('Profile & connections'))?.getAttribute('href')).toBe('/profile?settings=connections');
  expect(links.find(link => link.textContent?.includes('Appearance'))?.getAttribute('href')).toBe('/capsule?tab=appearance');
  expect(links.some(link => link.getAttribute('href') === '/settings/webhooks')).toBe(false);
  expect(container.querySelectorAll('button')).toHaveLength(0);
  expect(container.querySelectorAll('section')).toHaveLength(3);
});
