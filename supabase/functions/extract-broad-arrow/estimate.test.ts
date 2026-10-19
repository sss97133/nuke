// Run: deno test --node-modules-dir=none supabase/functions/extract-broad-arrow/
import { parseFromMarkdown } from './index.ts';

const lotHtml = (amounts: string) =>
  `<html><body><h1>1991 De Tomaso Pantera SI</h1><div><span id='label'>Estimate:</span>\n<span id='convert_price'>${amounts}</span></div></body></html>`;

Deno.test('a Zurich lot page estimate with apostrophe grouping keeps every digit', () => {
  const r = parseFromMarkdown('', lotHtml('CHF 210&#39;000 - CHF 255&#39;000'), 'https://www.broadarrowauctions.com/vehicles/dg26_r0012/1991-de-tomaso-pantera-si');
  if (r.estimate_low !== 210000 || r.estimate_high !== 255000) throw new Error(JSON.stringify([r.estimate_low, r.estimate_high]));
});

Deno.test('a dollar lot page estimate with comma grouping is unchanged', () => {
  const r = parseFromMarkdown('', lotHtml('$800,000 - $1,000,000'), 'https://www.broadarrowauctions.com/vehicles/mo25_r0001/x');
  if (r.estimate_low !== 800000 || r.estimate_high !== 1000000) throw new Error(JSON.stringify([r.estimate_low, r.estimate_high]));
});
