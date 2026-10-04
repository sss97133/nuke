import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ vehicle: {} as any, evidence: {} as any }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({
  vehicle: fixture.vehicle, vehicleId: fixture.vehicle.id, canEdit: false,
  isVerifiedOwner: false, isMobile: true, setGalleryFilter: vi.fn(), auctionPulse: null,
}) }));
vi.mock('./hooks/useFieldEvidence', () => ({ useFieldEvidence: () => ({ evidence: fixture.evidence, loading: false }) }));
vi.mock('./hooks/useVehiclePriceFacts', () => ({
  useVehiclePriceFacts: () => ({ priceFacts: null }), priceKindLabel: () => 'PRICE',
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../components/popups/usePopup', () => ({ usePopup: () => ({ openPopup: vi.fn() }) }));
vi.mock('../../hooks/useAuctionComments', () => ({ useAuctionCommentStats: () => ({ data: { commentCount: 0 } }) }));
vi.mock('../../components/popups/CommentsPopup', () => ({ CommentsPopup: () => null }));
vi.mock('../../components/popups/BidsPopup', () => ({ BidsPopup: () => null }));
vi.mock('../../components/popups/WatchersPopup', () => ({ WatchersPopup: () => null }));
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../components/VehicleDataQualityRating', () => ({ default: () => null }));
vi.mock('../../components/vehicle/URLDataDrop', () => ({ default: () => null }));
vi.mock('../../components/vehicle/InlineVINEditor', () => ({ default: () => null }));
vi.mock('../../components/vehicle/BATListingManager', () => ({ BATListingManager: () => null }));
vi.mock('../../components/common/FaviconIcon', () => ({ FaviconIcon: () => null }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: vi.fn(() => { throw new Error('Coverage display must not read or write new data'); }),
  rpc: vi.fn(() => { throw new Error('Coverage display must not invoke a writer'); }),
} }));

import VehicleDossierPanel from './VehicleDossierPanel';
import VehicleBasicInfo from './VehicleBasicInfo';
import VehicleBadgeBar from './VehicleBadgeBar';
import { supabase } from '../../lib/supabase';

beforeEach(() => {
  vi.clearAllMocks();
  fixture.vehicle = {
    id: 'local-public-profile', year: 1966, make: 'Ford', model: 'Mustang', mileage: 87,
    data_quality_score: 100, confidence_score: 100, updated_at: '2026-09-27T16:47:45.300576Z',
    // These are not a score-specific assessment clock or proof of verification.
    quality_last_assessed: '2026-10-01T00:00:00Z', last_quality_check: '2026-10-02T00:00:00Z',
  };
  const primary = { id: 'local-87', field_name: 'mileage', field_value: '87', source_type: 'bat_listing',
    confidence: 0.9, status: 'accepted', created_at: '2026-03-24T07:49:45.022238Z' };
  const other = { ...primary, id: 'local-87000', field_value: '87000', confidence: 0.8, status: 'pending' };
  fixture.evidence = { mileage: { primary, sources: [primary, other, primary], agreementCount: 2,
    totalSources: 3, hasConflict: true, conflictType: 'genuine' } };
});

const surfaces = [
  ['dossier', () => <VehicleDossierPanel />],
  ['basic info', () => <VehicleBasicInfo vehicle={fixture.vehicle} session={null} permissions={{ canEdit: false } as any} />],
  ['badge bar', () => <VehicleBadgeBar />],
] as const;

function renderSurface(render: () => React.ReactElement) {
  const dom = new JSDOM(renderToStaticMarkup(render()));
  return dom.window.document.querySelector('[data-testid="data-coverage-score"]');
}

describe.each(surfaces)('stored coverage display: %s', (_name, render) => {
  it('keeps a 100 score qualified even beside conflicting accepted/pending mileage', () => {
    const before = JSON.stringify({ vehicle: fixture.vehicle, evidence: fixture.evidence });
    const score = renderSurface(render)!;
    expect(score.textContent).toContain('100/100');
    expect(score.textContent?.toLowerCase()).toContain('stored coverage heuristic');
    expect(score.textContent?.toLowerCase()).toContain('assessment time unknown');
    expect(score.outerHTML).not.toMatch(/data quality|badge--dq-green|badge--dq-orange|var\(--success\)|var\(--warning\)|var\(--error\)/i);
    // Mobile tooltips are hidden; the key qualification must remain outside one.
    score.querySelector('.badge__tooltip')?.remove();
    expect(score.textContent?.toLowerCase()).toContain('verification unknown');
    expect(JSON.stringify({ vehicle: fixture.vehicle, evidence: fixture.evidence })).toBe(before);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('preserves a genuine zero without a truth or failure color', () => {
    fixture.vehicle.data_quality_score = 0;
    const score = renderSurface(render)!;
    expect(score.textContent).toContain('0/100');
    expect(score.outerHTML).not.toMatch(/badge--dq-orange|var\(--error\)/);
  });

  it.each([null, undefined, NaN, Infinity, -1, 101, '100'])('does not invent a score for unknown or invalid input: %s', value => {
    fixture.vehicle.data_quality_score = value;
    expect(renderSurface(render)).toBeNull();
  });
});

it('preserves the engagement badge when a coverage score is unknown', () => {
  fixture.vehicle.data_quality_score = null;
  fixture.vehicle.bid_count = 4;
  const html = renderToStaticMarkup(<VehicleBadgeBar />);
  expect(html).toContain('BIDS 4');
  expect(html).not.toContain('data-coverage-score');
});
