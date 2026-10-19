// Run: deno test supabase/functions/extract-rmsothebys/
import { parseEstimate, saleCalendar, sessionDays } from './calendarKeys.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('the London estimate text becomes numbers and a currency', () => {
  equal(parseEstimate('£500,000 - £800,000 GBP'), { low: 500000, high: 800000, currency: 'GBP' });
  equal(parseEstimate('$1,200,000 - $1,600,000 USD'), { low: 1200000, high: 1600000, currency: 'USD' });
  equal(parseEstimate('€90,000 - €110,000 EUR'), { low: 90000, high: 110000, currency: 'EUR' });
});

Deno.test('an estimate that is not two numbers is unknown, not guessed', () => {
  equal(parseEstimate('Estimate on request'), { low: null, high: null, currency: null });
  equal(parseEstimate(null), { low: null, high: null, currency: null });
  equal(parseEstimate('$900,000 - $800,000 USD'), { low: null, high: null, currency: null });
});

Deno.test('LF26 is a one-day London sale on 31 October 2026', () => {
  equal(saleCalendar('lf26', 'The London Auction 2026'), {
    sale_key: 'lf26', auction_name: 'The London Auction 2026', sale_starts_on: '2026-10-31', sale_ends_on: '2026-10-31',
    auction_session_days: ['2026-10-31'], sale_location: 'London',
  });
});

Deno.test('MO26 runs 13-15 August and lists each session day', () => {
  const c = saleCalendar('MO26', null)!;
  equal([c.sale_starts_on, c.sale_ends_on, c.auction_session_days], ['2026-08-13', '2026-08-15', ['2026-08-13', '2026-08-14', '2026-08-15']]);
  equal(c.sale_location, 'Monterey');
});

Deno.test('a code not in the table carries no calendar keys', () => {
  equal(saleCalendar('ZZ99', 'x'), null);
  equal(sessionDays('2026-10-31', '2026-10-31'), ['2026-10-31']);
});
