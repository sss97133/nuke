// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ShareButton from './ShareButton';
import { canonicalUrl } from '../../lib/discoveryFace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
async function render(node: React.ReactElement) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  return el;
}
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('ShareButton', () => {
  it('shares the bare canonical URL: no query string, fragment or tracking', () => {
    expect(canonicalUrl('/jobs/abc?utm_source=x&ref=me#top')).toBe('https://nuke.ag/jobs/abc');
    expect(canonicalUrl('providers/tig')).toBe('https://nuke.ag/providers/tig');
  });

  it('copies the URL on a desktop browser', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    const el = await render(<ShareButton path="/jobs/abc?x=1" title="Front brakes" label="Share this job" />);
    await act(async () => { el.querySelector('button')!.click(); });
    expect(writeText).toHaveBeenCalledWith('https://nuke.ag/jobs/abc');
    expect(el.textContent).toBe('Link copied');
  });

  it('opens the share sheet on a touch device', async () => {
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' }));
    window.matchMedia = ((q: string) => ({ matches: q === '(pointer: coarse)' })) as unknown as typeof window.matchMedia;
    const el = await render(<ShareButton path="/providers/tigwelder" title="@tigwelder · work record" label="Share profile" />);
    await act(async () => { el.querySelector('button')!.click(); });
    expect(share).toHaveBeenCalledWith({ title: '@tigwelder · work record', url: 'https://nuke.ag/providers/tigwelder' });
  });

  it('shows the URL to copy by hand when the clipboard is refused', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
    const el = await render(<ShareButton path="/jobs/abc" title="t" label="Share this job" />);
    await act(async () => { el.querySelector('button')!.click(); });
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('https://nuke.ag/jobs/abc');
  });
});
