// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'fixture' } } } }) } } }));
vi.mock('../components/UniversalImageUpload', () => ({ UniversalImageUpload: () => null }));
import Capture from './Capture';
afterEach(() => vi.restoreAllMocks());
it('attaches a granted camera stream after the video mounts and stops it on exit', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const stop = vi.fn(), stream = { getTracks: () => [{ stop }] };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const host = document.createElement('div'), root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<MemoryRouter><Capture /></MemoryRouter>));
    expect(host.querySelector('video')).toBeNull();
    await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Camera')!.click());
    expect(host.querySelector('video')?.srcObject).toBe(stream);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); }
  expect(stop).toHaveBeenCalledOnce();
});
