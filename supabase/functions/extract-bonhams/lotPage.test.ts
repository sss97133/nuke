// Run: deno test --allow-read supabase/functions/extract-bonhams/
import {
  bonhamsLotPageUrl,
  extractBonhamsHighlights,
  extractIdentifiersFromText,
  isBonhamsNonVehicleLot,
  parseLotPage,
  parseSellerAssessment,
  sellerAssessmentConditionScore,
} from './lotPage.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const html = await Deno.readTextFile(new URL('./fixtures/lot_31857_269.html', import.meta.url));
// Bonhams MPH lot 26809/114, trimmed to the fields the parser reads: 37 photos, a saleroom notice and a Seller's Assessment.
const zealia = await Deno.readTextFile(new URL('./fixtures/lot_26809_114.html', import.meta.url));

Deno.test('the gallery is every image once, at full size, with the primary marked', () => {
  const p = parseLotPage(html)!;
  equal(p.images.length, 20);
  equal(p.images.every((i) => i.url.startsWith('https://images1.bonhams.com/image?src=Images/live/') && !i.url.includes('&')), true);
  equal(p.images.filter((i) => i.primary).length, 1);
  equal(new Set(p.images.map((i) => i.url)).size, 20);
});

Deno.test('chassis, engine number, registration and the sale are read from the page', () => {
  const p = parseLotPage(html)!;
  equal([p.chassis, p.engine_number, p.registration], ['S818529', 'G7652-8S', '156 YUX']);
  equal([p.sale_name, p.sale_venue, p.sale_starts_on, p.sale_ends_on, p.number_of_lots],
    ["Goodwood Revival: Collectors' Motor Cars and Automobilia", 'Chichester, Goodwood', '2026-09-19', '2026-09-19', 207]);
  equal(p.currency, 'GBP');
  equal([p.lot_number, p.sale_id, p.estimate_low, p.estimate_high], ['269', '31857', 75000, 95000]);
});

Deno.test('footnotes are plain text; a condition report link is kept', () => {
  const p = parseLotPage(html)!;
  equal(p.footnotes, 'Sold with & the original build sheet.');
  equal(p.condition_report_url?.startsWith('https://bonhams.sharepoint.com/'), true);
  equal(p.seller_assessment, null);
  equal(p.saleroom_notices, null);
});

Deno.test('a lot page with 37 photos yields all 37, not the one thumbnail the search index carries', () => {
  const p = parseLotPage(zealia)!;
  equal(p.images.length, 37);
  equal(new Set(p.images.map((i) => i.url)).size, 37);
  equal(p.images.filter((i) => i.primary).length, 1);
});

Deno.test('the saleroom notice is kept, and the chassis and engine numbers stated only there are read', () => {
  const p = parseLotPage(zealia)!;
  equal(p.saleroom_notices?.startsWith('Please note that there is a chassis number stamped'), true);
  equal([p.chassis, p.engine_number, p.registration], ['860286', 'KJ2451-8', null]);
  equal([p.lot_title, p.lot_number, p.sale_id], ['Zealia Engineering D-Type Replica Project', '114', '26809']);
  equal([p.hammer_price, p.hammer_premium, p.estimate_low, p.estimate_high, p.currency], [25000, 28125, 25000, 35000, 'GBP']);
  equal([p.sale_name, p.sale_venue], ['Bonhams MPH July Auction', 'Bicester, Bicester Heritage']);
  equal(p.catalogue_pdf_url, 'https://images1.bonhams.com/original?src=Images/live/2021-06/29/S-26809-0-1.pdf');
});

Deno.test("the 100-point Seller's Assessment on the page is structured: total, five categories, items, history file", () => {
  const a = parseLotPage(zealia)!.seller_assessment!;
  equal([a.vendor_score_total, a.vendor_score_max], [20, 100]);
  equal(Object.keys(a.categories), ['exterior', 'running_gear', 'interior', 'electrical', 'engine']);
  equal([a.categories.exterior, a.categories.electrical], [
    { score: 5, max: 25, items: { body_work: 1, paint: 1, glass: 1, chrome_plastics_trim: 1, wheels_tyres: 1 } },
    { score: 2, max: 10, items: { main_components: 1, ancillary_components: 1 } },
  ]);
  equal(Object.values(a.categories).reduce((n, c) => n + Object.keys(c!.items).length, 0), 19);
  equal(a.history_file, { score: 1, max: 5 });
});

