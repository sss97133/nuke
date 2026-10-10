// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ context: {} as any, comments: vi.fn() }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => fixture.context }));
vi.mock('../../components/vehicle/VehicleCommentsCard', () => ({
  VehicleCommentsCard: (props: any) => { fixture.comments(props); return <div data-testid="comment-reader">Comments &amp; Bids</div>; },
}));
vi.mock('./WorkMemorySection', () => ({ default: () => null }));
vi.mock('./VehicleDossierPanel', () => ({ default: () => null }));
vi.mock('../../components/vehicle/VehicleLedgerDocumentsCard', () => ({ VehicleLedgerDocumentsCard: () => null }));
vi.mock('../../components/PartsQuoteGenerator', () => ({ PartsQuoteGenerator: () => null }));
vi.mock('./InvestmentLedger', () => ({ default: () => null }));
vi.mock('./BuildLedger', () => ({ default: () => null }));
vi.mock('../../components/agent/AgentChat', () => ({ default: () => null }));
vi.mock('./WorthEngineCard', () => ({ default: () => null }));
vi.mock('./PhotoAuthenticationCard', () => ({ default: () => null }));
vi.mock('./VehicleFindingsCard', () => ({ default: () => null }));
vi.mock('../../components/vehicle/BuyerQuestionPreview', () => ({ default: () => null }));
vi.mock('../../components/vehicle/ExternalListingCard', () => ({ default: () => null }));
vi.mock('../../components/vehicle/VehicleReferenceLibrary', () => ({ default: () => null }));
vi.mock('../../components/vehicle/VehicleDescriptionCard', () => ({ default: () => null }));
vi.mock('../../components/images/BundleReviewQueue', () => ({ default: () => null }));
vi.mock('../../components/images/ImageGallery', () => ({ default: () => null }));
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
  fixture.comments.mockClear();
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
