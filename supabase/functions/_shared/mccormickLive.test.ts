import { mccormickLiveLinks, parseMcCormickSale, parseMcCormickFutureSales, parseMcCormickInventory, mccormickRunDay, MCCORMICK_ORIGIN as origin } from './mccormickLive.ts';
import { mccormickTarget, parseMcCormickLot } from './mccormickParser.ts';
import { normalizeListingUrl } from './urlNormalization.ts';
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
function fails(fn: () => unknown) { try { fn(); } catch { return; } throw Error('Expected refusal'); }
const saleHtml = 'Our next auction will be our 91st event. It will take place November 20-22, 2026 at The Synthetic Outdoor Event area.';
const sale = parseMcCormickSale(saleHtml, origin + '/Auction-91');
const auctionRow = (id: number, lot = '1') => `<TR><TD><a href="auction-cars?auctionid=${id}">${lot}</a></TD><TD>photo</TD><TD>1970</TD><TD>FORD</TD><TD>MUSTANG</TD><TD>COUPE</TD></TR>`;
Deno.test('registration and advertised event agree; stale footer is not current membership', () => {
  eq(mccormickLiveLinks(`Auction 91 is OPEN for registration <a href="/Auction-90">Our Next Auction</a><a href="/Auction-91">Event</a>`).event_url, origin + '/Auction-91');
  fails(() => mccormickLiveLinks('Auction 91 is OPEN for registration <a href="/Auction-90">Next</a>'));
  fails(() => parseMcCormickSale(saleHtml, origin + '/Auction-90'));
  fails(() => parseMcCormickSale(saleHtml.replace('20-22','30-31').replace('November','February'), origin + '/Auction-91'));
});
Deno.test('published future dates preserve unknown catalog count', () => {
  const rows = parseMcCormickFutureSales('All events taking place at our usual location, Synthetic Outdoor area. Our 92nd auction will take place February 19, 20 & 21 2027', origin + '/news_stories.cfm?newsid=1');
  eq([rows[0].starts_on, rows[0].ends_on, rows[0].lots_listed], ['2027-02-19','2027-02-21',null]);
  fails(() => parseMcCormickFutureSales('blocked',origin+'/news_stories.cfm?newsid=1'));
});
Deno.test('complete catalog keeps duplicate lot numbers but refuses duplicate native IDs or incomplete pages', () => {
  const html = 'Auction 91 Auction Cars' + auctionRow(10) + auctionRow(11);
  eq(parseMcCormickInventory(html,'auction',sale).map(r=>r.native_id), ['10','11']);
  fails(()=>parseMcCormickInventory('Auction 91 Auction Cars','auction',sale));
  fails(()=>parseMcCormickInventory(html+auctionRow(10),'auction',sale));
  fails(()=>parseMcCormickInventory(html.replace('Auction 91','Auction 90'),'auction',sale));
  fails(()=>parseMcCormickInventory(html.replace('<TD>FORD</TD>',''),'auction',sale));
});
Deno.test('run day requires schedule and catalog range agreement', () => {
  const catalog = 'Lots 1-180 Friday Lots 181-405 Saturday';
  const schedule = 'FRIDAY, November 20th: LOTS 1-140 SATURDAY, November 21st: LOTS 181-380';
  eq(mccormickRunDay('120',sale,catalog,schedule),'2026-11-20');
  eq(mccormickRunDay('150',sale,catalog,schedule),null);
});
Deno.test('showroom native identity is separate from auction IDs and stock numbers; sold is explicit', () => {
  const url = origin+'/Showroom-Inventory?sp=1&id=27';
  eq(mccormickTarget(url)?.id,'showroom:27');
  eq(normalizeListingUrl(url)?.normalized,url);
  eq(normalizeListingUrl(url)?.canonicalListingId,'mccormicks:showroom:27');
  eq(mccormickTarget(url+'&extra=1'),null);
  const row = (status: string) => `<TR><TD><a href="${url}">4473</a></TD><TD>2007</TD><TD>AUDI</TD><TD>A4</TD><TD>$8,500</TD><TD>${status}</TD></TR>`;
  const available = parseMcCormickInventory('Showroom Inventory'+row('Available'),'showroom')[0];
  eq([available.native_id,available.lot_number,available.source_status,available.asking_amount,available.currency],['showroom:27','4473','available',8500,null]);
  eq(parseMcCormickInventory('Showroom Inventory'+row('SOLD'),'showroom')[0].source_status,'sold');
  fails(()=>parseMcCormickInventory('Showroom Inventory'+row('Unknown'),'showroom'));
  const detail = `<div class="bcopy12"><b>2007 AUDI A4</b><br>Stock No. 4473</div>Offered at: $8,500 <table><TR><TD><div>Model Year:</TD><TD><div>2007</TD></TR><TR><TD><div>Make:</TD><TD><div>AUDI</TD></TR><TR><TD><div>Transmission:</TD><TD><div>Automatic</TD></TR><TR><TD><B>Component</B></TD><TD><B>Ratings:</B></TD></TR><TR><TD><div>Transmission:</TD><TD><div>Excellent</TD></TR></table><IMG ID="Picture1" SRC="/upload/showroom/example.jpg">`;
  const parsed = parseMcCormickLot(detail,url);
  eq(parsed.source_id,'showroom:27'); eq(parsed.raw_fields.Transmission,'Automatic');
  eq(parsed.asking_claim?.amount,8500); eq(parsed.result_claim,null);
});
