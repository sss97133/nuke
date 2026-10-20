import { assertEquals } from "jsr:@std/assert@1";
import {
  type BonhamsSaleDoc, bonhamsLot, bonhamsLotPhase, bonhamsSaleKind, parseBonhamsBidStates, parsePcarBids, parsePcarBoard,
} from "./boards.ts";
import { type AmLotDoc, type AmSale, amIsVehicleLot, amOpenTimedSales, amSales, amTimedLot } from "./boards.ts";
import {
  isUwaVehicle, parseUwaBoard, parseUwaLot, UWA_HOUSES, uwaCurrency, uwaIdentityTitle, uwaKnownMake, uwaOpenLots, zonedTimeToIso,
} from "./boards.ts";

// Trimmed from https://www.pcarmarket.com/auctions?auctionType=live&page=1 (2026-10-18): the Basta query cache.
const BOARD = `queries:$R[22]=[$R[30]={state:$R[31]={data:$R[32]={search:$R[33]={pageInfo:$R[34]={page:1,pageSize:24,totalPages:3,hasNextPage:!0},` +
  `edges:$R[35]=[$R[36]={node:$R[37]={__typename:"Item",id:"28d8dfc0-a0e5-40e7-b4cb-51349093f862",saleId:"20bdc48d2f",` +
  `slugFullPath:"pcar/1968-chevrolet-camaro-ss/1968-chevrolet-camaro-ss",itemNumber:1,status:"ITEM_OPEN",itemResult:null,` +
  `title:"350-Powered 1968 Chevrolet Camaro 4-Speed \\"Modified\\"",currency:"USD",currentBid:300000,totalBids:9,estimates:$R[50]={low:0,high:0},` +
  `images:$R[51]=[$R[52]={url:"https://assets.basta.app/x.jpg"}],location:"Florida",closingTimeCountdown:120000,` +
  `dates:$R[55]={openDate:"2026-10-12T12:00:00Z",closingEnd:"2026-10-19T18:42:00Z"},schema:$R[57]={data:$R[58]={schemaName:"Vehicle",country:"United States"}},imageCount:83}},` +
  `$R[60]={node:$R[61]={__typename:"Item",id:"c8f2",slugFullPath:"pcar/omega-speedmaster/omega-speedmaster",status:"ITEM_OPEN",title:"Omega",` +
  `currency:"USD",currentBid:0,totalBids:0,dates:$R[62]={closingEnd:"2026-10-20T18:00:00Z"},schema:$R[63]={data:$R[64]={schemaName:"Watches"}},imageCount:12}}]`;

// Trimmed from the lot page of the Camaro above: bid history as Basta serializes it (amounts in cents).
const LOT = `increments:$R[288]=[25000,50000],bids:$R[289]=[$R[290]={id:"8b9084fe-c944-42da-9207-074aed23a193",amount:25000,` +
  `date:"2026-10-13T12:32:12Z",bidStatus:"LOSING",bidderIdentifier:"Nick7989",reactiveBid:!1,maxAmount:null},` +
  `$R[291]={id:"45acc0f7-4587-4c2e-9f6f-6b0b710acf12",amount:300000,date:"2026-10-16T14:48:04Z",bidStatus:"WINNING",` +
  `bidderIdentifier:"SuprDough",reactiveBid:!1,maxAmount:null}],otherItems:$R[300]=[$R[301]={id:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",amount:1,date:"2020-01-01T00:00:00Z"}]`;

Deno.test("parsePcarBoard reads each open item with dollars, bid count, close time and schema", () => {
  const { items, totalPages } = parsePcarBoard(BOARD);
  assertEquals(totalPages, 3);
  assertEquals(items.length, 2);
  assertEquals(items[0], {
    id: "28d8dfc0-a0e5-40e7-b4cb-51349093f862",
    slug: "1968-chevrolet-camaro-ss",
    url: "https://pcarmarket.com/auction/1968-chevrolet-camaro-ss",
    title: '350-Powered 1968 Chevrolet Camaro 4-Speed "Modified"',
    status: "ITEM_OPEN",
    currency: "USD",
    current_bid: 3000,
    bid_count: 9,
    ends: "2026-10-19T18:42:00Z",
    schema: "Vehicle",
    image_count: 83,
  });
  assertEquals(items[1].schema, "Watches");
  assertEquals(items[1].current_bid, null);
});

