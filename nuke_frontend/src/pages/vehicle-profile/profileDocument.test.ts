import { describe, it, expect } from 'vitest';
import { attributedClaim, odometerClaim, priceClaim, sourceKindFor, buildProfileDocument, type EvidenceRow } from './profileDocument';

const vehicle: any = {
  id: 'v-1', year: 1966, make: 'Ford', model: 'Mustang', normalized_model: 'Mustang', series: null, trim: null,
  body_style: 'Coupe', engine_size: '4.7L V8', transmission: 'Automatic', drivetrain: 'RWD',
  city: 'Boulder City', state: 'NV', mileage: 10000, mileage_source: 'bring a trailer', listing_kind: 'vehicle',
};
const sold: any = {
  price_kind: 'sold', price_amount: 24000, price_as_of: '2026-09-21T00:00:00+00:00', price_live: false,
  sold_amount: 24000, sold_on: '2026-09-21', ask_amount: null, ask_as_of: null, bid_amount: null, bid_on: null,
  outcome: 'sold', platform: 'bring-a-trailer', source_url: 'https://bringatrailer.com/listing/x',
};
const row = (over: Partial<EvidenceRow>): EvidenceRow => ({
  field_name: 'engine_size', proposed_value: '4.7L V8', source_type: 'user-submission_listing',
  source_confidence: 80, extracted_at: '2026-09-01T00:00:00Z', status: 'accepted', ...over,
});

describe('sourceKindFor', () => {
  it('maps a method name to an evidence class', () => {
    expect(sourceKindFor('vehicle_record')).toBe('legacy');
    expect(sourceKindFor('ls3_documentation_corpus_pixel_verified')).toBe('image');
    expect(sourceKindFor('user-submission_listing')).toBe('listing');
    expect(sourceKindFor('bat')).toBe('listing');
    expect(sourceKindFor('factory_service_manual')).toBe('document');
    expect(sourceKindFor(null)).toBe('legacy');
  });
});

describe('attributedClaim', () => {
  it('falls back to the legacy record with low trust and no clock', () => {
    const c = attributedClaim('RWD', 'drivetrain', []);
    expect(c.source.kind).toBe('legacy');
    expect(c.trust).toBe(0.3);
    expect(c.observed_at).toBeNull();
  });
  it('takes an accepted row whose value matches, with its confidence and clock', () => {
    const c = attributedClaim('4.7L V8', 'engine_size', [row({})]);
    expect(c.source.kind).toBe('listing');
    expect(c.trust).toBe(0.8);
    expect(c.observed_at).toBe('2026-09-01T00:00:00Z');
  });
  it('ignores pending, superseded and mismatching rows', () => {
    const c = attributedClaim('4.7L V8', 'engine_size', [row({ status: 'pending' }), row({ status: 'superseded' }), row({ proposed_value: '289ci V8' })]);
    expect(c.source.kind).toBe('legacy');
  });
  it('prefers the most confident matching row', () => {
    const c = attributedClaim('4.7L V8', 'engine_size', [row({ source_confidence: 60 }), row({ source_confidence: 95, source_type: 'factory_service_manual' })]);
    expect(c.source.kind).toBe('document');
    expect(c.trust).toBe(0.95);
  });
});

describe('odometerClaim', () => {
  it('is not shown without a source', () => {
    expect(odometerClaim({ mileage: 1, mileage_source: null }, [])).toBeNull();
    expect(odometerClaim({ mileage: 0, mileage_source: 'x' }, [])).toBeNull();
  });
  it('reads the record source when no accepted evidence matches the reading', () => {
    const c = odometerClaim(vehicle, [row({ field_name: 'mileage', proposed_value: '100010' })])!;
    expect(c.value).toBe(10000);
    expect(c.unit).toBe('mi');
    expect(c.source.kind).toBe('listing');
    expect(c.source.label).toBe('bring a trailer');
  });
  it('takes matching accepted evidence first', () => {
    const c = odometerClaim(vehicle, [row({ field_name: 'mileage', proposed_value: '10000', source_type: 'bat', source_confidence: 90 })])!;
    expect(c.trust).toBe(0.9);
    expect(c.source.kind).toBe('listing');
  });
});

describe('priceClaim', () => {
  it('labels a sale as the last recorded sale, with platform, link, clock and trust', () => {
    const p = priceClaim(sold)!;
    expect(p.label).toBe('Last recorded sale');
    expect(p.claim.value).toBe(24000);
    expect(p.claim.unit).toBe('USD');
    expect(p.claim.source.label).toBe('BRING A TRAILER');
    expect(p.claim.source.url).toContain('bringatrailer');
    expect(p.claim.observed_at).toBe('2026-09-21T00:00:00+00:00');
    expect(p.claim.trust).toBe(0.9);
    expect(p.classified).toBe(false);
  });
  it('is null without a typed price', () => {
    expect(priceClaim(null)).toBeNull();
    expect(priceClaim({ ...sold, price_kind: 'estimate' })).toBeNull();
  });
});

describe('buildProfileDocument', () => {
  it('states coverage as attributed facts over shown facts', () => {
    const doc = buildProfileDocument({
      vehicle, priceFacts: sold, viewer: 'anon', priceOwnedByLiveStack: false, readAt: '2026-10-13T00:00:00Z',
      evidence: [row({}), row({ field_name: 'body_style', proposed_value: 'Coupe' })],
    });
    const masthead = doc.sections[0];
    expect(masthead.kind).toBe('masthead');
    if (masthead.kind === 'masthead') {
      expect(masthead.model).toBe('Mustang');
      expect(masthead.price?.value).toBe(24000);
      expect(masthead.priceLabel).toBe('Last recorded sale');
    }
    const strip = doc.sections.find(s => s.kind === 'strip');
    expect(strip?.kind).toBe('strip');
    if (strip?.kind === 'strip') {
      expect(strip.facets.map(f => f.label)).toEqual(['Coupe', '4.7L V8', 'Automatic', 'RWD', 'Boulder City, NV']);
      expect(strip.odometer?.value).toBe(10000);
      // body and engine through evidence, the odometer through the record's own source; drivetrain, transmission and location are legacy
      expect(strip.coverage).toEqual({ n: 3, of: 6, grain: 'facts attributed', as_of: '2026-09-01T00:00:00Z' });
    }
    expect(doc.viewer).toBe('anon');
    expect(doc.read_at).toBe('2026-10-13T00:00:00Z');
  });
  it('leaves the price to the live stack when an auction is live', () => {
    const doc = buildProfileDocument({ vehicle, priceFacts: sold, evidence: [], viewer: 'anon', priceOwnedByLiveStack: true });
    const masthead = doc.sections[0];
    if (masthead.kind === 'masthead') {
      expect(masthead.price).toBeNull();
      expect(masthead.priceLabel).toBeNull();
    }
  });
  it('omits the strip when nothing is recorded', () => {
    const doc = buildProfileDocument({ vehicle: { id: 'v', year: 1990, make: 'Acme', model: 'Thing' }, priceFacts: null, evidence: [], viewer: 'anon', priceOwnedByLiveStack: false });
    expect(doc.sections.map(s => s.kind)).toEqual(['masthead']);
  });
});
