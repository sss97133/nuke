// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: null } }) },
} }));
vi.mock('../../hooks/useImageTags', () => ({ useImageTags: () => ({ tags: [], loading: false, createTag: vi.fn(), loadTags: vi.fn() }) }));
vi.mock('../../hooks/useImageAnalysis', () => ({ useImageAnalysis: () => ({ analyzing: false, analysisProgress: null, analyzeImage: vi.fn() }) }));
vi.mock('../../hooks/useAutoTagging', () => ({ useAutoTagging: () => ({ autoTagImage: vi.fn(), isTagging: false, progress: null }) }));
vi.mock('./ImageAIChat', () => ({ ImageAIChat: () => null }));
vi.mock('../common/FaviconIcon', () => ({ FaviconIcon: () => null }));
vi.mock('../parts/SpatialPartPopup', () => ({ default: () => null }));
vi.mock('./ManualAnnotationViewer', () => ({ ManualAnnotationViewer: () => null }));
vi.mock('../parts/ClickablePartModal', () => ({ ClickablePartModal: () => null }));
vi.mock('./AnnotoriousImageTagger', () => ({ AnnotoriousImageTagger: () => null }));
vi.mock('./ImageInfoPanel', () => ({ ImageInfoPanel: () => null }));
vi.mock('./ImageExpandedData', () => ({ ImageExpandedData: () => null }));
vi.mock('../../services/adminNotificationService', () => ({ AdminNotificationService: {} }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import ImageLightbox from './ImageLightbox';

let root: Root;
let host: HTMLDivElement;
const source = 'https://synthetic.supabase.co/storage/v1/object/public/photos/retained.HEIC';
const close = vi.fn();
const photo = () => document.querySelector('img[alt="Vehicle"]') as HTMLImageElement;
async function render(url = source, isOpen = true) {
  await act(async () => root.render(<ImageLightbox imageUrl={url} isOpen={isOpen} onClose={close} canEdit={false} />));
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe('lightbox retained source display', () => {
  it('mounts the full-frame browser rendition immediately without waiting for metadata', async () => {
    await render();
    const url = new URL(photo().src);
    expect(url.pathname).toBe('/storage/v1/render/image/public/photos/retained.HEIC');
    expect(Object.fromEntries(url.searchParams)).toEqual({ width: '1800', height: '1800', quality: '90', resize: 'contain', format: 'origin' });
    expect(photo().getAttribute('loading')).toBe('eager');
  });

  it('surfaces failure, retains the original source link, and retries with a fresh image node', async () => {
    await render(); const first = photo();
    await act(async () => first.dispatchEvent(new Event('error')));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    expect(document.querySelector<HTMLAnchorElement>('[role="alert"] a')?.href).toBe(source);
    const retry = document.querySelector<HTMLButtonElement>('[role="alert"] button')!;
    await act(async () => retry.click());
    expect(photo()).not.toBe(first);
    expect(photo().src).toBe(first.src);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => photo().dispatchEvent(new Event('load')));
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('clears the old failure on navigation and keeps ordinary JPEG source URLs intact', async () => {
    await render(); const first = photo();
    await act(async () => first.dispatchEvent(new Event('error')));
    const next = 'https://images.example.test/next.jpg';
    await render(next);
    expect(photo()).not.toBe(first);
    expect(photo().src).toBe(next);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await render(next, false);
    expect(photo()).toBeNull();
  });

  it('offers a retry for a stalled request and clears the notice after a late successful load', async () => {
    vi.useFakeTimers();
    await render(); const first = photo();
    await act(async () => vi.advanceTimersByTime(14999));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('taking longer to load');
    expect(document.querySelector('[role="alert"]')?.textContent).not.toContain('could not be loaded');
    await act(async () => document.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
    expect(photo()).not.toBe(first);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(15000));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('taking longer to load');
    await act(async () => photo().dispatchEvent(new Event('load')));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(30000));
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('cancels the prior image deadline on navigation and clears timers on unmount', async () => {
    vi.useFakeTimers();
    await render();
    await act(async () => vi.advanceTimersByTime(10000));
    await render('https://images.example.test/next.jpg');
    await act(async () => vi.advanceTimersByTime(5000));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
  });
});