Deno.test("parsePcarBids reads the lot's bid history with Basta ids and clocks, not other arrays", () => {
  const bids = parsePcarBids(LOT);
  assertEquals(bids.map((b) => [b.id.slice(0, 8), b.amount, b.at, b.bidder, b.status]), [
    ["8b9084fe", 250, "2026-10-13T12:32:12Z", "Nick7989", "LOSING"],
    ["45acc0f7", 3000, "2026-10-16T14:48:04Z", "SuprDough", "WINNING"],
  ]);
  assertEquals(parsePcarBids("<html>no bids</html>"), []);
});

Deno.test("bonhamsLot keeps the www.bonhams.com url spelling, the lot's hammer time and the estimate in its currency", () => {
  const lot = bonhamsLot({
    id: "31858-205", lotId: "205", auctionId: "31858", status: "NEW",
    title: "c.1905 Humber (Coventry) 8/10hp Two-Seat Open Tourer",
    slug: "c1905-humber-coventry-810hp-two-seat-open-tourer-chassis-no-c-355-engine-no-843",
    hammerTime: { datetime: "2026-10-30T17:00:00+00:00" },
    currency: { iso_code: "GBP" },
    price: { GBPLowEstimate: 20000.0, GBPHighEstimate: 30000.0 },
  });
  assertEquals(lot.url, "https://www.bonhams.com/auction/31858/lot/205/c1905-humber-coventry-810hp-two-seat-open-tourer-chassis-no-c-355-engine-no-843");
  assertEquals([lot.ends, lot.currency, lot.estimate_low, lot.estimate_high, lot.hammer], ["2026-10-30T17:00:00+00:00", "GBP", 20000, 30000, null]);
});

// Bonhams, captured 2026-10-20 ~19:45Z from api01.bonhams.com/search-proxy (Typesense "auctions" and "lots") and
// live.bonhams.com/widget/lots/<sale AM id> (the bidding platform), trimmed to the fields read. Bidder registrations
// (paddles) in the platform's answer are left out here and are never read.
const SALES: Record<string, BonhamsSaleDoc> = {
  // in-room: the only open motoring sale with lots on 2026-10-20
  "31858": { id: "31858", auctionTitle: "The Golden Age of Motoring Sale", auctionType: "PUBLIC", biddingStatus: "NS",
    dates: { end: { datetime: "2026-10-30T23:59:59+00:00" } }, flags: { isAuctionEnded: false } },
  // online, bidding open (not motoring: no online motoring sale was open that day)
  "31998": { id: "31998", auctionTitle: "Silver and Objects of Vertu including A Private Collection of Indian and Burmese Silver",
    auctionType: "ONLINE", biddingStatus: "IP", dates: { end: { datetime: "2026-10-21T10:00:00+00:00" } }, flags: { isAuctionEnded: false } },
  // online motoring, bidding opens 2026-12-04
  "32060": { id: "32060", auctionTitle: "Motorcycles Online - The Winter Sale", auctionType: "ONLINE", biddingStatus: "NS",
    dates: { end: { datetime: "2026-12-14T12:00:00+00:00" } }, flags: { isAuctionEnded: false } },
  "32522": { id: "32522", auctionTitle: "The Autumn Automobilia Auction", auctionType: "ONLINE", biddingStatus: "EN",
    dates: { end: { datetime: "2026-09-24T11:00:00+00:00" } }, flags: { isAuctionEnded: true } },
};

