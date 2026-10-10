import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ vehicle: {} as any, evidence: {} as any, loading: false, error: null as string | null,
  priceFacts: null as any, priceSettled: true, priceFailed: false }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({
  vehicle: fixture.vehicle, vehicleId: fixture.vehicle.id, canEdit: false,
  isVerifiedOwner: false, isMobile: true, setGalleryFilter: vi.fn(), auctionPulse: null,
}) }));
vi.mock('./hooks/useFieldEvidence', () => ({ useFieldEvidence: () => ({ evidence: fixture.evidence, loading: fixture.loading, error: fixture.error }) }));
vi.mock('./hooks/useVehiclePriceFacts', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useVehiclePriceFacts')>('./hooks/useVehiclePriceFacts');
  return { ...actual, useVehiclePriceFacts: () => ({ priceFacts: fixture.priceFacts, priceSettled: fixture.priceSettled, priceFailed: fixture.priceFailed }) };
});
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
  fixture.loading = false;
  fixture.error = null;
  fixture.priceFacts = null;
  fixture.priceSettled = true;
  fixture.priceFailed = false;
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

it('provides a named keyboard control with the actual field drawer and expanded state', () => {
  const dom = new JSDOM(renderToStaticMarkup(<VehicleDossierPanel />));
  const control = dom.window.document.querySelector('[data-field="mileage"] button[aria-controls]');
  expect(control?.getAttribute('type')).toBe('button');
  expect(control?.getAttribute('aria-label')).toBe('Show MILEAGE source claims');
  expect(control?.getAttribute('aria-expanded')).toBe('false');
  expect(control?.hasAttribute('disabled')).toBe(false);
  expect(dom.window.document.getElementById(control!.getAttribute('aria-controls')!)).not.toBeNull();
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

describe.each(surfaces)('unsupported coverage score: %s', (_name, render) => {
  it.each([0, 80, 100, null, undefined, NaN, Infinity])('does not surface an unexplained score: %s', value => {
    fixture.vehicle.data_quality_score = value;
    const before = JSON.stringify({ vehicle: fixture.vehicle, evidence: fixture.evidence });
    expect(renderSurface(render)).toBeNull();
    expect(JSON.stringify({ vehicle: fixture.vehicle, evidence: fixture.evidence })).toBe(before);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

it('preserves the engagement badge when a coverage score is unknown', () => {
  fixture.vehicle.data_quality_score = null;
  fixture.vehicle.bid_count = 4;
  const html = renderToStaticMarkup(<VehicleBadgeBar />);
  expect(html).toContain('BIDS 4');
  expect(html).not.toContain('data-coverage-score');
});

describe('dossier claim coverage does not assert verification', () => {
  function panel() {
    return new JSDOM(renderToStaticMarkup(<VehicleDossierPanel />)).window.document;
  }

  it('retains repeated matching and differing claims without counting source types as independent support', () => {
    const a = { ...fixture.evidence.mileage.primary, id: 'offline-color-a', field_name: 'color', field_value: 'Blue', source_type: 'bat_listing' };
    const b = { ...a, id: 'offline-color-b', source_type: 'ai_extraction' };
    const c = { ...a, id: 'offline-color-c', field_value: 'Red' };
    fixture.vehicle.color = 'Blue';
    fixture.evidence.color = { primary: a, sources: [a, b, c], agreementCount: 2, totalSources: 3, hasConflict: true, conflictType: 'genuine' };
    const before = JSON.stringify(fixture.evidence);
    const doc = panel();
    const coverage = doc.querySelector('[data-testid="source-claim-coverage"]')!;
    expect(coverage.textContent).toContain('2 of 16 core fields have claim records');
    expect(coverage.textContent).toContain('2 have differing reported values');
    expect(coverage.textContent).toContain('Claim record counts do not establish independent support or verification');
    const field = doc.querySelector('[data-field="color"]')!;
    expect(field.getAttribute('title')).toContain('3 retained claim records');
    expect(field.getAttribute('title')).toContain('Reported values differ');
    expect(field.outerHTML).not.toContain('Consensus:');
    expect(field.textContent).toContain('Blue');
    expect(field.textContent).toContain('Red');
    expect(JSON.stringify(fixture.evidence)).toBe(before);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each(['dyno', 'inspection_report', 'photo_verified', 'vin_plate_photo'])('does not infer physical verification from a %s source label', source_type => {
    fixture.evidence.mileage.sources = [{ ...fixture.evidence.mileage.primary, source_type }];
    fixture.evidence.mileage.primary = fixture.evidence.mileage.sources[0];
    fixture.evidence.mileage.hasConflict = false;
    const doc = panel();
    expect(doc.querySelector('[data-field="mileage"]')?.getAttribute('title')).toContain('verification unknown');
    expect(doc.body.innerHTML).not.toMatch(/scientifically tested|physically inspected|multi-source consensus|\d+ BEDROCK|\d+ INSPECTED|\d+ CONSENSUS|data-verification=/);
  });

  it('names the fixed core-field denominator and does not count extended fields as core coverage', () => {
    const row = { ...fixture.evidence.mileage.primary, field_name: 'horsepower', field_value: '300' };
    fixture.evidence = { horsepower: { primary: row, sources: [row], hasConflict: false } };
    expect(panel().querySelector('[data-testid="source-claim-coverage"]')?.textContent).toContain('0 of 16 core fields have claim records');
  });

  it('keeps loading separate from a successfully empty read', () => {
    fixture.evidence = {}; fixture.loading = true;
    const coverage = panel().querySelector('[data-testid="source-claim-coverage"]')!;
    expect(coverage.textContent).toContain('Loading source claim coverage');
    expect(coverage.textContent).not.toContain('0 of 16');
    fixture.loading = false;
    expect(panel().querySelector('[data-testid="source-claim-coverage"]')?.textContent).toContain('0 of 16 core fields have claim records');
  });

  it('keeps a failed read unavailable while preserving any retained claims for inspection', () => {
    fixture.error = 'Offline reader unavailable';
    const doc = panel();
    const coverage = doc.querySelector('[data-testid="source-claim-coverage"]')!;
    expect(coverage.textContent).toContain('Source claim coverage unavailable');
    expect(coverage.textContent).not.toContain('of 16 core fields');
    expect(doc.querySelector('[data-field="mileage"]')?.textContent).toContain('87000');
  });
});

describe('dossier sold badge uses only the settled typed price outcome', () => {
  const hasSoldBadge = () => renderToStaticMarkup(<VehicleDossierPanel />).includes('>SOLD</span>');

  it.each([
    ['estimate with a positive amount', { price_kind: 'estimate', price_amount: 40000 }],
    ['asking price', { price_kind: 'ask', price_amount: 40000 }],
    ['bid', { price_kind: 'bid', price_amount: 40000, price_live: false }],
    ['unknown typed kind', { price_kind: null, price_amount: 40000 }],
    ['missing typed amount', { price_kind: 'sold', price_amount: null }],
  ])('does not call %s SOLD when raw status and sale_price look positive', (_name, facts) => {
    fixture.vehicle.sale_status = 'sold';
    fixture.vehicle.auction_outcome = 'sold';
    fixture.vehicle.sale_price = 40000;
    fixture.priceFacts = facts;
    expect(hasSoldBadge()).toBe(false);
  });

  it('waits for the typed reader to settle before showing SOLD', () => {
    fixture.vehicle.sale_price = 40000;
    fixture.priceFacts = { price_kind: 'sold', price_amount: 40000 };
    fixture.priceSettled = false;
    expect(hasSoldBadge()).toBe(false);
    fixture.priceSettled = true;
    expect(hasSoldBadge()).toBe(true);
  });

  it('does not reuse a cached sold result after the typed reader fails', () => {
    fixture.vehicle.sale_price = 40000;
    fixture.priceFacts = { price_kind: 'sold', price_amount: 40000 };
    fixture.priceSettled = true;
    fixture.priceFailed = true;
    expect(hasSoldBadge()).toBe(false);
  });

  it('shows SOLD for a settled typed sold result even when raw status fields disagree', () => {
    fixture.vehicle.sale_status = 'available';
    fixture.vehicle.auction_outcome = null;
    fixture.vehicle.sale_price = null;
    fixture.priceFacts = { price_kind: 'sold', price_amount: 40000 };
    expect(hasSoldBadge()).toBe(true);
  });
});
