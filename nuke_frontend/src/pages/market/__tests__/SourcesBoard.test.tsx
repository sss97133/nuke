// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
import SourcesBoard, {
  computeStreamFacetDistribution,
  parseSourceLanding,
  resolveDrillTopMakes,
  resolveDrillTopModels,
} from '../SourcesBoard';

const columns = [
  'source', 'name', 'category', 'house', 'held_lots', 'held_at', 'population', 'population_method',
  'population_confidence', 'population_at', 'map_sales', 'map_usd', 'sales_12m', 'usd_12m', 'sales_prior_12m',
  'usd_prior_12m', 'months', 'live_lots', 'live_at', 'held_lots_before', 'before_day', 'landed_24h', 'landed_7d',
  'last_landed', 'days14', 'logo_url', 'business_type',
];
const days = (today: number) => [...Array(13).fill(0), today];
const hours = (lastHour: number) => [...Array(22).fill(2), 14, lastHour];
const mins = (last5m: number) => [...Array(10).fill(0), 4, last5m];

const boardPayload = {
  as_of: '2026-10-17T18:00:00Z',
  day: '2026-10-17',
  columns,
  rows: [
    [
      'bat', 'Bring a Trailer', 'auction', 'Bring a Trailer', 252399, '2026-10-17T17:50:00Z',
      264746, 'enumerated', 0.9, '2026-10-17T00:00:00Z', 183455, 8488000000, 39173, 2000000000,
      34829, 1700000000, [['2026-09', 3000, 150000000], ['2026-10', 1500, 80000000]], 1265,
      '2026-10-17T17:55:00Z', 251000, '2026-10-10', 2055, 3321, '2026-10-17T17:59:00Z',
      days(2055), 'https://example.test/bat.png', 'auction_house',
    ],
  ],
  not_ranked: {},
  landing: {
    hour: '2026-10-17T18:00:00Z',
    bucket_5m: '2026-10-17T17:55:00Z',
    totals: { landed_15m: 6, landed_1h: 18, landed_24h: 2055, landed_7d: 3321, hours24: hours(18), mins60: mins(6) },
    sources: {
      bat: { landed_15m: 6, landed_1h: 18, landed_24h: 2055, landed_7d: 3321, last_at: '2026-10-17T17:59:00Z', hours24: hours(18), mins60: mins(6) },
    },
  },
};

const landingPayload = {
  as_of: '2026-10-17T18:00:05Z',
  source: 'bat',
  hour: '2026-10-17T18:00:00Z',
  selected_hour: null,
  bucket_5m: '2026-10-17T17:55:00Z',
  landed_15m: 6,
  landed_1h: 18,
  landed_24h: 2055,
  landed_7d: 3321,
  last_landed: '2026-10-17T17:59:00Z',
  hours24: hours(18),
  mins60: mins(6),
  days14: days(2055),
  recent_vehicles: [
    {
      id: 'ev-991-gt3',
      source: 'bat',
      event_type: 'auction',
      event_status: 'sold',
      price: 168000,
      year: 2018,
      make: 'Porsche',
      model: '911 GT3',
      series: '991',
      trim: 'GT3',
      body_style: 'Coupe',
      vin: 'WP0AC2A98JS175001',
      mileage: 11200,
      record_date: '2026-10-16T18:00:00Z',
      title: '2018 Porsche 911 (991) GT3 Coupe',
      raw_title: '2018 Porsche 911 (991) GT3 Coupe',
      created_at: '2026-10-17T17:58:00Z',
    },
    {
      id: 'ev-991-carrera',
      source: 'bat',
      event_type: 'auction',
      event_status: 'active',
      price: 94000,
      year: 2016,
      make: 'Porsche',
      model: '911 Carrera',
      series: '991',
      trim: 'Carrera S',
      body_style: 'Coupe',
      vin: 'WP0AB2A96GS122002',
      mileage: 24500,
      record_date: '2026-10-18T19:00:00Z',
      title: '2016 Porsche 911 (991) Carrera S Coupe',
      raw_title: '2016 Porsche 911 (991) Carrera S Coupe',
      created_at: '2026-10-17T17:55:00Z',
    },
    {
      id: 'ev-vette-z06',
      source: 'bat',
      event_type: 'auction',
      event_status: 'sold',
      price: 82500,
      year: 2017,
      make: 'Chevrolet',
      model: 'Corvette Z06',
      series: 'C7',
      trim: 'Z06',
      body_style: 'Coupe',
      vin: '1G1YU2D68H5600003',
      mileage: 8900,
      record_date: '2026-10-15T20:00:00Z',
      title: '2017 Chevrolet Corvette Z06 Coupe',
      raw_title: '2017 Chevrolet Corvette Z06 Coupe',
      created_at: '2026-10-17T17:52:00Z',
    },
    {
      id: 'ev-c10-stepside',
      source: 'bat',
      event_type: 'auction',
      event_status: 'sold',
      price: 46000,
      year: 1978,
      make: 'Chevrolet',
      model: 'C10 Silverado Stepside',
      trim: 'Silverado',
      vin: 'CCL148F300004',
      mileage: 52000,
      record_date: '2026-10-14T20:00:00Z',
      title: '1978 Chevrolet C10 Silverado Stepside Pickup',
      raw_title: '1978 Chevrolet C10 Silverado Stepside Pickup',
      created_at: '2026-10-17T17:50:00Z',
    },
  ],
};

describe('SourcesBoard Venue Drill-down interactive Make/Model and Facet filtering', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    fixture.rpc.mockReset();
  });

  it('computes top makes, top models, and live facet distribution from recent_vehicles', () => {
    const detail = parseSourceLanding(landingPayload)!;
    expect(detail.recent).toHaveLength(4);

    const topMakes = resolveDrillTopMakes(detail, detail.recent);
    expect(topMakes).toEqual([
      { make: 'Chevrolet', count: 2 },
      { make: 'Porsche', count: 2 },
    ]);

    const topModels = resolveDrillTopModels(detail, detail.recent);
    expect(topModels).toHaveLength(4);
    expect(topModels[0]).toMatchObject({ make: 'Porsche', model: '911 Carrera', count: 1 });

    const facets = computeStreamFacetDistribution(detail.recent);
    expect(facets).toEqual(
      expect.arrayContaining([
        { axis: 'series', prefix: 'SER', value: '991', count: 2 },
        { axis: 'trim', prefix: 'TRM', value: 'Z06', count: 1 },
        { axis: 'body', prefix: 'BDY', value: 'Coupe', count: 3 },
      ]),
    );
  });
});