const BID_ANSWER = {
  result_page: [
    // 31998 lot 13: twelve bids, leading £2,400
    { row_id: "4-N877UF", lot_number: 13, status: "active", starting_price: "1200.00", estimate_low: "1500.00", estimate_high: "2200.00",
      cover_thumbnail: "https://images4-cdn.auctionmobility.com/is3/auctionmobility-static4/eDaV-4-3YROE/4-N877XY/3816628b-45e5-4510-9057-950e09bf7008",
      extended_end_time: "2026-10-21T10:12:00.000Z", live_bid_timed_count: 12,
      timed_auction_bid: { row_id: "4-NDF888", amount: "2400.00", created_at: "2026-10-19T17:05:21.456Z" }, sold_price: null,
      auction: { row_id: "4-KJTRO1", auction_code: "31998", auction_type: "timed", currency_code: "GBP" } },
    // 31998 lot 193: open, no bid yet
    { row_id: "4-N87930", lot_number: 193, status: "active", starting_price: "1300.00", estimate_low: "1500.00", estimate_high: "2500.00",
      cover_thumbnail: "https://images4-cdn.auctionmobility.com/is3/auctionmobility-static4/MrCL-4-3YROE/4-N8795C/9e523e22-4715-4629-882f-46af80e39152",
      extended_end_time: "2026-10-21T13:12:00.000Z", live_bid_timed_count: 0, timed_auction_bid: null, sold_price: null,
      auction: { row_id: "4-KJTRO1", auction_code: "31998", auction_type: "timed", currency_code: "GBP" } },
    // 31858 lot 218, 1923 Rolls-Royce Silver Ghost: in-room, no bid, no close of its own
    { row_id: "4-N9Y4MG", lot_number: 218, status: "active", starting_price: null, estimate_low: "50000.00", estimate_high: "70000.00",
      cover_thumbnail: "https://images4-cdn.auctionmobility.com/is3/auctionmobility-static4/TtAK-4-3YROE/4-N9Y4O0/cbd0bea5-841c-465e-a82b-0c4609e1fd0d",
      extended_end_time: null, live_bid_timed_count: 0, timed_auction_bid: null, sold_price: null,
      auction: { row_id: "4-MDU1C2", auction_code: "31858", auction_type: "live", currency_code: "GBP" } },
    // 32338 lot 60, 1987 Ford LTD Crown Victoria (online car sale, 2025-11): last bid 11:58:34 moved its close to 12:01:34
    { row_id: "4-IW0PAR", lot_number: 60, status: "sold", starting_price: "10.00", estimate_low: "20000.00", estimate_high: "40000.00",
      cover_thumbnail: "https://images4-cdn.auctionmobility.com/is3/auctionmobility-static4/C8Ya-4-3YROE/4-IW0PCV/0de20ed3-24dd-45c7-bf37-6b765ef93528",
      extended_end_time: "2025-11-28T12:01:34.374Z", live_bid_timed_count: 44,
      timed_auction_bid: { row_id: "4-J0C3SY", amount: "36000.00", created_at: "2025-11-28T11:58:34.374Z" }, sold_price: "36000.00",
      auction: { row_id: "4-IP7Y8X", auction_code: "32338", auction_type: "timed", currency_code: "EUR" } },
  ],
  responseCode: 200,
};

Deno.test("bonhamsSaleKind: only an online sale with bidding open is a live-bid sale; in-room sales are catalog", () => {
  assertEquals(Object.values(SALES).map((s) => [s.id, bonhamsSaleKind(s)]), [
    ["31858", "catalog"], ["31998", "live_bid"], ["32060", "online_not_open"], ["32522", "ended"],
  ]);
});

Deno.test("parseBonhamsBidStates reads the leading bid, its time, bid count, extended close and currency", () => {
  const s = parseBonhamsBidStates(BID_ANSWER);
  assertEquals(s.length, 4);
  assertEquals(s[0], {
    am_lot_id: "4-N877UF", status: "active", sale_type: "timed", current_bid: 2400, bid_at: "2026-10-19T17:05:21.456Z",
    opening_bid: 1200, bid_count: 12, ends: "2026-10-21T10:12:00.000Z", currency: "GBP",
    image: "https://images4-cdn.auctionmobility.com/is3/auctionmobility-static4/eDaV-4-3YROE/4-N877XY/3816628b-45e5-4510-9057-950e09bf7008",
  });
  assertEquals([s[1].current_bid, s[1].opening_bid, s[1].bid_count], [null, 1300, 0]);
  assertEquals([s[2].sale_type, s[2].current_bid, s[2].ends, s[2].opening_bid], ["live", null, null, null]);
  assertEquals([s[3].current_bid, s[3].bid_at, s[3].ends, s[3].currency], [36000, "2025-11-28T11:58:34.374Z", "2025-11-28T12:01:34.374Z", "EUR"]);
  assertEquals(parseBonhamsBidStates({ message: "nope" }), []);
});

