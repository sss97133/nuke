import { describe, it, expect } from 'vitest';
import { CHANNELS, CHANNELS_BY_ID, arsTierToRank, meetsReadiness } from '../channelRegistry';
import { dispatchChannel, mapToEbayAddItem, mapToBatSubmission, componentsToOptions } from '../channelAdapters';
import { BAT_FORM } from '../batSubmissionForm';

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
  it('BaT job retains contributor citations and open audit without turning statements into description fields', () => {
    const evidence = { status: 'available', testimony: [{ observation_id: 'observation', statement: 'Builder statement',
      source: { contributor_id: 'contributor', name: 'Example Builder', relationship: 'builder' }, evidence_kind: 'contributor_statement' }],
      documents: [{ image_id: 'receipt' }], audit: { open: [{ key: 'engine_stamp' }] } };
    const r = dispatchChannel(CHANNELS_BY_ID['bring_a_trailer'], { vehicleId: 'v1', pkg: { contributor_evidence: evidence } });
    const snapshot = JSON.parse(JSON.stringify(r.job));
    expect(snapshot.contributor_evidence).toEqual(evidence);
    expect(JSON.stringify(snapshot.field_map)).not.toContain('Builder statement');
    expect(snapshot.human_keys).toContain('ownership_attestation');
  });
  it('BaT agent pilot carries a projected field_map + human keys', () => {
    const r = dispatchChannel(CHANNELS_BY_ID['bring_a_trailer'], {
      vehicleId: 'v1',
      pkg: { identity: { year: 1966, make: 'Ford', model: 'Mustang', vin: '6F07C219593' } },
    });
    expect((r.job as any)?.field_map?.VIN?.value).toBe('6F07C219593');
    expect((r.job as any)?.auto_fill).toContain('VIN');
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
    expect(fields.VIN).toMatchObject({ value: '6F07C219593', tier: 'decode' });
    expect(fields['Postal code']).toMatchObject({ value: '89005', tier: 'decode' });
    // Title status and purchase year come from the title the owner attests: sign tier, proposed only.
    expect(fields['Title status']).toMatchObject({ value: 'clean', tier: 'sign' });
    expect(fields['What year did you purchase the vehicle?']).toMatchObject({ value: 2023, tier: 'sign' });
    expect(fields['Transmission'].tier).toBe('observe');
    expect(fields['History of the vehicle from new'].tier).toBe('deliberate');
  });
  it('always requires ownership + final-approval human keys', () => {
    const { humanKeys } = mapToBatSubmission({ vehicleId: 'v1', pkg });
    expect(humanKeys).toContain('ownership_attestation');
    expect(humanKeys).toContain('final_approval');
    expect(humanKeys).not.toContain('contract_signature'); // concierge-only
  });
  it('omits empty fields rather than projecting nulls', () => {
    const { fields } = mapToBatSubmission({ vehicleId: 'v1', pkg: { identity: { year: 1966 } } });
    expect(fields.VIN).toBeUndefined();
    expect(fields.Year.value).toBe(1966);
  });
});

