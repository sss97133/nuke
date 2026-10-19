// Run: deno test --allow-read supabase/functions/extract-bonhams/
import {
  buildVehicleRecord,
  extractSpecsFromContent,
  parseBonhamsName,
  parseLotPage,
  type ExtractionResult,
} from './lotPage.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('parseBonhamsName extracts deterministic series, trim, and body_style from Bonhams lot titles', () => {
  // British Drophead Coupé must resolve to Convertible (not Coupe)
  const xk140 = parseBonhamsName('1956 Jaguar XK140 SE Drophead Coupé Chassis no. S818529 Engine no. G7652-8S');
  equal(
    [xk140.year, xk140.make, xk140.series, xk140.trim, xk140.body_style, xk140.chassis],
    [1956, 'Jaguar', 'XK140', 'SE', 'Convertible', 'S818529'],
    '1956 Jaguar XK140 SE Drophead Coupé:',
  );

  // Jaguar E-Type Series 1 4.2 Fixed-Head Coupé -> Coupe
  const eTypeFhc = parseBonhamsName('1966 Jaguar E-Type Series 1 4.2-Litre Fixed-Head Coupé');
  equal(
    [eTypeFhc.year, eTypeFhc.make, eTypeFhc.series, eTypeFhc.trim, eTypeFhc.body_style],
    [1966, 'Jaguar', 'Series 1', '4.2-Litre', 'Coupe'],
    '1966 Jaguar E-Type Series 1 4.2 FHC:',
  );

  // Aston Martin DB5 Shooting Brake
  const db5Sb = parseBonhamsName('1965 Aston Martin DB5 Vantage Shooting Brake Coachwork by Harold Radford');
  equal(
    [db5Sb.year, db5Sb.make, db5Sb.series, db5Sb.trim, db5Sb.body_style],
    [1965, 'Aston Martin', 'DB5', 'Vantage', 'Shooting Brake'],
    '1965 Aston Martin DB5 Vantage Shooting Brake:',
  );

  // Porsche 911 Carrera RS 2.7 Lightweight
  const rs27 = parseBonhamsName('1973 Porsche 911 Carrera RS 2.7 Sport Lightweight');
  equal(
    [rs27.year, rs27.make, rs27.series, rs27.trim, rs27.body_style],
    [1973, 'Porsche', 'Carrera RS 2.7', 'RS 2.7 Lightweight', 'Coupe'],
    '1973 Porsche 911 Carrera RS 2.7 Lightweight:',
  );

  // Mercedes-Benz 280 SL Pagoda Roadster
  const pagoda = parseBonhamsName('1970 Mercedes-Benz 280 SL Pagoda Roadster');
  equal(
    [pagoda.year, pagoda.make, pagoda.series, pagoda.trim, pagoda.body_style],
    [1970, 'Mercedes-Benz', '280 SL', 'Pagoda', 'Roadster'],
    '1970 Mercedes-Benz 280 SL Pagoda:',
  );

  // American Muscle / Truck: 1969 Chevrolet Camaro RS/SS Z/28 & 1966 Ford Bronco U13 Roadster
  const camaro = parseBonhamsName('1969 Chevrolet Camaro RS/Z28 Coupe');
  equal(
    [camaro.year, camaro.make, camaro.series, camaro.trim, camaro.body_style],
    [1969, 'Chevrolet', '1st Gen', 'RS/Z28', 'Coupe'],
    '1969 Chevrolet Camaro RS/Z28:',
  );

  const bronco = parseBonhamsName('1966 Ford Bronco U13 Roadster');
  equal(
    [bronco.year, bronco.make, bronco.series, bronco.trim, bronco.body_style],
    [1966, 'Ford', 'U13 Roadster', null, 'Roadster'],
    '1966 Ford Bronco U13 Roadster:',
  );
});

Deno.test('extractSpecsFromContent classifies Drophead Coupé as Convertible and Shooting Brake as Shooting Brake', () => {
  equal(extractSpecsFromContent('1956 Jaguar XK140 SE Drophead Coupé').body_style, 'Convertible');
  equal(extractSpecsFromContent('1964 Aston Martin DB5 Sports Saloon').body_style, 'Coupe');
  equal(extractSpecsFromContent('1965 Aston Martin DB5 Shooting Brake').body_style, 'Shooting Brake');
  equal(extractSpecsFromContent('1955 Mercedes-Benz 300 SL Gullwing').body_style, 'Gullwing Coupe');
});

Deno.test('buildVehicleRecord populates series, trim, and body_style even for Typesense-landed lots with null facets', () => {
  const typesensePayload: ExtractionResult = {
    url: 'https://www.bonhams.com/auction/31857/lot/269/1956-jaguar-xk140-se-drophead-coupe/',
    title: '1956 Jaguar XK140 SE Drophead Coupé',
    year: 1956,
    make: 'Jaguar',
    model: 'XK140 SE Drophead Coupé',
    vin: null,
    chassis_number: 'S818529',
    mileage: null,
    engine: null,
    transmission: null,
    exterior_color: null,
    interior_color: null,
    body_style: null,
    description: 'Chassis no. S818529 Engine no. G7652-8S',
    sale_price: 95000,
    price_currency: 'GBP',
    auction_status: 'sold',
    lot_number: '269',
    sale_id: '31857',
    sale_name: 'Goodwood Revival',
    sale_date: '2026-09-19',
    sale_location: 'Chichester, Goodwood',
    estimate_low: 80000,
    estimate_high: 110000,
    estimate_currency: 'GBP',
    image_urls: [],
    fetch_source: 'bonhams-typesense',
    cost_cents: 0,
  };

  const record = buildVehicleRecord(typesensePayload);
  equal([record.series, record.trim, record.body_style], ['XK140', 'SE', 'Convertible'], 'Typesense buildVehicleRecord facets:');
  equal(
    [record.origin_metadata.series, record.origin_metadata.trim, record.origin_metadata.body_style],
    ['XK140', 'SE', 'Convertible'],
    'Typesense origin_metadata facets:',
  );
});

Deno.test('Bonhams Goodwood fixture lot_31857_269.html yields XK140 / SE / Convertible from its __NEXT_DATA__ title', async () => {
  const html = await Deno.readTextFile(new URL('./fixtures/lot_31857_269.html', import.meta.url));
  const page = parseLotPage(html)!;
  const rawTitle = String((page.raw?.lot as any)?.sDesc ?? '');
  const parsed = parseBonhamsName(rawTitle);
  equal([parsed.year, parsed.make, parsed.series, parsed.trim, parsed.body_style], [1956, 'Jaguar', 'XK140', 'SE', 'Convertible']);
});