Deno.test("bonhamsLotPhase: live only for an open timed lot of a live-bid sale; in-room lots stay upcoming", () => {
  const [bid, noBid, inRoom, sold] = parseBonhamsBidStates(BID_ANSWER);
  const at = Date.parse("2026-10-20T19:45:00Z");
  assertEquals(bonhamsLotPhase("live_bid", bid, at), "live");
  assertEquals(bonhamsLotPhase("live_bid", noBid, at), "live"); // biddable now, no bid yet: live with no current bid
  assertEquals(bonhamsLotPhase("catalog", inRoom, at), "upcoming");
  assertEquals(bonhamsLotPhase("live_bid", inRoom, at), "upcoming"); // the platform says in-room: never a live bid
  assertEquals(bonhamsLotPhase("live_bid", undefined, at), "upcoming"); // no state from the platform: not claimed live
  assertEquals(bonhamsLotPhase("online_not_open", bid, at), "upcoming");
  assertEquals(bonhamsLotPhase("live_bid", sold, at), "closed");
  assertEquals(bonhamsLotPhase("live_bid", bid, Date.parse("2026-10-21T10:12:00Z")), "closed"); // at its close
});

Deno.test("bonhamsLot carries the platform ids, image, no-reserve flag and a EUR lot's own-currency estimate", () => {
  // Typesense lot 32338-60 (EUR): its price carries GBP* conversions and estimateLow/High in euros, no EUR* keys
  const car = bonhamsLot({
    id: "32338-60", lotId: "60", auctionId: "32338", lotAMId: "4-IW0PAR", auctionAMId: "4-IP7Y8X",
    title: "1987 Ford LTD Crown Victoria Chassis no. 2FABP72GXHX137117", slug: "1987-ford-ltd-crown-victoria-chassis-no-2fabp72gxhx137117",
    status: "SOLD", hammerTime: { datetime: "2025-11-28T11:59:00+00:00" }, currency: { iso_code: "EUR" },
    price: { GBPHighEstimate: 31138.45, GBPLowEstimate: 31138.45, estimateHigh: 40000.0, estimateLow: 20000.0, hammerPremium: 40320.0,
             hammerPrice: 36000.0, startingBidAmount: null },
    flags: { isAuctionEnded: true, isWithoutReserve: true },
    image: { url: "https://images1.bonhams.com/image?src=Images/live/2025-11/07/25776563-20-1.jpg" },
  });
  assertEquals([car.estimate_low, car.estimate_high, car.hammer, car.no_reserve, car.am_lot_id, car.am_sale_id, car.image],
    [20000, 40000, 36000, true, "4-IW0PAR", "4-IP7Y8X", "https://images1.bonhams.com/image?src=Images/live/2025-11/07/25776563-20-1.jpg"]);
  // Typesense lot 31858-218 (GBP, in-room)
  const inRoom = bonhamsLot({
    id: "31858-218", lotId: "218", auctionId: "31858", lotAMId: "4-N9Y4MG", auctionAMId: "4-MDU1C2",
    title: "1923 Rolls-Royce 40/50hp Silver Ghost Limousine Chassis no. 56HG Engine no. P489",
    slug: "1923-rolls-royce-4050hp-silver-ghost-limousine-chassis-no-56hg-engine-no-p489", status: "NEW",
    hammerTime: { datetime: "2026-10-30T17:00:00+00:00" }, currency: { iso_code: "GBP" },
    price: { GBPHighEstimate: 70000.0, GBPLowEstimate: 50000.0, estimateHigh: 70000.0, estimateLow: 50000.0, hammerPremium: 0.0, hammerPrice: 0.0,
             startingBidAmount: null },
    flags: { isAuctionEnded: false, isWithoutReserve: false },
    image: { url: "https://images1.bonhams.com/image?src=Images/live/2026-10/09/25930215-3-7.jpg" },
  });
  assertEquals([inRoom.url, inRoom.ends, inRoom.estimate_low, inRoom.estimate_high, inRoom.hammer, inRoom.no_reserve],
    ["https://www.bonhams.com/auction/31858/lot/218/1923-rolls-royce-4050hp-silver-ghost-limousine-chassis-no-56hg-engine-no-p489",
     "2026-10-30T17:00:00+00:00", 50000, 70000, null, false]);
});

