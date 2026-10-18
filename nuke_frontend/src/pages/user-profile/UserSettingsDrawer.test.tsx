import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ own: false }));
vi.mock('./UserProfileContext', () => ({ useUserProfile: () => ({
  profile: { email: 'synthetic@fixture.invalid', username: 'fixture' },
  userId: 'fixture', isOwnProfile: fixture.own, isAdmin: false,
  saveProfileField: vi.fn(), uploadAvatar: vi.fn(),
}) }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../components/TextScaleControl', () => ({ default: () => <span>DISPLAY CONTROL</span> }));
beforeEach(() => { fixture.own = false; });

it('renders no private fields or settings even when a visitor receives a populated fixture', () => {
  expect(renderToString(<UserSettingsDrawer open />)).toBe('');
});
it('owners retain their email and settings', () => {
  fixture.own = true;
  const html = renderToString(<UserSettingsDrawer />);
  expect(html).toContain('SETTINGS');
  expect(html).toContain('synthetic@fixture.invalid');
});

import UserSettingsDrawer from './UserSettingsDrawer';