Deno.test('prose identifiers: a notice is read, "not registered" is no registration, a header line still wins', () => {
  const ids = extractIdentifiersFromText(
    'Zealia Engineering D-Type Replica Project\nRegistration no. not registered',
    'there is a chassis number stamped on the turret which is 860286, and the engine block number stamping reads KJ2451-8.',
  );
  equal(ids, { chassis: '860286', engine_number: 'KJ2451-8', registration: null });
  equal(extractIdentifiersFromText('Chassis no. AR10512 Engine no. 1315*00515*', 'the chassis number is AR99999').chassis, 'AR10512');
  equal(extractIdentifiersFromText('No identity here', 'chassis number stamped on the frame').chassis, null);
});

Deno.test('a footnote without a vendor score is no assessment; a label after the total is kept', () => {
  equal(parseSellerAssessment('Sold with the original build sheet.'), null);
  equal(parseSellerAssessment(null), null);
  equal(parseSellerAssessment('Vendor Score Total: 120/100'), null);
  const a = parseSellerAssessment('Vendor Score Total: 72/100 - Very good\nEXTERIOR TOTAL: 18/25');
  equal([a?.vendor_score_total, a?.summary_label, a?.categories.exterior?.score], [72, 'Very good', 18]);
});

Deno.test('bullet highlights are read from the catalog description', () => {
  const catalogHtml = `<div class="LotName"><B>1971 Ferrari 365 GTC/4 Coupé</B></div><div class="LotDesc">•\tMatching numbers chassis and engine<br />•\tOne of 500 built<br />•\tAn interesting recommissioning project<br /><br />A rare model with a short career.</div>`;
  equal(extractBonhamsHighlights(catalogHtml), ['Matching numbers chassis and engine', 'One of 500 built', 'An interesting recommissioning project']);
  equal(extractBonhamsHighlights('A plain paragraph with no bullets.'), []);
});

Deno.test('the seller assessment becomes a condition score on the v1 tier scale, marked self-reported', () => {
  const row = sellerAssessmentConditionScore(parseLotPage(zealia)!.seller_assessment!);
  equal([row.condition_score, row.condition_tier, row.exterior_score, row.interior_score, row.mechanical_score, row.provenance_score],
    [20, 'project', 20, 20, 20, 20]);
  equal(row.computation_version, 'bonhams-mph-100pt-v1');
  equal((row.descriptor_summary as Record<string, unknown>).self_reported, true);
  equal(sellerAssessmentConditionScore({ vendor_score_total: 82, vendor_score_max: 100, categories: {} }).condition_tier, 'excellent');
});

Deno.test('a year-less vehicle lot is a vehicle; models, toys and automobilia are items', () => {
  const item = (title: string, year: number | null = null, catalogText = '', footnotes = '') => isBonhamsNonVehicleLot({ title, year, catalogText, footnotes });
  equal(item('Zealia Engineering D-Type Replica Project', null, 'Registration no. not registered'), false);
  equal(item('Jaguar XK120 Roadster'), false);
  equal(item('Austin-Healey 100', null, '', 'Vendor Score Total: 64/100'), false);
  equal(item('Bugatti Type 35', null, 'Chassis no. 4630'), false);
  equal(item('1965 Jaguar E-Type Series 1 3.8-Litre Roadster', 1965), false);
  equal(item('A Rolex Daytona chronograph'), true);
  equal(item('A bronze sculpture of a Bugatti roadster'), true);
  equal(item('A set of four Rudge-Whitworth wheels'), true);
  equal(item('An Austin J40 child\'s pedal car', 1950), true);
  equal(item('Ferrari 250 GTO half-scale model', 1962), true);
  equal(item('Jaguar XK engine block'), true);
});

Deno.test('the lot page is read on cars.bonhams.com, with a trailing slash', () => {
  equal(bonhamsLotPageUrl('https://www.bonhams.com/auction/26809/lot/114/zealia-engineering-d-type-replica-project'),
    'https://cars.bonhams.com/auction/26809/lot/114/zealia-engineering-d-type-replica-project/');
  equal(bonhamsLotPageUrl('https://cars.bonhams.com/auction/26809/lot/114/x/'), 'https://cars.bonhams.com/auction/26809/lot/114/x/');
});

Deno.test('a page without lot data is not a lot page', () => {
  equal(parseLotPage('<html><title>Just a moment...</title></html>'), null);
  equal(parseLotPage('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>'), null);
  equal(parseLotPage('<script id="__NEXT_DATA__" type="application/json">not json</script>'), null);
});
