import { describe, expect, it } from 'vitest';
import { moneyAmounts } from './lib/cohortReport';
import {
  buildVehicleReport,
  fixtureMoney,
  parseSoldEvent,
  parseVehicleIdentity,
  parseVehicleReport,
  parseVehicleSales,
  soldUsd,
  vehicleSaleAnswer,
} from './lib/vehicleReport';

const VEH = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';
const OTHER = '11111111-1111-4111-8111-111111111111';

const VEHICLE = {
  id: VEH,
  year: 1983,
  make: 'GMC',
  model: 'K2500',
  trim: 'Sierra Classic',
  vin: '1GTGC24M0DJ123456',
  color: 'Red',
  transmission: 'Automatic',
  mileage: 88400,
  sale_price: 31000,
  nuke_estimate: 45000,
  listing_url: 'https://bringatrailer.com/listing/1983-gmc-k2500/',
  updated_at: '2026-11-20T12:00:00Z',
  description: 'A documented K2500.',
};

const SOLD = {
  id: 'evt-1',
  event_status: 'sold',
  final_price: 27500,
  currency_code: 'USD',
  sold_at: '2026-10-02T18:00:00Z',
  source_platform: 'Bring a Trailer',
  source_url: 'https://bringatrailer.com/listing/1983-gmc-k2500/',
  price_verification: 'verified',
  sale_truth_role: 'primary',
};

const TERMINAL = {
  resolved: true,
  price_distribution: { populated: true, median: 57208, n: 105, min: 12000, max: 90000, observed_at: '2026-11-20T00:00:00Z' },
  comps: {
    populated: true,
    rows: [
      {
        vehicle_id: OTHER, year: 1983, make: 'GMC', model: 'K2500', trim: null,
        sale_price: 64000, miles: 42000, platform: 'Bring a Trailer',
        sold_date: '2026-09-01', listing_url: 'https://bringatrailer.com/listing/other/',
      },
      {
        vehicle_id: VEH, year: 1983, make: 'GMC', model: 'K2500', trim: 'Sierra Classic',
        sale_price: 27500, miles: 88400, platform: 'Bring a Trailer',
        sold_date: '2026-10-02', listing_url: 'https://bringatrailer.com/listing/1983-gmc-k2500/',
      },
    ],
  },
};

describe('soldUsd and parseSoldEvent', () => {
  it('keeps USD, converts non-USD only with fx_to_usd, and drops unsold or unverified rows', () => {
    expect(soldUsd({ final_price: 100, currency_code: 'USD' })).toBe(100);
    expect(soldUsd({ final_price: 100, currency_code: 'GBP', fx_to_usd: 1.3 })).toBe(130);
    expect(soldUsd({ final_price: 100, currency_code: 'GBP' })).toBeNull();
    expect(soldUsd({ final_price: 0, currency_code: 'USD' })).toBeNull();
    expect(parseSoldEvent({ ...SOLD, event_status: 'ended' })).toBeNull();
    expect(parseSoldEvent({ ...SOLD, price_verification: 'unverified' })).toBeNull();
    expect(parseSoldEvent({ ...SOLD, price_verification: 'contradicted' })).toBeNull();
    expect(parseSoldEvent({ ...SOLD, sale_truth_role: 'duplicate' })).toBeNull();
    expect(parseSoldEvent({ ...SOLD, source_url: 'javascript:alert(1)' })?.source_url).toBeNull();
    expect(parseSoldEvent(SOLD)?.price).toBe(27500);
    expect(parseSoldEvent(SOLD)?.sold_date).toBe('2026-10-02');
  });
});

describe('buildVehicleReport', () => {
  it('does not treat vehicles.sale_price or nuke_estimate as a sale', () => {
    const page = buildVehicleReport(VEHICLE, [], null);
    expect(page).not.toBeNull();
    expect(page!.title).toBe('1983 GMC K2500 Sierra Classic | Nuke');
    expect(page!.path).toBe(`/vehicle/${VEH}`);
    expect(page!.body).toContain('<h1>1983 GMC K2500 Sierra Classic</h1>');
    expect(page!.body).toContain('No recorded sold event');
    expect(page!.body).toContain('1GTGC24M0DJ123456');
    expect(page!.body).toContain('88,400 miles');
    expect(page!.body).not.toContain('31,000');
    expect(page!.body).not.toContain('45,000');
    expect(page!.description).not.toContain('$31,000');
    expect(moneyAmounts(page!.body + page!.head + page!.description)).toEqual([]);
    expect(page!.head).toContain('"@type":"Vehicle"');
    expect(page!.head).toContain('"@type":"FAQPage"');
    expect(page!.head).not.toContain('"@type":"Offer"');
  });

  it('prints only sold-event and cohort fixture amounts, with source links', () => {
    const report = parseVehicleReport(VEHICLE, [SOLD], TERMINAL)!;
    const page = buildVehicleReport(VEHICLE, [SOLD], TERMINAL)!;
    expect(new Set(moneyAmounts(page.body + page.head + page.description))).toEqual(new Set(fixtureMoney(report)));
    expect(page.body).toContain('$27,500');
    expect(page.body).toContain('2026-10-02');
    expect(page.body).toContain('href="https://bringatrailer.com/listing/1983-gmc-k2500/"');
    expect(page.body).toContain('Median sale $57,208');
    expect(page.body).toContain('$64,000');
    expect(page.body).toContain(`href="https://nuke.ag/vehicle/${OTHER}"`);
    expect(page.body).not.toContain('31,000');
    expect(page.body).not.toContain('45,000');
    expect(page.body).toContain(`href="https://nuke.ag/cohort/gmc/k2500/1983"`);
    expect(vehicleSaleAnswer(report)).toContain('$27,500');
    expect(page.body).toContain('Record last updated 2026-11-20');
    expect(page.body).toContain('record clock, not a sale date');
  });

  it('omits amounts when the sales read failed, and does not use created_at as the event date', () => {
    const page = buildVehicleReport(VEHICLE, null, null)!;
    expect(page.body).toContain('could not be read');
    expect(page.body).toContain('does not fall back to vehicles.sale_price');
    expect(moneyAmounts(page.body + page.head + page.description)).toEqual([]);
    expect(parseSoldEvent({ ...SOLD, sold_at: null, ended_at: null, created_at: '2020-01-01T00:00:00Z' })?.sold_date).toBeNull();
  });

  it('drops identity fields that are empty and rejects a row with no id', () => {
    expect(parseVehicleIdentity({})).toBeNull();
    const bare = parseVehicleIdentity({ id: VEH, year: 1967, make: 'Chevrolet', model: 'Chevelle' })!;
    expect(bare.trim).toBeNull();
    expect(bare.vin).toBeNull();
    const page = buildVehicleReport({ id: VEH, year: 1967, make: 'Chevrolet', model: 'Chevelle' }, [], null)!;
    expect(page.body).not.toContain('<dt>VIN</dt>');
    expect(page.body).not.toContain('<dt>Mileage</dt>');
  });
});

describe('parseVehicleSales', () => {
  it('sorts dated sales newest first and caps the list', () => {
    const rows = [
      { ...SOLD, id: 'old', sold_at: '2020-01-01T00:00:00Z', final_price: 10000 },
      { ...SOLD, id: 'new', sold_at: '2026-10-02T00:00:00Z', final_price: 27500 },
    ];
    expect(parseVehicleSales(rows)?.map((s) => s.price)).toEqual([27500, 10000]);
    expect(parseVehicleSales(null)).toBeNull();
  });
});
