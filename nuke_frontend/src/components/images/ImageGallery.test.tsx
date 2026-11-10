// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rows: [] as any[], sessions: [] as any[], fetch: vi.fn(), queueStats: vi.fn(), requests: [] as any[] }));
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
  return { supabase: { from: query, rpc: (name: string) => name === 'get_vehicle_sessions' ? Promise.resolve({ data: fixture.sessions, error: null }) : query('rpc'), auth: {
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
vi.mock('./SensitiveImageOverlay', () => ({ SensitiveImageOverlay: ({ imageUrl }: any) => <img src={imageUrl} alt="Vehicle image" /> }));
vi.mock('../onboarding/OnboardingSlideshow', () => ({ OnboardingSlideshow: () => null }));

import ImageGallery from './ImageGallery';
import VehicleFindingsCard from '../../pages/vehicle-profile/VehicleFindingsCard';

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
  fixture.sessions = [];
  fixture.fetch.mockReset().mockImplementation(async (_id, _select, options) => {
    options?.onLoadCoverage?.({ loaded: fixture.rows.length, total: fixture.rows.length });
    return fixture.rows;
  });
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

// Each case renders 399 rows through 20 timer steps (about 0.6 s locally, near 5 s on loaded CI runners; one timed out on 2026-10-13).
describe('ImageGallery canonical database rows', { timeout: 20_000 }, () => {
  it('opens an analysis count into the same deduplicated photos and lightbox collection', async () => {
    fixture.rows = photos(4).map((row, index) => ({ ...row,
      ai_classification: index < 2 ? { image_type: 'vehicle_exterior' } : null,
      ai_byok_scene: index % 2 === 0 ? 'body_exterior' : null,
      ai_review_version: index === 0 ? 'reviewed_image_analysis_v1' : null,
      ai_review_observation: index === 0 ? '11111111-1111-4111-8111-111111111111' : null,
    }));
    fixture.rows.push({ ...fixture.rows[0], id: 'duplicate-url' });
    const reads = vi.fn();
    function Harness() {
      const [read, setRead] = React.useState<any>(null), [filter, setFilter] = React.useState<any>(null);
      const record = React.useCallback((value: any) => { reads(value); setRead(value); }, []);
      return <><VehicleFindingsCard vehicleId="vehicle-fixture" viewerKey="anonymous" read={read}
        onRetry={() => {}} onSelectImages={(imageIds, label) => setFilter({ imageIds, label })} />
        <ImageGallery vehicleId="vehicle-fixture" showUpload={false} galleryView="FULL"
          galleryFilter={filter} onAnalysisRead={record} /></>;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(reads.mock.calls.at(-1)?.[0].images).toHaveLength(4);
    const reviewed = container.querySelector<HTMLButtonElement>('[aria-label="Show 1 reviewed images"]')!;
    expect(reviewed.textContent).toBe('1 / 4');
    await act(async () => reviewed.click());
    expect(galleryPhotos().map(image => (image as HTMLImageElement).src)).toEqual([fixture.rows[0].image_url]);
    const count = container.querySelector<HTMLButtonElement>('[aria-label="Show 2 detailed observations images"]')!;
    expect(count.textContent).toBe('2 / 4');
    await act(async () => count.click());
    expect(galleryPhotos()).toHaveLength(2);
    expect(galleryPhotos().map(image => (image as HTMLImageElement).src)).toEqual([fixture.rows[0].image_url, fixture.rows[2].image_url]);
    await act(async () => galleryPhotos()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[data-testid="lightbox-title"]')?.textContent).toBe('1 of 2');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="lightbox-next"]')!.click());
    expect(container.querySelector('[data-testid="lightbox"]')?.textContent).toBe(fixture.rows[2].id);
    // Filtering does not shrink the analysis denominator or issue a second source read.
    expect(count.textContent).toBe('2 / 4');
    expect(fixture.fetch).toHaveBeenCalledOnce();
  });

  it('reports source failures without reusing a prior successful analysis population', async () => {
    fixture.fetch.mockRejectedValue(new Error('source unavailable'));
    const onAnalysisRead = vi.fn();
    await mount({ onAnalysisRead });
    expect(onAnalysisRead.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'error', images: [], readAt: null });
  });

  it('does not count URL-only fallback tiles as admitted image analysis', async () => {
    fixture.rows = [];
    const onAnalysisRead = vi.fn();
    await mount({ fallbackImageUrls: ['https://bringatrailer.com/wp-content/uploads/2026/09/fallback.jpg'], onAnalysisRead });
    expect(onAnalysisRead.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'ready', images: [] });
  });

  it('keeps an empty exact-image filter empty', async () => {
    fixture.rows = photos(4); const onReadCount = vi.fn();
    await mount({ galleryFilter: { imageIds: [] }, onReadCount });
    expect(galleryPhotos()).toHaveLength(0);
    expect(onReadCount.mock.calls.at(-1)?.[0].shown).toBe(0);
  });
  it.each([false, true])('groups the complete classified collection and opens a source beyond the thumbnail page (filtered=%s)', async (filtered) => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
    fixture.rows = photos(120).map((photo, index) => ({ ...photo,
      category: index % 2 ? 'detail' : 'general',
      ai_classification: { image_type: index === 119 ? 'engine_bay' : 'vehicle_exterior' },
    }));
    const galleryFilter = filtered ? { category: 'detail' } : undefined;
    const eligible = fixture.rows.filter(row => !filtered || row.category === 'detail');
    await mount({ galleryView: 'ZONES', galleryFilter });
    const exterior = container.querySelector('[data-zone-section="exterior"]');
    const engine = container.querySelector('[data-zone-section="engine_bay"]');
    expect(exterior?.querySelectorAll('img')).toHaveLength(eligible.length - 1);
    expect(engine?.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('[data-zone-section="uncategorized"]')).toBeNull();
    expect(container.querySelector('[data-gallery-load-more]')).toBeNull();
    await act(async () => engine!.querySelector('[role="button"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(container.querySelector('[data-testid="lightbox"]')?.textContent).toBe(fixture.rows[119].id);
    expect(container.querySelector('[data-testid="lightbox-title"]')?.textContent).toBe(`${eligible.length} of ${eligible.length}`);
    await act(async () => container.querySelector('[data-testid="lightbox-next"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[data-testid="lightbox"]')?.textContent).toBe(eligible[0].id);
  });

  it('retains the selected part topic and its count across full-size and session views', async () => {
    fixture.rows = photos(4);
    fixture.rows[0].vehicle_zone = 'mech_drivetrain';
    fixture.rows[1].vehicle_zone = 'mech_engine_bay';
    fixture.rows[2].ai_byok_narrative = 'Transmission staged above the frame.';
    fixture.rows[3].vehicle_zone = 'ext_front';
    fixture.sessions = [{ session_id: 'session', session_start: '2026-09-30T12:00:00Z', image_ids: fixture.rows.map(row => row.id), image_count: 4 }];
    const galleryFilter = { field: 'transmission', label: '6L90' }, onReadCount = vi.fn();
    await mount({ galleryFilter, onReadCount });
    expect(galleryPhotos()).toHaveLength(2);
    expect(onReadCount).toHaveBeenLastCalledWith({ vehicleId: 'vehicle-fixture', filterKey: JSON.stringify(galleryFilter), shown: 2, partial: false });
    await act(async () => root.render(<ImageGallery vehicleId="vehicle-fixture" showUpload={false} galleryView="SESSIONS" galleryFilter={galleryFilter} onReadCount={onReadCount} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(galleryPhotos()).toHaveLength(2);
    expect(container.textContent).toContain('2 matching photos');
    expect(onReadCount.mock.calls.at(-1)?.[0].shown).toBe(2);
  });
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
    expect(fixture.fetch).toHaveBeenCalledWith('vehicle-fixture', expect.any(String), expect.objectContaining({ includeMismatchFilter: true }));
    const rendered = galleryPhotos();
    expect(rendered).toHaveLength(399);
    expect(new Set(rendered.map(img => img.getAttribute('src'))).size).toBe(399);
    expect(rendered.filter(img => img.getAttribute('src')?.includes('/DSC_'))).toHaveLength(370);
    // Last image opens with its real database ID, rather than a synthetic URL row.
    await act(async () => { rendered.at(-1)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('[data-testid="lightbox"]')?.textContent).toBe(fixture.rows.at(-1)!.id);
  });

  // One mount per case: two mounts in one case ran past the 5 s budget on a slow runner (2026-10-13).
  it('says how many of the admitted photos loaded when the fetch left rows behind', async () => {
    fixture.fetch.mockImplementation(async (_vehicleId: string, _select: string, options: { onLoadCoverage?: (c: { loaded: number; total: number }) => void }) => {
      options?.onLoadCoverage?.({ loaded: 399, total: 1445 });
      return fixture.rows;
    });
    await mount();
    expect(container.textContent).toContain('399 of 1,445');
    expect(container.querySelector('[title*="399 of 1,445 admitted images loaded"]')).not.toBeNull();
  });

  it('keeps the plain count when every admitted photo loaded', async () => {
    fixture.fetch.mockImplementation(async (_vehicleId: string, _select: string, options: { onLoadCoverage?: (c: { loaded: number; total: number }) => void }) => {
      options?.onLoadCoverage?.({ loaded: 399, total: 399 });
      return fixture.rows;
    });
    await mount();
    expect(container.textContent).not.toContain(' of 399');
    expect(container.textContent).toMatch(/399 (photos|images)/);
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
