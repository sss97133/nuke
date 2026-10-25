// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ own: true }));
vi.mock('./user-profile/UserProfileContext', () => ({ UserProfileProvider: ({ children }: { children: React.ReactNode }) => children, useUserProfile: () => ({ loading: false, profile: {}, isOwnProfile: fixture.own }) }));
vi.mock('./user-profile/UserHeader', () => ({ default: () => null }));
vi.mock('./user-profile/UserSubHeader', () => ({ default: () => null }));
vi.mock('./user-profile/UserBarcodeTimeline', () => ({ default: () => null }));
vi.mock('./user-profile/UserWorkspaceContent', () => ({ default: () => null }));
vi.mock('./user-profile/UserSettingsDrawer', () => ({ default: ({ open, onClose }: { open?: boolean; onClose: () => void }) => <div data-testid="settings-drawer" data-open={String(open)}><button onClick={onClose}>Close settings</button></div> }));
import UserProfile from './UserProfile';
const Location = () => <output>{useLocation().search}</output>;
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  fixture.own = true; (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('opens the existing own-profile drawer from settings and consumes only its query on close', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/profile?settings=connections&tab=work']}><UserProfile /><Location /></MemoryRouter>));
  expect(container.querySelector('[data-testid="settings-drawer"]')?.getAttribute('data-open')).toBe('true');
  await act(async () => container.querySelector('button')!.click());
  expect(container.querySelector('output')?.textContent).toBe('?tab=work');
  expect(container.querySelector('[data-testid="settings-drawer"]')?.getAttribute('data-open')).toBe('undefined');
});
it('does not mount another person’s private drawer from the same query', async () => {
  fixture.own = false;
  await act(async () => root.render(<MemoryRouter initialEntries={['/profile/example?settings=connections']}><UserProfile /></MemoryRouter>));
  expect(container.querySelector('[data-testid="settings-drawer"]')).toBeNull();
});
