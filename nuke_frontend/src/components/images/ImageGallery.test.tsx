// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rows: [] as any[], fetch: vi.fn(), queueStats: vi.fn(), requests: [] as any[] }));
vi.mock('../../lib/fetchVehicleImages', () => ({ fetchVehicleImages: (...args: any[]) => fixture.fetch(...args) }));
vi.mock('../../lib/supabase', () => {
  const meta = { id: 'vehicle-fixture', year: 2006, make: 'Pontiac', model: 'Solstice',
    profile_origin: 'bat_import', discovery_url: 'https://bringatrailer.com/listing/synthetic-fixture/' };
  const query = (table: string) => {
    const result = { data: table === 'vehicles' ? meta : [], error: null, count: 0 };
    const chain: any = { then: (resolve: any) => Promise.resolve(result).then(resolve) };
    for (const key of ['select', 'eq', 'not', 'in', 'order', 'limit', 'is', 'or', 'gt', 'gte', 'lte', 'range', 'maybeSingle', 'single']) {
      chain[key] = (...args: any[]) => { fixture.requests.push({ table, key, args }); return chain; };
    }
    return chain;
  };
  return { supabase: { from: query, rpc: () => query('rpc'), auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  } } };
});
vi.mock('../../services/imageUploadService', () => ({ ImageUploadService: {} }));
vi.mock('../../services/globalUploadStatusService', () => ({ globalUploadStatusService: {} }));
vi.mock('../../services/uploadQueueService', () => ({ uploadQueueService: { getQueueStats: (...args: any[]) => fixture.queueStats(...args) } }));
vi.mock('../../services/imageDisplayPriority', () => ({ sortImagesByPriority: (rows: any[]) => rows }));
vi.mock('../../services/imageSetService', () => ({ ImageSetService: {} }));
vi.mock('../image/ImageLightbox', () => ({ default: ({ imageId, title, onNext, onPrev }: any) => <>
  <div data-testid="lightbox">{imageId}</div><span data-testid="lightbox-title">{title}</span>
  <button data-testid="lightbox-next" onClick={onNext}>Next</button><button data-testid="lightbox-prev" onClick={onPrev}>Previous</button>
</> }));
vi.mock('./SensitiveImageOverlay', () => ({ SensitiveImageOverlay: () => null }));
vi.mock('../onboarding/OnboardingSlideshow', () => ({ OnboardingSlideshow: () => null }));

import ImageGallery from './ImageGallery';

let root: Root;
let container: HTMLDivElement;
const photos = (count = 399) => Array.from({ length: count }, (_, index) => ({
  id: '10000000-0000-4000-8000-' + String(index).padStart(12, '0'),
  image_url: 'https://bringatrailer.com/wp-content/uploads/' + (index % 2 ? '2026/09' : '2025/02') + '/' + (index < 29 ? '2006_pontiac_solstice' : 'DSC') + '_' + index + '.jpg',
  source: 'bat_import', position: index, created_at: '2026-09-30T12:00:00Z',
  is_primary: index === 0, category: 'general', is_sensitive: false, is_document: false,
  // No client "trusted" marker; only the canonical loader determines this path.
}));
const galleryPhotos = () => [...container.querySelectorAll('img[src*="bringatrailer.com/wp-content/uploads/"]')];

