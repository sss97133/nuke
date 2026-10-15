// Run: deno test supabase/functions/extract-broad-arrow/
import { parseEventPage, parseListingCards } from './roster.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

const CARD = `<div class='vehicle-list'> <div class='auto-wrap'> <div class='ft-vehicle-item grid-block' id='ft-item-0-0'> <a title="2003 Ferrari Enzo" class="vehicle-card" href="/vehicles/lv26_r0006/2003-ferrari-enzo"><div class='top'> <div class='auto is-vlp' data-images='https://cdn.dealeraccelerate.com/bagauction/44/6199/315115/790x1024/2003-ferrari-enzo,https://cdn.dealeraccelerate.com/bagauction/44/6199/315123/790x1024/2003-ferrari-enzo'></div></div> <div class='bottom'> <div class='name-auto'> <span>2003</span> <span>Ferrari</span> <span>Enzo</span> <span></span> </div> <div class='price'> <div class='top'> <span> The Las Vegas Auction 2026 </span> </div> <div class='mid'> </div> <div class='bot'> <span>Estimate: $6,500,000</span> <span>- $8,500,000</span> </div> </div> </div> </a></div>
<div class='ft-vehicle-item grid-block' id='ft-item-0-1'> <a href="/vehicles/dg26_r0041/2017-ferrari-f12tdf"><div class='top'> <div class='auto' data-images=''></div></div> <div class='bottom'> <div class='name-auto'> <span>2017</span> <span>Ferrari</span> <span>F12tdf</span> </div> <div class='price'> <div class='top'> <span>The Zurich Auction 2026</span> </div> <div class='mid'> </div> <div class='bot'> <span>Estimate: CHF 1,000,000</span> <span>- CHF 1,400,000</span> </div> </div> </div> </a></div>`;

Deno.test('a listing card gives the lot, the car, the sale and the estimate', () => {
  const [a, b] = parseListingCards(CARD);
  equal([a.code, a.lot_id, a.lot_number, a.year, a.make, a.model, a.sale_name, a.estimate_low, a.estimate_high, a.currency, a.image_urls.length],
    ['lv26', 'r0006', '6', 2003, 'Ferrari', 'Enzo', 'The Las Vegas Auction 2026', 6500000, 8500000, 'USD', 2]);
  equal(a.url, 'https://www.broadarrowauctions.com/vehicles/lv26_r0006/2003-ferrari-enzo');
  equal([b.code, b.lot_number, b.model, b.currency, b.estimate_low, b.image_urls.length], ['dg26', '41', 'F12tdf', 'CHF', 1000000, 0]);
});

Deno.test('a card seen twice is one lot', () => {
  equal(parseListingCards(CARD + CARD).length, 2);
});

Deno.test('the event page gives the run day and the place', () => {
  const html = '<html><body><h1> 7 November 2026 </h1> <h2>The Zurich Auction 2026</h2> <p>The Dolder Grand - Zürich, Switzerland</p> <a>Back to Auctions</a></body></html>';
  equal(parseEventPage(html, 'The Zurich Auction 2026'), { starts_on: '2026-11-07', ends_on: '2026-11-07', days: ['2026-11-07'], location: 'The Dolder Grand - Zürich, Switzerland' });
});

Deno.test('a multi-day sale lists each run day', () => {
  const html = '<h1>13 - 15 August 2026</h1><h2>The Monterey Auction 2026</h2> Quail Lodge, Carmel, California Back to Auctions';
  const e = parseEventPage(html, 'The Monterey Auction 2026');
  equal([e.starts_on, e.ends_on, e.days], ['2026-08-13', '2026-08-15', ['2026-08-13', '2026-08-14', '2026-08-15']]);
});