// Broad Arrow's bidding site, read 2026-10-20 19:36Z (fields trimmed; values as served). The page's state line from
// https://bid.broadarrowauctions.com/ with two of its six sales: the in-room Las Vegas sale and a timed online sale.
const BA_PAGE = `<script>\n        viewVars = {"currentRouteName":"upcoming-auctions","brand":"broadarrowauctions","auctions":{"result_page":[` +
  `{"row_id":"1-D1BF6R","auction_type":"live","title":"The Las Vegas Auction 2026","time_start":"2026-10-31T21:30:00Z","duration":"PT4H30M",` +
  `"timezone":"America\\/Los_Angeles","effective_end_time":"2026-11-01T02:00:00Z","extend_by_auction":false,"extended_end_time":null,"currency_code":"USD"},` +
  `{"row_id":"1-DGLXWK","auction_type":"timed","title":"Global Icons: Memorabilia Online 2026","time_start":"2026-11-09T09:00:00Z","duration":"P13DT9H",` +
  `"timezone":"Europe\\/Paris","effective_end_time":"2026-11-22T21:26:00Z","extend_by_auction":false,"extended_end_time":null,"currency_code":"EUR"}],` +
  `"query_info":{"page_size":20,"page_start_offset":0,"total_num_results":6}},"serverTime":1792525001813};\n</script>`;

// /ajax/lots/?auctionId=1-D1GBGZ (Global Icons: Zoute Online 2026, a timed car sale that closed 2026-10-14) and
// /ajax/lots/?auctionId=1-DGLXWK (the memorabilia sale above, not yet open), read 2026-10-20.
const ZOUTE: AmSale = { row_id: "1-D1GBGZ", auction_type: "timed", title: "Global Icons: Zoute Online 2026", time_start: "2026-10-05T08:00:00Z",
  effective_end_time: "2026-10-14T16:36:56Z", extend_by_auction: false, extended_end_time: null, currency_code: "EUR" };
const FERRARI: AmLotDoc = { row_id: "1-DH4AXO", lot_number: 107, status: "sold", title: "2005 Ferrari 575M Maranello", estimate_low: "120000.00",
  estimate_high: "160000.00", starting_price: null, currency_code: "EUR",
  cover_thumbnail: "https://images-cdn.auctionmobility.com/is3/auctionmobility-static/dL9y-1-5M3B07/1-DHWN7F/ee017a95-034c-4123-9b92-26b31d8e6585",
  extended_end_time: "2026-10-14T15:18:40Z", timed_auction_bid: { amount: "125000.00", created_at: "2026-10-14T15:17:40.541Z" }, reserve_met: true,
  _detail_url: "/lots/view/1-DH4AXO/2005-ferrari-575m-maranello" };
const BENTLEY: AmLotDoc = { row_id: "1-DH4AYG", lot_number: 121, status: "reserve_not_met",
  title: "2016 Bentley Mulsanne Extended Wheelbase ex-Her Majesty Queen Elizabeth II", estimate_low: "400000.00", estimate_high: "450000.00",
  starting_price: null, currency_code: "EUR", extended_end_time: "2026-10-14T16:00:00Z", timed_auction_bid: null, reserve_met: false,
  _detail_url: "/lots/view/1-DH4AYG/2016-bentley-mulsanne-extended-wheelbase-ex-her-majesty-queen-elizabeth-ii" };
const MEMO = amSales(BA_PAGE)[1];
const GLOVES: AmLotDoc = { row_id: "1-DJT38T", lot_number: 102, status: "active", title: "Ralf Schumacher 2004 Original Williams Gloves",
  estimate_low: "200.00", estimate_high: "400.00", starting_price: null, currency_code: "EUR", extended_end_time: "2026-11-22T18:01:00Z",
  timed_auction_bid: null, reserve_met: null, _detail_url: "/lots/view/1-DJT38T/ralf-schumacher-2004-original-williams-gloves" };
const READ_AT = Date.parse("2026-10-20T19:36:41Z");

Deno.test("amSales reads the sales Broad Arrow's bidding page server-renders", () => {
  const sales = amSales(BA_PAGE);
  assertEquals(sales.map((s) => [s.row_id, s.auction_type, s.time_start, s.currency_code]), [
    ["1-D1BF6R", "live", "2026-10-31T21:30:00Z", "USD"],
    ["1-DGLXWK", "timed", "2026-11-09T09:00:00Z", "EUR"],
  ]);
  assertEquals(amSales("<html>no state</html>"), []);
});