describe('BaT field map covers the whole submission form', () => {
  // A 1973 Firebird package as generate-listing-package assembles it. Fictional values.
  const pkg = {
    identity: {
      year: 1973, make: 'Pontiac', model: 'Firebird', trim: null, vin: '2U87X3N000001',
      engine_type: '400 cid V8', transmission: 'Automatic', mileage: 51000, title_status: 'clean',
      city: 'Testville', country: 'United States', zip: '00000', owned_time: 2024,
      registration_use: 'street',
      cowl_tag: { series: '2FS87', paint_code: '75', trim_code: '232' },
      exterior_color: 'Red',
    },
    listing_content: {
      description: 'History text', modifications: ['SD-455 decals', 'shaker scoop'],
      recent_service_history: 'Service text', known_flaws: 'Flaw text', highlights: 'Highlight text',
      refurbishment: { year: 2025, details: 'Cut and polish' }, paint_body_history: 'Repainted',
      accident_history: 'None known', rust: 'None found', documents_on_hand: 'Receipts',
    },
    photos: { ordered: [{ id: 'img-1', url: 'https://example.invalid/1.jpg' }, { id: 'img-2', url: 'https://example.invalid/2.jpg' }] },
    observed_components: [
      { label: 'center console with shifter', image_id: 'img-1', confidence: 0.9 },
      { label: 'shaker hood scoop (Ram Air style)', image_id: 'img-2', confidence: 0.8 },
      { label: 'Rally II wheel', image_id: 'img-2', confidence: 0.8 },
      { label: 'BFGoodrich Radial T/A FR70-15 tire', image_id: 'img-2', confidence: 0.7 },
      { label: 'factory tachometer', image_id: 'img-1', confidence: 0.6 },
    ],
  };
  const bat = mapToBatSubmission({ vehicleId: 'v1', pkg, reserveCents: 3_000_000 });

  it('accounts for every form row: auto-fill, owner tap, or a named profile gap', () => {
    const seen = new Set([...bat.autoFill, ...bat.ownerTaps, ...bat.missing]);
    for (const q of BAT_FORM) expect(seen.has(q.label), q.label).toBe(true);
    expect(bat.autoFill.length + bat.ownerTaps.length + bat.missing.length).toBe(BAT_FORM.length);
  });

  it('fills every decode/observe/deliberate row the package carries', () => {
    for (const label of ['Year', 'Make', 'Model', 'Country where the vehicle is located', 'City', 'Postal code',
      'Photos', 'VIN', 'Is this a race car?', 'Engine', 'Transmission', 'Exterior color', 'Interior color',
      'Wheels', 'Tire brand', 'Tire size', 'Has the vehicle been refurbished?', 'Refurbishment year',
      'Refurbishment details', 'Paint and body history', 'Accident history', 'Rust', 'Equipment',
      'Has the vehicle been modified from stock?', 'List the modifications', 'History of the vehicle from new',
      'Services performed and when', 'Anything else we should know?']) {
      expect(bat.autoFill, label).toContain(label);
    }
    expect(bat.autoFill).toEqual([...bat.autoFill].sort((a, b) => bat.fields[a].order - bat.fields[b].order));
  });

  it('keeps the tiers of the form spec', () => {
    for (const q of BAT_FORM) if (bat.fields[q.label]) expect(bat.fields[q.label].tier, q.label).toBe(q.tier);
    expect(bat.fields['VIN'].tier).toBe('decode');
    expect(bat.fields['Exterior color'].tier).toBe('decode');
    expect(bat.fields['Equipment'].tier).toBe('observe');
    expect(bat.fields['History of the vehicle from new'].tier).toBe('deliberate');
  });

  it('never auto-fills a sign row, even when a value is proposed', () => {
    const signLabels = BAT_FORM.filter((q) => q.tier === 'sign').map((q) => q.label);
    for (const l of [
      'Has the vehicle been listed for sale elsewhere since you owned it?', 'Has the vehicle been listed on BaT before?',
      'Are you a dealer?', 'Is this a consignment?', 'How is the vehicle titled?', 'How is the vehicle registered?',
      'Name on title', 'Title state', 'Title status', 'What year did you purchase the vehicle?',
      'Is the odometer reading accurate?', 'Documents', 'Do you want a reserve?', 'Reserve amount', 'Document fee',
      'I attest that the information provided is accurate', 'I agree to the BaT listing terms',
    ]) expect(signLabels, l).toContain(l);
    for (const l of signLabels) {
      expect(bat.autoFill, l).not.toContain(l);
      expect(bat.ownerTaps, l).toContain(l);
      expect(bat.fields[l].humanKey, l).toBeTruthy();
    }
    expect(bat.fields['Reserve amount']).toMatchObject({ value: 30000, tier: 'sign', humanKey: 'final_approval' });
    expect(bat.fields['Title status'].value).toBe('clean');
    expect(bat.humanKeys).toEqual(expect.arrayContaining(['ownership_attestation', 'final_approval', 'identity_grant']));
  });

  it('decodes colors from the cowl tag codes and the model from the profile', () => {
    expect(bat.fields['Exterior color'].value).toBe('75');
    expect(bat.fields['Interior color'].value).toBe('232');
    expect(bat.fields['Model'].value).toBe('Firebird');
  });

  it('maps observed components to equipment and wheels with their source images', () => {
    expect(bat.fields['Equipment'].value).toEqual(expect.arrayContaining(['Console', 'Ram Air hood', 'Tachometer']));
    expect(bat.fields['Equipment'].sourceImageIds).toEqual(expect.arrayContaining(['img-1', 'img-2']));
    expect(bat.fields['Wheels'].value).toEqual(['15" Rally II wheels']);
    expect(bat.fields['Tire size'].value).toBe('FR70-15');
    expect(bat.fields['Tire brand'].value).toBe('BFGoodrich');
    expect(bat.fields['Photos'].value).toEqual([{ image_id: 'img-1' }, { image_id: 'img-2' }]);
    expect(componentsToOptions([{ label: 'steering wheel' }], 'Equipment')).toEqual([]);
  });

  it('names profile gaps instead of guessing them', () => {
    const empty = mapToBatSubmission({ vehicleId: 'v1', pkg: { identity: { year: 1973, make: 'Pontiac' } } });
    expect(empty.missing).toEqual(expect.arrayContaining(['VIN', 'Exterior color', 'Equipment', 'Photos']));
    expect(empty.fields['VIN']).toBeUndefined();
    expect(empty.ownerTaps.length).toBe(BAT_FORM.filter((q) => q.tier === 'sign').length);
  });
});