beforeEach(() => {
  vi.useFakeTimers();
  fixture.rows = photos();
  fixture.fetch.mockReset().mockImplementation(async () => fixture.rows);
  fixture.queueStats.mockReset().mockResolvedValue({ pending: 0, failed: 0 });
  fixture.requests = [];
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('IntersectionObserver', class {
    callback: any;
    constructor(callback: any) { this.callback = callback; }
    observe() { queueMicrotask(() => this.callback([{ isIntersecting: true }])); }
    disconnect() {}
    unobserve() {}
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(props: Record<string, any> = {}) {
  await act(async () => {
    root.render(<ImageGallery vehicleId="vehicle-fixture" showUpload={false} galleryView="FULL" {...props} />);
  });
  // Exercise the real component's progressive loading and metadata effect.
  for (let i = 0; i < 20; i++) await act(async () => { await vi.advanceTimersByTimeAsync(500); });
}

describe('ImageGallery canonical database rows', () => {
  it.each([false, true])('navigates the full filtered collection before thumbnail paging (filtered=%s)', async (filtered) => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
    fixture.rows.forEach((row, index) => { row.category = index % 2 === 0 ? 'detail' : 'general'; });
    const galleryFilter = filtered ? { category: 'detail' } : undefined;
    const eligible = fixture.rows.filter(row => !filtered || row.category === 'detail');
    await mount({ galleryFilter });
    expect(galleryPhotos()).toHaveLength(50);
    await act(async () => { galleryPhotos()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('[data-testid="lightbox-title"]')?.textContent).toBe(`1 of ${eligible.length}`);
    await act(async () => { container.querySelector('[data-testid="lightbox-prev"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('[data-testid="lightbox"]')?.textContent).toBe(eligible.at(-1)!.id);
    expect(container.querySelector('[data-testid="lightbox-title"]')?.textContent).toBe(`${eligible.length} of ${eligible.length}`);
    await act(async () => { galleryPhotos()[49].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { container.querySelector('[data-testid="lightbox-next"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('[data-testid="lightbox"]')?.textContent).toBe(eligible[50].id);
    expect(container.querySelector('[data-testid="lightbox-title"]')?.textContent).toBe(`51 of ${eligible.length}`);
    expect(galleryPhotos()).toHaveLength(50);
    // Changing layout cannot replace the selected image with the same thumbnail index.
    await act(async () => { root.render(<ImageGallery vehicleId="vehicle-fixture" showUpload={false} galleryView="INFO" galleryFilter={galleryFilter} />); });
    expect(container.querySelector('[data-testid="lightbox"]')?.textContent).toBe(eligible[50].id);
  });

  it.each(['FULL', 'INFO'])('pages all399 in %s when its nested column scrolls, with the sentinel after the photos', async (galleryView) => {
    let finishQueueRead!: (value: unknown) => void;
    fixture.queueStats.mockReturnValue(new Promise(resolve => { finishQueueRead = resolve; }));
    container.style.overflowY = 'auto';
    container.style.height = '300px';
    const roots: (Element | Document | null)[] = [];
    // Unlike the old always-intersecting stub, this models the two conditions
    // required at the column bottom: the correct scroll root and a final sentinel.
    vi.stubGlobal('IntersectionObserver', class {
      target: Element | null = null;
      root: Element | Document | null;
      callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.callback = callback;
        this.root = options?.root ?? null;
        roots.push(this.root);
      }
      onScroll = () => {
        if (!this.target || this.root !== container || container.scrollTop <= 0) return;
        const lastPhoto = galleryPhotos().at(-1);
        const afterImages = !!lastPhoto && !!(lastPhoto.compareDocumentPosition(this.target) & Node.DOCUMENT_POSITION_FOLLOWING);
        this.callback([{ target: this.target, isIntersecting: afterImages } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      };
      observe(target: Element) { this.target = target; (this.root ?? window).addEventListener('scroll', this.onScroll); }
      disconnect() { (this.root ?? window).removeEventListener('scroll', this.onScroll); }
      unobserve() { this.disconnect(); }
    });
    await mount({ galleryView });
    // In production the queue read finishes after image state is populated.
    // The observer must attach when loading finally removes the placeholder.
    expect(galleryPhotos()).toHaveLength(0);
    await act(async () => { finishQueueRead({ pending: 0, failed: 0 }); });
    const firstCount = galleryPhotos().length;
    expect(firstCount).toBeGreaterThan(0);
    expect(firstCount).toBeLessThan(399);
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.every(scrollRoot => scrollRoot === container)).toBe(true);
    expect(container.querySelectorAll('[data-gallery-load-more]')).toHaveLength(1);
    await act(async () => { window.dispatchEvent(new Event('scroll')); await vi.advanceTimersByTimeAsync(500); });
    expect(galleryPhotos()).toHaveLength(firstCount);
    for (let i = 0; i < 20 && galleryPhotos().length < 399; i++) {
      const before = galleryPhotos().length;
      await act(async () => {
        container.scrollTop = before * 100;
        container.dispatchEvent(new Event('scroll'));
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(galleryPhotos().length).toBeGreaterThan(before);
    }
    expect(galleryPhotos()).toHaveLength(399);
    expect(container.querySelectorAll('[data-gallery-load-more]')).toHaveLength(0);
    const last = galleryPhotos().at(-1)!;
    await act(async () => { last.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('[data-testid="lightbox"]')?.textContent).toBe(fixture.rows.at(-1)!.id);
  });

  it('keeps all399 admitted photos through filename/date heuristics and progressive navigation', async () => {
    await mount();
    expect(fixture.fetch).toHaveBeenCalledWith('vehicle-fixture', expect.any(String), { includeMismatchFilter: true });
    const rendered = galleryPhotos();
    expect(rendered).toHaveLength(399);
    expect(new Set(rendered.map(img => img.getAttribute('src'))).size).toBe(399);
    expect(rendered.filter(img => img.getAttribute('src')?.includes('/DSC_'))).toHaveLength(370);
    // Last image opens with its real database ID, rather than a synthetic URL row.
    await act(async () => { rendered.at(-1)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('[data-testid="lightbox"]')?.textContent).toBe(fixture.rows.at(-1)!.id);
  });

  it('keeps legacy URL fallback filtering separate from canonical admission', async () => {
    fixture.rows = [];
    await mount({ fallbackImageUrls: [
      'file:///private/photo.jpg',
      'https://bringatrailer.com/wp-content/uploads/2026/09/nav-logo.jpg',
      ...Array.from({ length: 3 }, (_, i) => 'https://bringatrailer.com/wp-content/uploads/2026/09/2006_pontiac_solstice_' + i + '.jpg'),
      'https://bringatrailer.com/wp-content/uploads/2026/09/unrelated.jpg',
    ] });
    const rendered = galleryPhotos();
    expect(rendered).toHaveLength(3);
    expect(rendered.every(img => img.getAttribute('src')?.includes('2006_pontiac_solstice'))).toBe(true);
  });
});
