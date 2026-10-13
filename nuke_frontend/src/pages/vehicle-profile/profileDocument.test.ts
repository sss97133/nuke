import { describe, it, expect } from 'vitest';
import { isProfileRead, profileDocumentFrom, type ProfileRead } from './profileDocument';

// The shape vehicle_profile_read emits. Its values are proved by supabase/sql/test_vehicle_profile_read.sql;
// this side proves what the renderer does with them.
const strip: ProfileRead['sections'][number] = {
  kind: 'strip',
  coverage: { n: 3, of: 6, grain: 'facts attributed', as_of: '2026-09-01T00:00:00+00:00' },
  facets: [
    { dimension: 'body_style', label: 'Coupe', member: { value: 'Coupe', source: { kind: 'listing', label: 'user-submission listing', method: 'user-submission_listing' }, observed_at: '2026-08-01T00:00:00+00:00', trust: 0.8 } },
    { dimension: 'engine', label: '4.7L V8', member: { value: '4.7L V8', source: { kind: 'listing', label: 'user-submission listing', method: 'user-submission_listing' }, observed_at: '2026-09-01T00:00:00+00:00', trust: 0.8 } },
    { dimension: 'transmission', label: 'Automatic', member: { value: 'Automatic', source: { kind: 'legacy', label: 'vehicle record' }, observed_at: null, trust: 0.3 } },
    { dimension: 'drivetrain', label: 'RWD', member: { value: 'RWD', source: { kind: 'legacy', label: 'vehicle record' }, observed_at: null, trust: 0.3 } },
    { dimension: 'location', label: 'Boulder City, NV', member: { value: 'Boulder City, NV', source: { kind: 'legacy', label: 'vehicle record' }, observed_at: null, trust: 0.3 } },
  ],
  odometer: { value: 10000, unit: 'mi', source: { kind: 'listing', label: 'bring a trailer' }, observed_at: null, trust: 0.6 },
};
const read: ProfileRead = {
  vehicle_id: 'v-1', viewer: 'anon', read_at: '2026-10-13T14:00:00+00:00',
  sections: [
    {
      kind: 'masthead',
      identity_source: { year: 1966, make: 'Ford', model: '1966 Ford Mustang Coupe | Bring a Trailer', normalized_model: null, series: null, trim: 'Hertz', transmission: 'Automatic', transmission_model: null },
      year: 1966, make: 'Ford', model: '1966 Ford Mustang Coupe | Bring a Trailer',
      price: { value: 24000, unit: 'USD', source: { kind: 'listing', url: 'https://bringatrailer.com/listing/x', label: 'BRING A TRAILER', method: 'sold' }, observed_at: '2026-09-21T00:00:00+00:00', trust: 0.9 },
      priceLabel: 'Last recorded sale',
    },
    strip,
  ],
};

describe('profileDocumentFrom', () => {
  it('tokenizes the identity the read ships and keeps every claim as sent', () => {
    const doc = profileDocumentFrom(read, false);
    expect(doc.vehicle_id).toBe('v-1');
    expect(doc.viewer).toBe('anon');
    expect(doc.read_at).toBe('2026-10-13T14:00:00+00:00');
    const masthead = doc.sections[0];
    expect(masthead.kind).toBe('masthead');
    if (masthead.kind === 'masthead') {
      expect(masthead.identity.primary.map(t => t.value)).toEqual(['1966', 'Ford', 'Mustang Coupe']);
      expect(masthead.identity.differentiators.map(t => t.value)).toEqual(['Hertz']);
      expect(masthead.model).toBe('Mustang Coupe');
      expect(masthead.price?.value).toBe(24000);
      expect(masthead.priceLabel).toBe('Last recorded sale');
      expect('identity_source' in masthead).toBe(false);
    }
    expect(doc.sections[1]).toBe(strip);
  });
  it('leaves the price to the live stack when an auction is live', () => {
    const masthead = profileDocumentFrom(read, true).sections[0];
    if (masthead.kind === 'masthead') {
      expect(masthead.price).toBeNull();
      expect(masthead.priceLabel).toBeNull();
      expect(masthead.identity.primary.length).toBe(3);
    }
  });
  it('keeps the record model when the identity columns tokenize to nothing', () => {
    const masthead = profileDocumentFrom({ ...read, sections: [{ ...read.sections[0], identity_source: { year: 1966, make: 'Ford', model: '' }, model: null } as ProfileRead['sections'][number]] }, false).sections[0];
    if (masthead.kind === 'masthead') expect(masthead.model).toBeNull();
  });
});

describe('isProfileRead', () => {
  it('accepts the read', () => {
    expect(isProfileRead(read)).toBe(true);
    expect(isProfileRead({ ...read, sections: [read.sections[0]] })).toBe(true);
  });
  it('rejects anything the renderer could not trust', () => {
    expect(isProfileRead(null)).toBe(false);
    expect(isProfileRead('{}')).toBe(false);
    expect(isProfileRead({ ...read, viewer: 'admin' })).toBe(false);
    expect(isProfileRead({ ...read, sections: null })).toBe(false);
    expect(isProfileRead({ ...read, sections: [{ kind: 'banner' }] })).toBe(false);
    expect(isProfileRead({ ...read, sections: [{ kind: 'masthead', year: 1966 }] })).toBe(false);
    expect(isProfileRead({ vehicle_id: 'v', viewer: 'anon', sections: [] })).toBe(false);
  });
});