Deno.test("amOpenTimedSales keeps started timed car sales: never the in-room sale, never a memorabilia sale", () => {
  const sales = [...amSales(BA_PAGE), ZOUTE];
  assertEquals(amOpenTimedSales(sales, READ_AT), []); // Zoute closed 2026-10-14 16:36Z
  assertEquals(amOpenTimedSales(sales, Date.parse("2026-10-04T00:00:00Z")), []); // before it opened
  assertEquals(amOpenTimedSales(sales, Date.parse("2026-10-10T00:00:00Z")).map((s) => s.row_id), ["1-D1GBGZ"]);
  assertEquals(amOpenTimedSales(sales, Date.parse("2026-10-14T20:00:00Z")).map((s) => s.row_id), ["1-D1GBGZ"]); // within six hours of its end
  assertEquals(amOpenTimedSales(sales, Date.parse("2026-11-01T00:00:00Z")), []); // the Las Vegas sale is in the room
  assertEquals(amOpenTimedSales(sales, Date.parse("2026-11-10T00:00:00Z")), []); // the memorabilia sale is open, not read
});

Deno.test("amTimedLot reads the top timed bid, the lot's extended close, estimate, currency, image and bidding-page url", () => {
  const lot = amTimedLot(FERRARI, ZOUTE, Date.parse("2026-10-14T15:10:00Z"));
  assertEquals(lot, {
    external_id: "1-DH4AXO",
    url: "https://bid.broadarrowauctions.com/lots/view/1-DH4AXO/2005-ferrari-575m-maranello",
    title: "2005 Ferrari 575M Maranello",
    lot_number: "107",
    status: "sold",
    open: false, // read after it closed: a sold lot is never open, whatever the clock
    vehicle: true,
    current_bid: 125000,
    bid_at: "2026-10-14T15:17:40.541Z",
    opening_bid: null,
    currency: "EUR",
    ends: "2026-10-14T15:18:40Z", // a bid at 15:17:40 moved the close a minute on
    estimate_low: 120000,
    estimate_high: 160000,
    reserve_met: true,
    image_url: "https://images-cdn.auctionmobility.com/is3/auctionmobility-static/dL9y-1-5M3B07/1-DHWN7F/ee017a95-034c-4123-9b92-26b31d8e6585",
  });
  const unsold = amTimedLot(BENTLEY, ZOUTE, READ_AT);
  assertEquals([unsold.open, unsold.current_bid, unsold.reserve_met, unsold.status], [false, null, false, "reserve_not_met"]);
});

Deno.test("an active lot is open only between its sale's start and its own close", () => {
  assertEquals(amTimedLot(GLOVES, MEMO, READ_AT).open, false); // sale opens 2026-11-09
  assertEquals(amTimedLot(GLOVES, MEMO, Date.parse("2026-11-10T00:00:00Z")).open, true);
  assertEquals(amTimedLot(GLOVES, MEMO, Date.parse("2026-11-22T18:01:00Z")).open, false);
  assertEquals(amTimedLot(GLOVES, { ...MEMO, auction_type: "live" }, Date.parse("2026-11-10T00:00:00Z")).open, false);
});

Deno.test("amIsVehicleLot: a model-year title in a car sale, not a year-led part in a memorabilia sale", () => {
  assertEquals(amIsVehicleLot("1996 Jaguar XK8 Coupé", "Global Icons: Zoute Online 2026"), true);
  assertEquals(amIsVehicleLot("1992 Original Lotus 107C Rear Wing Element", "Global Icons: Memorabilia Online 2026"), false);
  assertEquals(amIsVehicleLot("Ralf Schumacher 2004 Original Williams Gloves", "Global Icons: Memorabilia Online 2026"), false);
  assertEquals(amTimedLot(GLOVES, MEMO, READ_AT).vehicle, false);
});

