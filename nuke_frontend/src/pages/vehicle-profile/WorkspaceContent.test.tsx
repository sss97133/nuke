// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ context: {} as any, auth: { user: null, loading: false } as any, comments: vi.fn(), gallery: vi.fn(), findings: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => fixture.auth }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => fixture.context }));
vi.mock('../../components/vehicle/VehicleCommentsCard', () => ({
  VehicleCommentsCard: (props: any) => { fixture.comments(props); return <div data-testid="comment-reader">Comments &amp; Bids</div>; },
}));
vi.mock('./FinancialReceiptRecords', () => ({ ProfileReceiptRecords: () => <section data-testid="receipt-pages">Work &amp; parts</section> }));
vi.mock('./WorkMemorySection', () => ({ default: () => null }));
vi.mock('./VehicleDossierPanel', () => ({ default: () => <div data-testid="specifications">Retained specifications</div> }));
vi.mock('../../components/vehicle/VehicleLedgerDocumentsCard', () => ({ VehicleLedgerDocumentsCard: () => null }));
vi.mock('../../components/PartsQuoteGenerator', () => ({ PartsQuoteGenerator: () => null }));
vi.mock('./InvestmentLedger', () => ({ default: () => null }));
vi.mock('./BuildLedger', () => ({ default: () => null }));
vi.mock('../../components/agent/AgentChat', () => ({ default: () => null }));
vi.mock('./WorthEngineCard', () => ({ default: () => null }));
vi.mock('./PhotoAuthenticationCard', () => ({ default: () => null }));
vi.mock('./VehicleFindingsCard', () => ({ default: (props: any) => { fixture.findings(props); return null; } }));
vi.mock('../../components/vehicle/BuyerQuestionPreview', () => ({ default: () => null }));
vi.mock('../../components/vehicle/ExternalListingCard', () => ({ default: () => null }));
vi.mock('../../components/vehicle/VehicleReferenceLibrary', () => ({ default: () => null }));
vi.mock('../../components/vehicle/VehicleDescriptionCard', () => ({ default: () => <section data-testid="description">Seller description</section> }));
vi.mock('../../components/images/BundleReviewQueue', () => ({ default: () => null }));
vi.mock('../../components/images/ImageGallery', () => ({ default: (props: any) => { fixture.gallery(props); return null; } }));
vi.mock('../../components/vehicle/VehicleVideoSection', () => ({ default: () => null }));
vi.mock('./AnalysisSignalsSection', () => ({ default: () => null }));
vi.mock('./VehicleIntelligencePanel', () => ({ default: () => null }));
vi.mock('./VehicleScoresWidget', () => ({ default: () => null }));
vi.mock('./AuctionReadinessPanel', () => ({ default: () => null }));
vi.mock('./ChannelSwitchboardCard', () => ({ default: () => null }));
vi.mock('./VenueSkinPreviewCard', () => ({ default: () => null }));
vi.mock('./ColumnDivider', () => ({ default: () => null }));
vi.mock('./BuildManifestPanel', () => ({ default: () => null }));
vi.mock('../../components/vehicle/VehicleListingDetailsCard', () => ({ default: () => null }));
vi.mock('../../components/vehicle/SimilarSalesSection', () => ({ SimilarSalesSection: () => null }));
vi.mock('../../components/vehicle/PriceHistoryChart', () => ({ default: () => null }));
vi.mock('./ObservationTimeline', () => ({ default: () => null }));
vi.mock('./VehicleAgentChat', () => ({ default: () => null }));
vi.mock('./InventoryWidgetLink', () => ({ default: () => null }));
vi.mock('./WiringWidgetLink', () => ({ default: () => null }));

import WorkspaceContent from './WorkspaceContent';
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.context = { vehicle: { id: 'offline-subject' }, session: null, totalCommentCount: 0,
    vehicleImages: [], fallbackListingImageUrls: [], observationCount: 0 };
  fixture.comments.mockClear(); fixture.gallery.mockClear();
  fixture.findings.mockClear(); fixture.auth = { user: null, loading: false };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount() { await act(async () => root.render(<WorkspaceContent referenceLibraryRefreshKey={0}
  onAddEventClick={() => {}} onDataPointClick={() => {}} onEditClick={() => {}}
  onUpdatePrivacy={() => {}} onSetReferenceLibraryRefreshKey={() => {}} />)); }

it.each([0, undefined, 73])('opens the subject reader independently of the legacy summary %s', async count => {
  fixture.context.totalCommentCount = count;
  await mount();
  expect(fixture.comments).toHaveBeenCalled();
  expect(fixture.comments.mock.calls.at(-1)?.[0]).toMatchObject({ vehicleId: 'offline-subject', session: null, hideWhenEmpty: true, maxVisible: 0, collapsed: true });
  expect(host.querySelector('[data-testid=comment-reader]')).not.toBeNull();
  expect([...host.querySelectorAll('h3')].some(h => h.textContent === 'Comments & Bids')).toBe(false);
  expect(host.querySelector('[data-testid=comment-reader]')?.closest('.collapsible-widget--profile')).toBeNull();
});
it('does not mount a child reader before a parent vehicle exists', async () => {
  fixture.context.vehicle = null; await mount();
  expect(fixture.comments).not.toHaveBeenCalled(); expect(host.textContent).toBe('');
});
it('opens the retained description and specifications without a second disclosure gate', async () => {
  await mount();
  const left = host.querySelector('.vehicle-profile-left-column')!;
  expect(left.firstElementChild?.getAttribute('data-testid')).toBe('description');
  expect(host.querySelectorAll('[data-testid=description]')).toHaveLength(1);
  expect(host.querySelector('[data-testid=description]')?.closest('.collapsible-widget--profile')).toBeNull();
  expect(host.querySelector('[data-testid=specifications]')).not.toBeNull();
});


