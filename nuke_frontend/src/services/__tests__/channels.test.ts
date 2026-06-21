import { describe, it, expect } from 'vitest';
import { CHANNELS, CHANNELS_BY_ID, arsTierToRank, meetsReadiness } from '../channelRegistry';
import { dispatchChannel, mapToEbayAddItem, mapToBatSubmission } from '../channelAdapters';

describe('channel registry', () => {
  it('registers a coherent set of outlets', () => {
    expect(CHANNELS.length).toBeGreaterThanOrEqual(12);
    expect(CHANNELS.every((c) => !!c.mechanism && !!c.platform)).toBe(true);
    expect(new Set(CHANNELS.map((c) => c.id)).size).toBe(CHANNELS.length);
  });
});

describe('readiness gate — maps real auction_readiness.tier values', () => {
  it('ranks tiers, including legacy values, conservatively', () => {
    expect(arsTierToRank('TIER_1_EXCEPTIONAL')).toBe(3);
    expect(arsTierToRank('TIER_2_COMPETITIVE')).toBe(2);
    expect(arsTierToRank('TIER_3_VIABLE')).toBe(1);
    expect(arsTierToRank('TIER_4_INCOMPLETE')).toBe(0);
    expect(arsTierToRank('EARLY_STAGE')).toBe(0);
    expect(arsTierToRank('NEEDS_WORK')).toBe(0);
    expect(arsTierToRank('DISCOVERY_ONLY')).toBe(0);
    expect(arsTierToRank(null)).toBe(0);
  });

  it('locks channels until the vehicle clears their floor', () => {
    const bat = CHANNELS_BY_ID['bring_a_trailer'];
    const ebay = CHANNELS_BY_ID['ebay_motors'];
    const rm = CHANNELS_BY_ID['rm_sothebys'];
    const nuke = CHANNELS_BY_ID['nuke_live'];
    expect(meetsReadiness(bat, 'TIER_2_COMPETITIVE')).toBe(true);
    expect(meetsReadiness(bat, 'TIER_3_VIABLE')).toBe(false);
    expect(meetsReadiness(ebay, 'TIER_3_VIABLE')).toBe(true);
    expect(meetsReadiness(ebay, 'TIER_4_INCOMPLETE')).toBe(false);
    expect(meetsReadiness(rm, 'TIER_2_COMPETITIVE')).toBe(false);
    expect(meetsReadiness(nuke, null)).toBe(true);
  });
});

describe('dispatch — routes each mechanism correctly', () => {
  const ctx = { vehicleId: 'v1', pkg: {}, askingPriceCents: 2_500_000 };

  it('native lists immediately', () => {
    expect(dispatchChannel(CHANNELS_BY_ID['nuke_live'], ctx).status).toBe('active');
  });
  it('eBay blocks on the account link but carries a payload', () => {
    const r = dispatchChannel(CHANNELS_BY_ID['ebay_motors'], ctx);
    expect(r.status).toBe('blocked');
    expect(r.needs).toBe('ebay_account_link');
    expect(r.payload).toBeTruthy();
  });
  it('dealer feed blocks on dealer identity', () => {
    const r = dispatchChannel(CHANNELS_BY_ID['classiccars_com'], ctx);
    expect(r.status).toBe('blocked');
    expect(r.needs).toBe('dealer_identity');
  });
  it('agent pilot queues a browser_submit job', () => {
    const r = dispatchChannel(CHANNELS_BY_ID['bring_a_trailer'], ctx);
    expect(r.status).toBe('prepared');
    expect((r.job as any)?.kind).toBe('browser_submit');
  });
  it('BaT agent pilot carries a projected field_map + human keys', () => {
    const r = dispatchChannel(CHANNELS_BY_ID['bring_a_trailer'], {
      vehicleId: 'v1',
      pkg: { identity: { year: 1966, make: 'Ford', model: 'Mustang', vin: '6F07C219593' } },
    });
    expect((r.job as any)?.field_map?.chassis?.value).toBe('6F07C219593');
    expect((r.job as any)?.human_keys).toEqual(
      expect.arrayContaining(['ownership_attestation', 'final_approval']),
    );
    expect(r.payload).toBeTruthy();
  });
  it('non-BaT agent pilot enqueues bare (no field_map yet)', () => {
    const r = dispatchChannel(CHANNELS_BY_ID['craigslist'], ctx);
    expect((r.job as any)?.field_map).toBeUndefined();
    expect(r.payload ?? null).toBeNull();
  });
  it('concierge queues a consignment_handoff job', () => {
    const r = dispatchChannel(CHANNELS_BY_ID['rm_sothebys'], ctx);
    expect(r.status).toBe('prepared');
    expect((r.job as any)?.kind).toBe('consignment_handoff');
  });
});

