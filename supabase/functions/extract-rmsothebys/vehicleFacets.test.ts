// Run: deno test supabase/functions/extract-rmsothebys/
import { transformLotItem } from './index.ts';
import { parseTitle } from './lotTitle.ts';
import { saveVehicle, type ExtractedVehicle, type SaveDeps } from './saveVehicle.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('parseTitle splits multi-word collector makes cleanly from model', () => {
  equal(parseTitle('2024 Aston Martin Valkyrie Spider'), {
    year: 2024,
    make: 'aston martin',
    model: 'valkyrie spider',
  });
  equal(parseTitle('1967 Alfa Romeo Giulia Sprint GT Veloce'), {
    year: 1967,
    make: 'alfa romeo',
    model: 'giulia sprint gt veloce',
  });
  equal(parseTitle('1965 Austin-Healey 3000 Mk III BJ8 Sports Convertible'), {
    year: 1965,
    make: 'austin-healey',
    model: '3000 mk iii bj8 sports convertible',
  });
});

Deno.test('transformLotItem extracts deterministic series, trim, and body_style for European & American collector lots', () => {
  const baseItem = {
    id: '1',
    publicName: '',
    lot: '101',
    header: 'Monterey 2026',
    value: '$1,500,000 USD',
    valueType: 'Sold For',
    preSaleEstimate: '$1,200,000 - $1,600,000 USD',
    link: '/auctions/mo26/lots/r0101/',
    crop: 'https://cdn.example/car.webp',
    sold: true,
    isStillForSale: false,
    biddingLotId: 'lot-1',
    biddingAuctionId: 'auc-1',
    biddingType: 'Live',
    categoryId: 1,
    auctioned: true,
  };

  // Mercedes-Benz 300 SL Gullwing
  const gullwing = transformLotItem({
    ...baseItem,
    publicName: '1955 Mercedes-Benz 300 SL Gullwing',
    link: '/auctions/mo26/lots/r0101-1955-mercedes-benz-300-sl-gullwing/',
  }, 'MO26');
  equal([gullwing.series, gullwing.trim, gullwing.body_style], ['300 SL', 'Gullwing', 'Gullwing Coupe'], '300 SL Gullwing:');

  // Porsche 911 Carrera RS 2.7 Touring
  const carreraRs = transformLotItem({
    ...baseItem,
    publicName: '1973 Porsche 911 Carrera RS 2.7 Touring',
    link: '/auctions/mo26/lots/r0102-1973-porsche-911-carrera-rs-27-touring/',
  }, 'MO26');
  equal([carreraRs.series, carreraRs.trim, carreraRs.body_style], ['Carrera RS 2.7', 'RS 2.7 Touring', 'Coupe'], '911 Carrera RS 2.7 Touring:');

  // Porsche 356A 1600 Super Speedster
  const speedster = transformLotItem({
    ...baseItem,
    publicName: '1958 Porsche 356 A 1600 Super Speedster by Reutter',
    link: '/auctions/mo26/lots/r0103-1958-porsche-356-a-1600-super-speedster/',
  }, 'MO26');
  equal([speedster.series, speedster.trim, speedster.body_style], ['356A', '1600 Super', 'Roadster'], '356A Speedster:');

  // Jaguar E-Type Series 1 3.8-Litre Roadster
  const eType = transformLotItem({
    ...baseItem,
    publicName: '1962 Jaguar E-Type Series 1 3.8-Litre Roadster',
    link: '/auctions/mo26/lots/r0104-1962-jaguar-e-type-series-1-38-litre-roadster/',
  }, 'MO26');
  equal([eType.series, eType.trim, eType.body_style], ['Series 1', '3.8-Litre', 'Roadster'], 'E-Type Series 1:');

  // Jaguar XK140 SE Drophead Coupé -> Convertible (not Coupe)
  const xk140 = transformLotItem({
    ...baseItem,
    publicName: '1956 Jaguar XK140 SE Drophead Coupé',
    link: '/auctions/lf26/lots/r0105-1956-jaguar-xk140-se-drophead-coupe/',
  }, 'LF26');
  equal([xk140.series, xk140.trim, xk140.body_style], ['XK140', 'SE', 'Convertible'], 'XK140 SE Drophead Coupé:');

  // Ferrari 250 GT SWB Berlinetta
  const ferrariSwb = transformLotItem({
    ...baseItem,
    publicName: '1961 Ferrari 250 GT SWB Berlinetta by Scaglietti',
    link: '/auctions/mo26/lots/r0106-1961-ferrari-250-gt-swb-berlinetta/',
  }, 'MO26');
  equal([ferrariSwb.series, ferrariSwb.trim, ferrariSwb.body_style], ['250 GT SWB', 'SWB', 'Coupe'], '250 GT SWB Berlinetta:');

  // Aston Martin DB5 Vantage
  const db5 = transformLotItem({
    ...baseItem,
    publicName: '1965 Aston Martin DB5 Vantage Sports Saloon',
    link: '/auctions/lf26/lots/r0107-1965-aston-martin-db5-vantage/',
  }, 'LF26');
  equal([db5.series, db5.trim, db5.body_style], ['DB5', 'Vantage', 'Coupe'], 'Aston Martin DB5 Vantage:');

  // American truck: 1972 Chevrolet K10 Cheyenne Stepside Pickup
  const k10 = transformLotItem({
    ...baseItem,
    publicName: '1972 Chevrolet K10 Cheyenne Stepside Pickup',
    link: '/auctions/az26/lots/r0108-1972-chevrolet-k10-cheyenne-stepside-pickup/',
  }, 'AZ26');
  equal([k10.series, k10.trim, k10.body_style], ['K10', 'Cheyenne', 'Stepside'], 'Chevrolet K10 Cheyenne Stepside:');

  // Ford Mustang Boss 302
  const boss302 = transformLotItem({
    ...baseItem,
    publicName: '1970 Ford Mustang Boss 302',
    link: '/auctions/az26/lots/r0109-1970-ford-mustang-boss-302/',
  }, 'AZ26');
  equal([boss302.series, boss302.trim, boss302.body_style], ['Boss 302', 'Boss 302', 'Fastback'], 'Mustang Boss 302:');
});