// Ultimate WooCommerce Auction houses. Fixtures are verbatim cuts of pages fetched 2026-10-20 (bidder-name cells removed
// from the bid histories): every product card of https://www.allcollectorcars.com/classic-car-auctions/auctions/ (server
// time 15:58:24 EDT) and of https://iconicmotorbikeauctions.com/ (12:59:39 PDT); the countdown, reserve box and bid
// history of the ACC lot 1970-chevrolet-chevelle-ss-396-2 and the Iconic lot 1993-muzzy-kawasaki-zx-7r-scott-russell-wsbk.
const fixture = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const ACC = UWA_HOUSES.allcollectorcars;
const ICONIC = UWA_HOUSES["iconic-motorbike-auctions"];

Deno.test("parseUwaBoard reads every ACC card: lot id, link, title, image, bid, close in UTC, tags", () => {
  const cards = parseUwaBoard(fixture("uwa-acc-auctions-20261020.html"));
  assertEquals(cards.length, 63);
  assertEquals(cards.every((c) => c.status === "live"), true);
  assertEquals(cards.filter((c) => c.current_bid !== null).length, 61);
  assertEquals(cards.filter((c) => c.starting_bid !== null).map((c) => [c.auction_id, c.starting_bid]), [["1978203", 1000], ["1978527", 1000]]);
  const rr = cards.find((c) => c.auction_id === "1978798")!;
  assertEquals(rr, {
    auction_id: "1978798",
    href: "https://www.allcollectorcars.com/classic-car-auctions/vehicles/1969-plymouth-road-runner/",
    url: "https://www.allcollectorcars.com/classic-car-auctions/vehicles/1969-plymouth-road-runner",
    title: "1969 Plymouth Road Runner Convertible",
    subtitle: "Numbers-Matching 383 HP V8 | A-833 4-Speed | 3.23 Sure Grip | Factory A/C | 1-of-1 Galen Registry Documented",
    image: "https://allcollectorcars.nyc3.digitaloceanspaces.com/auction/wp-content/uploads/2026/10/16163731/Screenshot-2026-10-16-at-4.22.48-PM-400x225.png",
    status: "live",
    current_bid: 1200,
    starting_bid: null,
    symbol: "$",
    ends_local: "2026-10-27 14:00:00",
    zone: "America/New_York",
    ends: "2026-10-27T18:00:00.000Z",
    reserve_met: null,
    no_reserve: false,
    categories: ["auctions", "convertible", "muscle-car-auctions", "plymouth", "road-runner"],
  });
  assertEquals(uwaCurrency(rr, ACC), "USD");
  // entities decoded in titles
  assertEquals(cards.find((c) => c.auction_id === "1978449")!.title, "1976 Chevrolet Blazer Cheyenne 4×4");
});

Deno.test("uwaOpenLots keeps ACC's vehicles and drops its automobilia (kiddie rides, signs, a traffic light)", () => {
  const cards = parseUwaBoard(fixture("uwa-acc-auctions-20261020.html"));
  const open = uwaOpenLots(cards, ACC, Date.parse("2026-10-20T19:58:24Z"));
  const dropped = cards.filter((c) => !open.includes(c)).map((c) => c.title);
  assertEquals(dropped.sort(), ["Custom Ferrari Neon Sign", "Rabbit Kiddie Ride", "Sandy Horse Kiddie Ride", "Space Shuttle Kiddie Ride",
    "Vintage Traffic Light Replica"]);
  assertEquals([open.length, open.filter((c) => c.current_bid !== null).length], [58, 56]);
  // a lot whose close has passed is not open
  assertEquals(uwaOpenLots(cards, ACC, Date.parse("2026-10-27T18:00:00Z")).length, 0);
});

Deno.test("parseUwaBoard reads Iconic's cards: soft-close time, reserve met, no-reserve titles, Bidding Open", () => {
  const cards = parseUwaBoard(fixture("uwa-iconic-home-20261020.html"));
  assertEquals(cards.length, 24);
  assertEquals(cards.filter((c) => c.current_bid !== null).length, 20);
  const bimota = cards.find((c) => c.auction_id === "96471")!;
  // the close moved by a late bid: 13:00:00 became 13:01:16 Pacific
  assertEquals([bimota.title, bimota.current_bid, bimota.ends_local, bimota.zone, bimota.ends, bimota.reserve_met],
    ["1991 Bimota YB10 Dieci", 11600, "2026-10-20 13:01:16", "America/Los_Angeles", "2026-10-20T20:01:16.000Z", true]);
  const montesa = cards.find((c) => c.auction_id === "101225")!;
  assertEquals([montesa.no_reserve, montesa.reserve_met, uwaIdentityTitle(montesa.title)],
    [true, true, "2003 Montesa Honda HRC 315R Dougie Lampkin Replica"]);
  const fzr = cards.find((c) => c.auction_id === "100945")!;
  assertEquals([fzr.current_bid, fzr.starting_bid, fzr.symbol, uwaCurrency(fzr, ICONIC)], [null, null, null, "USD"]);
});