describe('eBay AddItem mapping — matches the Trading API schema', () => {
  const pkg = {
    identity: {
      year: 1983, make: 'Chevrolet', model: 'K5 Blazer', vin: '1GCEK14H9DJ123456', mileage: 80000,
      title_status: 'clean', transmission: 'automatic', drivetrain: '4WD', engine_type: 'V8 350',
      body_style: 'SUV', exterior_color: 'red', interior_color: 'black', location: 'Phoenix, AZ',
    },
    listing_content: { title: '1983 Chevrolet K5 Blazer', description: 'Restored.' },
    photos: { ordered: Array.from({ length: 30 }, (_, i) => ({ url: `https://img/${i}.jpg` })) },
  };
  const item = mapToEbayAddItem({ vehicleId: 'v1', pkg, askingPriceCents: 2_500_000, reserveCents: 2_000_000 });

  it('sets the required Motors fields', () => {
    expect(item.SiteID).toBe(100);
    expect(item.VIN).toBe('1GCEK14H9DJ123456');
    expect(item.SellerProvidedTitle).toBe('1983 Chevrolet K5 Blazer');
    expect(item.StartPrice).toBe(25000);
    expect((item.PrimaryCategory as any).CategoryID).toBe('6001');
  });
  it('wraps item specifics in NameValueList and routes title status there', () => {
    const nvl = (item.ItemSpecifics as any).NameValueList as Array<{ Name: string; Value: unknown }>;
    expect(nvl.map((s) => s.Name)).toEqual(expect.arrayContaining(['Make', 'Model', 'Year']));
    expect(nvl.some((s) => s.Name === 'Vehicle Title' && s.Value === 'clean')).toBe(true);
    expect(nvl.every((s) => s.Value != null && s.Value !== '')).toBe(true);
  });
  it('caps pictures at the eBay limit of 24', () => {
    expect((item.PictureDetails as any).PictureURL.length).toBe(24);
  });
});

describe('BaT submission mapping — projects onto field_map with tiers', () => {
  const pkg = {
    identity: {
      year: 1966, make: 'Ford', model: 'Mustang', vin: '6F07C219593', mileage: 109000,
      transmission: 'automatic', body_style: 'Coupe', engine: '289 V8',
      exterior_color: 'Black', location: 'Boulder City, NV', title_status: 'clean',
      zip: '89005', owned_time: 2023,
    },
    listing_content: { title: '1966 Ford Mustang', description: 'Comprehensive restoration.' },
  };

  it('tiers each field by how its value is justified', () => {
    const { fields } = mapToBatSubmission({ vehicleId: 'v1', pkg, reserveCents: 0 });
    expect(fields.chassis).toEqual({ value: '6F07C219593', tier: 'decode' });
    expect(fields.title_status.tier).toBe('decode');
    expect(fields.location_zip).toEqual({ value: '89005', tier: 'decode' });
    expect(fields.owned_time).toEqual({ value: 2023, tier: 'decode' });
    expect(fields.exterior_color.tier).toBe('observe');
    expect(fields.description.tier).toBe('deliberate');
  });
  it('always requires ownership + final-approval human keys', () => {
    const { humanKeys } = mapToBatSubmission({ vehicleId: 'v1', pkg });
    expect(humanKeys).toContain('ownership_attestation');
    expect(humanKeys).toContain('final_approval');
    expect(humanKeys).not.toContain('contract_signature'); // concierge-only
  });
  it('omits empty fields rather than projecting nulls', () => {
    const { fields } = mapToBatSubmission({ vehicleId: 'v1', pkg: { identity: { year: 1966 } } });
    expect(fields.chassis).toBeUndefined();
    expect(fields.make_model_year.value).toBe(1966);
  });
});
