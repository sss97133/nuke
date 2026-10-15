// Run: deno test --allow-read supabase/functions/extract-bonhams/
import { parseLotPage } from './lotPage.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const html = await Deno.readTextFile(new URL('./fixtures/lot_31857_269.html', import.meta.url));

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
});

Deno.test('footnotes are plain text; a condition report link is kept', () => {
  const p = parseLotPage(html)!;
  equal(p.footnotes, 'Sold with & the original build sheet.');
  equal(p.condition_report_url?.startsWith('https://bonhams.sharepoint.com/'), true);
});

Deno.test('a page without lot data is not a lot page', () => {
  equal(parseLotPage('<html><title>Just a moment...</title></html>'), null);
  equal(parseLotPage('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>'), null);
  equal(parseLotPage('<script id="__NEXT_DATA__" type="application/json">not json</script>'), null);
});