Deno.test("uwaOpenLots keeps Iconic's motorcycles and drops its memorabilia and watch", () => {
  const cards = parseUwaBoard(fixture("uwa-iconic-home-20261020.html"));
  const open = uwaOpenLots(cards, ICONIC, Date.parse("2026-10-20T19:59:39Z"));
  const dropped = cards.filter((c) => !open.includes(c)).map((c) => c.auction_id);
  // signed helmet (only "motorbikes"), team leathers (memorabilia), Tissot watch (no motorbikes category)
  assertEquals(dropped.sort(), ["101122", "101387", "101460"]);
  assertEquals([open.length, open.filter((c) => c.current_bid !== null).length], [21, 18]);
  assertEquals(isUwaVehicle(cards.find((c) => c.auction_id === "97934")!, ICONIC), true); // 1912 Indian board-track racer
  // after the Bimota's extended close it is no longer open
  assertEquals(uwaOpenLots(cards, ICONIC, Date.parse("2026-10-20T20:01:17Z")).some((c) => c.auction_id === "96471"), false);
});

Deno.test("uwaKnownMake takes the make from a tag the title spells right after the year", () => {
  assertEquals(uwaKnownMake("1992 Mercedes-Benz 190E", ["auctions", "foreign-and-import-car-auctions", "luxury", "mercedes-benz", "190e"]), "Mercedes-Benz");
  assertEquals(uwaKnownMake("1986 Zimmer Golden Spirit", ["auctions", "classic-car-auctions", "zimmer", "zimmer-golden-spirit"]), "Zimmer");
  assertEquals(uwaKnownMake("2003 Montesa Honda HRC 315R Dougie Lampkin Replica", ["montesa", "motorbikes"]), "Montesa");
  // no tag names the first words: the first word stays the make
  assertEquals(uwaKnownMake("2017 Ford Mustang Shelby GT350", ["auctions", "mustang", "late-models", "performance-car-auctions", "shelby", "gt350"]), null);
});

Deno.test("parseUwaLot reads the bid count, reserve state and close of a lot page", () => {
  assertEquals(parseUwaLot(fixture("uwa-acc-lot-1978441-20261020.html"), "1978441"), {
    bid_count: 8, reserve_met: false, ends_local: "2026-10-22 13:50:00", zone: "America/New_York", ends: "2026-10-22T17:50:00.000Z",
  });
  assertEquals(parseUwaLot(fixture("uwa-iconic-lot-101200-20261020.html"), "101200"), {
    bid_count: 30, reserve_met: true, ends_local: "2026-10-24 14:00:00", zone: "America/Los_Angeles", ends: "2026-10-24T21:00:00.000Z",
  });
  // another lot's page, or no page: nothing claimed
  assertEquals(parseUwaLot(fixture("uwa-acc-lot-1978441-20261020.html"), "1"), {
    bid_count: null, reserve_met: false, ends_local: null, zone: null, ends: null,
  });
});

Deno.test("zonedTimeToIso converts a house's wall clock through daylight saving", () => {
  assertEquals(zonedTimeToIso("2026-10-27 14:00:00", "America/New_York"), "2026-10-27T18:00:00.000Z");
  assertEquals(zonedTimeToIso("2026-11-02 13:00:00", "America/New_York"), "2026-11-02T18:00:00.000Z");
  assertEquals(zonedTimeToIso("2026-11-01 01:30:00", "America/Los_Angeles"), "2026-11-01T08:30:00.000Z");
  assertEquals(zonedTimeToIso("2026-10-27 14:00:00", "Not/AZone"), null);
  assertEquals(zonedTimeToIso("27/10/2026", "America/New_York"), null);
});