Deno.test('saveVehicle persists series, trim, and body_style on insert and gap-fills on update', async () => {
  const calls: Array<{ table: string; op: string; row?: any }> = [];
  const makeStub = (selectData: any = null) => ({
    from(table: string) {
      const call: { table: string; op: string; row?: any } = { table, op: 'select' };
      calls.push(call);
      const b: any = {
        select() { return b; },
        update(row: any) { call.op = 'update'; call.row = row; return b; },
        insert(row: any) { call.op = 'insert'; call.row = row; return b; },
        eq() { return b; },
        in() { return b; },
        is() { return b; },
        limit() { return b; },
        maybeSingle() {
          if (call.op === 'insert') return Promise.resolve({ data: { id: 'v-300sl' }, error: null });
          return Promise.resolve({ data: selectData, error: null });
        },
        then(resolve: any) {
          return Promise.resolve({ data: selectData, error: null }).then(resolve);
        },
      };
      return b;
    },
    rpc() { return Promise.resolve({ error: null }); },
  });

  const observations: any[] = [];
  const events: any[] = [];
  const deps: SaveDeps = {
    resolveExisting: async () => ({ vehicleId: null }),
    writeObservation: async (_s, input) => { observations.push(input); return {}; },
    writeEvent: async (_s, row) => { events.push(row); return { action: 'inserted' }; },
  };

  const lotVehicle: ExtractedVehicle = {
    url: 'https://rmsothebys.com/auctions/mo26/lots/r0015-1955-mercedes-benz-300-sl-gullwing/',
    title: '1955 Mercedes-Benz 300 SL Gullwing',
    year: 1955,
    make: 'mercedes-benz',
    model: '300 sl gullwing',
    lot_number: '15',
    auction_name: 'Monterey 2026',
    auction_code: 'MO26',
    estimate_text: '$1,500,000 - $2,000,000 USD',
    sold_price: 1850000,
    sold_price_text: '$1,850,000 USD',
    currency: 'USD',
    sold: true,
    is_still_for_sale: false,
    image_url: null,
    rms_lot_id: 'lot-15',
    rms_auction_id: 'auc-mo26',
    bidding_type: 'Live',
    collection: null,
    category_id: 1,
    auctioned: true,
  };

  await saveVehicle(makeStub(), lotVehicle, deps);
  const insertCall = calls.find((c) => c.table === 'vehicles' && c.op === 'insert')!;
  equal([insertCall.row.series, insertCall.row.trim, insertCall.row.body_style], ['300 SL', 'Gullwing', 'Gullwing Coupe'], 'vehicle insert facets:');
  equal([observations[0].fields.series, observations[0].fields.trim, observations[0].fields.body_style], ['300 SL', 'Gullwing', 'Gullwing Coupe'], 'observation facets:');
  equal([events[0].metadata.series, events[0].metadata.trim, events[0].metadata.body_style], ['300 SL', 'Gullwing', 'Gullwing Coupe'], 'event metadata facets:');

  // Now test update path: gap-fills missing series/body_style while preserving an existing trim
  calls.length = 0;
  const depsResolved: SaveDeps = {
    resolveExisting: async () => ({ vehicleId: 'v-existing' }),
    writeObservation: async (_s, input) => { observations.push(input); return {}; },
    writeEvent: async (_s, row) => { events.push(row); return { action: 'updated' }; },
  };
  await saveVehicle(
    makeStub({ year: 1955, make: 'Mercedes-Benz', model: '300 SL', vin: null, series: null, trim: 'Alloy Gullwing', body_style: null }),
    lotVehicle,
    depsResolved,
  );
  const updateCall = calls.find((c) => c.table === 'vehicles' && c.op === 'update')!;
  equal([updateCall.row.series, updateCall.row.trim, updateCall.row.body_style], ['300 SL', undefined, 'Gullwing Coupe'], 'vehicle update gap-fill:');
});