it('keeps every gallery view actionable and exposes the selected mode', async () => {
  fixture.context.galleryFilter = { zone: 'mech_engine' };
  fixture.context.setGalleryFilter = vi.fn();
  await mount();
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Image view"] button')];
  expect(buttons).toHaveLength(8);
  expect(buttons.find(button => button.textContent === 'Grid')?.getAttribute('aria-pressed')).toBe('true');
  const modes = ['ZONES', 'GRID', 'FULL', 'INFO', 'SESSIONS', 'CATEGORY', 'CHRONO', 'SOURCE'];
  for (const [index, button] of buttons.entries()) {
    await act(async () => button.click());
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('[aria-label="Image view"] [aria-pressed="true"]')).toHaveLength(1);
    expect(fixture.gallery.mock.calls.at(-1)?.[0].galleryView).toBe(modes[index]);
  }
  expect(fixture.context.setGalleryFilter).not.toHaveBeenCalled();
  expect(fixture.gallery.mock.calls.at(-1)?.[0].galleryFilter).toEqual(fixture.context.galleryFilter);
  const clear = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Clear filter')!;
  expect(clear.closest('.gallery-header')).not.toBeNull();
  fixture.context.setGalleryFilter.mockClear();
  await act(async () => clear.click());
  expect(fixture.context.setGalleryFilter).toHaveBeenCalledOnce();
  expect(fixture.context.setGalleryFilter).toHaveBeenCalledWith(null);
});
it('labels image columns and updates the existing grid variable', async () => {
  await mount();
  const slider = host.querySelector<HTMLInputElement>('[aria-label="Image columns"]')!;
  expect(slider.min).toBe('1'); expect(slider.max).toBe('8'); expect(slider.value).toBe('3');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '2');
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.querySelector('.gallery-slider-val')?.textContent).toBe('2');
  expect(host.querySelector<HTMLElement>('.vehicle-profile-right-column')?.style.getPropertyValue('--vp-gallery-cols')).toBe('2');
});

it('routes a counted analysis population to the existing gallery and preserves viewer scope', async () => {
  fixture.context.setGalleryFilter = vi.fn();
  const scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
  await mount();
  const read = { vehicleId: 'offline-subject', viewerKey: 'anonymous', status: 'ready', images: [{ id: 'source' }], partial: false, readAt: '2026-11-09' };
  await act(async () => fixture.gallery.mock.calls.at(-1)![0].onAnalysisRead(read));
  expect(fixture.findings.mock.calls.at(-1)?.[0].read).toEqual(read);
  await act(async () => fixture.findings.mock.calls.at(-1)![0].onSelectImages(['source'], 'Detailed observations'));
  expect(fixture.context.setGalleryFilter).toHaveBeenCalledWith({ imageIds: ['source'], label: 'Detailed observations' });
  expect(fixture.gallery.mock.calls.at(-1)?.[0].galleryView).toBe('GRID');
  expect(scroll).toHaveBeenCalled();
  fixture.auth = { user: { id: 'another-viewer' }, loading: false }; await mount();
  expect(fixture.gallery.mock.calls.at(-1)?.[0].viewerKey).toBe('another-viewer');
  // The findings consumer receives the new subject independently of the old read receipt.
  expect(fixture.findings.mock.calls.at(-1)?.[0].viewerKey).toBe('another-viewer');
});

it('waits for authentication resolution before mounting the gallery source reader', async () => {
  fixture.auth.loading = true; await mount();
  expect(fixture.gallery).not.toHaveBeenCalled();
  expect(fixture.findings.mock.calls.at(-1)?.[0].read).toBeNull();
});
it('keeps failed gallery reads distinct from zero and replaces them after retry', async () => {
  await mount();
  const count = () => host.querySelector('.gallery-header .widget__count')?.textContent;
  expect(count()).toBe('Reading…');
  await act(async () => fixture.gallery.mock.calls.at(-1)![0].onReadCount({ vehicleId: 'offline-subject', filterKey: 'null', shown: 0, partial: false, failed: true }));
  expect(count()).toBe('Unavailable');
  await act(async () => fixture.findings.mock.calls.at(-1)![0].onRetry());
  expect(count()).toBe('Reading…');
  await act(async () => fixture.gallery.mock.calls.at(-1)![0].onReadCount({ vehicleId: 'offline-subject', filterKey: 'null', shown: 29, partial: false }));
  expect(count()).toBe('29');
});
