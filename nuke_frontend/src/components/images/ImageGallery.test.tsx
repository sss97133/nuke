// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rows: [] as any[], fetch: vi.fn(), requests: [] as any[] }));
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
vi.mock('../../services/uploadQueueService', () => ({ uploadQueueService: { getQueueStats: async () => ({ pending: 0, failed: 0 }) } }));
vi.mock('../../services/imageDisplayPriority', () => ({ sortImagesByPriority: (rows: any[]) => rows }));
vi.mock('../../services/imageSetService', () => ({ ImageSetService: {} }));
vi.mock('../image/ImageLightbox', () => ({ default: ({ imageId }: any) => <div data-testid="lightbox">{imageId}</div> }));
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
