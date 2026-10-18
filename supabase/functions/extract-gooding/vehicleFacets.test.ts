// Run: deno test supabase/functions/extract-gooding/
import { extractFromPageData, type GoodingPageData } from './index.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function page(item: { title: string; year: number; make: string; model: string; coachwork?: string; highlights?: string[] }, slug: string): GoodingPageData {
  return {
    result: {
      data: {
        contentfulLot: {
          __typename: 'ContentfulLot',
          lotNumber: 38,
          lowEstimate: 1000000,
          highEstimate: 1500000,
          uniqueEstimate: null,
          hasReservePrice: true,
          salePrice: 1250000,
          auctionMobilityId: null,
          askingPrice: null,
          onlineBiddingAvailable: false,
          title: item.title,
          slug,
          description: null,
          auction: {
            name: 'Pebble Beach Auctions',
            contentful_id: 'auc-1',
            auctionMobilityId: null,
            currency: 'USD',
            subEvents: [{ __typename: 'ContentfulSubEventAuction', startDate: '2025-08-16T17:00:00Z' }],
            activeAuction: false,
            webpage__auction: [{ slug: 'pebble-beach-2025' }],
          },
          item: {
            __typename: 'ContentfulAutomobile',
            title: item.title,
            chassis: null,
            coachwork: item.coachwork ?? null,
            highlights: item.highlights ?? [],
            specifications: [],
            salesForceId: null,
            type: 'Automobile',
            make: { name: item.make },
            modelYear: item.year,
            model: item.model,
            note: null,
            cloudinaryImagesCombined: [],
          },
        },
      },
    },
  };
}

const cases: Array<{ item: Parameters<typeof page>[0]; slug: string; want: [string | null, string | null, string | null] }> = [
  { item: { title: '1955 Mercedes-Benz 300 SL Gullwing', year: 1955, make: 'Mercedes-Benz', model: '300 SL Gullwing' }, slug: '1955-mercedes-benz-300-sl-gullwing', want: ['300 SL', 'Gullwing', 'Gullwing Coupe'] },
  { item: { title: '1956 Jaguar XK140 SE Drophead Coupe', year: 1956, make: 'Jaguar', model: 'XK140 SE Drophead Coupe' }, slug: '1956-jaguar-xk140-se-drophead-coupe', want: ['XK140', 'SE', 'Convertible'] },
  { item: { title: '1961 Ferrari 250 GT SWB Berlinetta', year: 1961, make: 'Ferrari', model: '250 GT SWB Berlinetta', coachwork: 'Scaglietti' }, slug: '1961-ferrari-250-gt-swb-berlinetta', want: ['250 GT SWB', 'SWB', 'Coupe'] },
  { item: { title: '1967 Shelby GT500', year: 1967, make: 'Shelby', model: 'GT500' }, slug: '1967-shelby-gt500', want: ['Shelby GT500', 'GT500', null] },
  { item: { title: '1969 Ford Mustang Boss 429', year: 1969, make: 'Ford', model: 'Mustang Boss 429' }, slug: '1969-ford-mustang-boss-429', want: ['Boss 429', 'Boss 429', 'Fastback'] },
  { item: { title: '1973 Porsche 911 Carrera RS 2.7 Touring', year: 1973, make: 'Porsche', model: '911 Carrera RS 2.7 Touring' }, slug: '1973-porsche-911-carrera-rs-27-touring', want: ['Carrera RS 2.7', 'RS 2.7 Touring', 'Coupe'] },
];

Deno.test('extractFromPageData extracts collector series, trim and body_style from Gooding lots', () => {
  for (const c of cases) {
    const x = extractFromPageData(page(c.item, c.slug), `https://www.goodingco.com/lot/${c.slug}`);
    equal([x.series, x.trim, x.body_style], c.want, `${c.item.title}:`);
  }
});

Deno.test('extractFromPageData reads coachwork and highlights for body style when the title omits it', () => {
  const x = extractFromPageData(
    page({ title: '1965 Aston Martin DB5', year: 1965, make: 'Aston Martin', model: 'DB5', coachwork: 'Harold Radford', highlights: ['One of 12 Shooting Brake conversions'] }, '1965-aston-martin-db5'),
    'https://www.goodingco.com/lot/1965-aston-martin-db5',
  );
  equal([x.series, x.body_style], ['DB5', 'Shooting Brake']);
});
