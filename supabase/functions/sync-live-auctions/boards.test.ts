import { assertEquals } from "jsr:@std/assert@1";
import {
  aucticEventListings, aucticEvents, aucticEventsToRead, aucticState, bjCalendar, bjDocketLots, bjDocketMatch, bjEventsToRead,
  type BonhamsSaleDoc, bonhamsLot, bonhamsLotPhase, bonhamsSaleKind, inertiaPage, type MecumIndexHit, mecumLot, mecumRunDatesToRead,
  mecumSalesToRead, parseBonhamsBidStates, parsePcarBids, parsePcarBoard,
} from "./boards.ts";
import { type AmLotDoc, type AmSale, amIsVehicleLot, amOpenTimedSales, amSales, amTimedLot } from "./boards.ts";

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

// Mecum's public lot index (Algolia U6CFCQ7V52 / wp_posts_lot), records as the reader requests them, read 2026-10-20 19:40Z.
// The calendar facet (sale "Name|first run date|last run date" -> lots), four of its 272 values.
const MECUM_FACET: Record<string, number> = {
  "Nashville 2026|1790035200|1790380800": 1691,
  "Dallas/Fort Worth 2026|1792540800|1792800000": 1258,
  "Las Vegas 2026|1794441600|1794614400": 191,
  "Kissimmee 2027|1799107200|1800144000": 910,
};
const tax = (sale: string, saleSlug: string, run: string, type: string, year: number | null, make: string | null, model: string | null, statuses: string[]) => ({
  auction_tax: [{ name: sale, slug: saleSlug }],
  lot_status: statuses.map((s) => ({ name: s, slug: s })),
  lot_type: [{ name: type, slug: type.toLowerCase().replace(" ", "-") }],
  ...(year ? { lot_year: [{ name: year, slug: String(year) }] } : {}),
  ...(make ? { make: [{ name: make, slug: make.toLowerCase() }] } : {}),
  ...(model ? { model: [{ name: model, slug: model.toLowerCase() }] } : {}),
  run_date: [{ name: run, slug: run }],
});
const NASH = "Nashville 2026|1790035200|1790380800";
const DFW = "Dallas/Fort Worth 2026|1792540800|1792800000";
// Nashville 2026, run day 24 Sep: sold with the hammer stated, the bid goes on, sold with no hammer stated, and no result stated.
const T149: MecumIndexHit = { post_title: "1969 Plymouth Barracuda Formula S Fastback", permalink: "/lots/1177898/1969-plymouth-barracuda-formula-s-fastback/",
  taxonomies: tax(NASH, "nashville-2026", "2026-09-24", "Auto", 1969, "Plymouth", "Barracuda", ["star"]), auction_day_start_meta: "2026-09-24 05:00:00",
  current_bid_meta: 31000, images_meta: [{ url: "https://res.cloudinary.com/mecum/image/upload/v1785517738/auctions/TN26/1177898/725650.jpg" }],
  lot_number_meta: "T149", sold: 1, bid_goes_on: 0, highest_bid_or_price: 34100 };
const T247: MecumIndexHit = { post_title: "1950 Ford Custom Deluxe", permalink: "/lots/1175178/1950-ford-custom-deluxe/",
  taxonomies: tax(NASH, "nashville-2026", "2026-09-24", "Auto", 1950, "Ford", "Custom Deluxe", ["star"]), auction_day_start_meta: "2026-09-24 05:00:00",
  current_bid_meta: 30000, lot_number_meta: "T247", sold: 0, bid_goes_on: 1, highest_bid_or_price: 30000 };
const T25: MecumIndexHit = { post_title: "1987 Mercedes-Benz 560SL Convertible", permalink: "/lots/1177207/1987-mercedes-benz-560sl-convertible/",
  taxonomies: tax(NASH, "nashville-2026", "2026-09-24", "Auto", 1987, "Mercedes-Benz", "560SL", ["Feature"]), auction_day_start_meta: "2026-09-24 05:00:00",
  lot_number_meta: "T25", sold: 1, bid_goes_on: 0, highest_bid_or_price: 26400 };
const T172: MecumIndexHit = { post_title: "1966 Chevrolet Chevy II", permalink: "/lots/1177954/1966-chevrolet-chevy-ii/",
  taxonomies: tax(NASH, "nashville-2026", "2026-09-24", "Auto", 1966, "Chevrolet", "Chevy II", ["star"]), auction_day_start_meta: "2026-09-24 05:00:00",
  current_bid_meta: 115000, lot_number_meta: "T172", sold: 0, bid_goes_on: 0, highest_bid_or_price: 115000 };
// Dallas/Fort Worth 2026 (21-24 Oct), not yet run when read: a car with no bid, a no-reserve car stating $100, a Road Art sign taking pre-bids.
const W290: MecumIndexHit = { post_title: "1955 Ford Thunderbird Convertible", permalink: "/lots/1182658/1955-ford-thunderbird-convertible/",
  taxonomies: tax(DFW, "dallas-fort-worth-2026", "2026-10-21", "Auto", 1955, "Ford", "Thunderbird", ["Feature"]), auction_day_start_meta: "2026-10-21 05:00:00",
  images_meta: [{ url: "https://res.cloudinary.com/mecum/image/upload/v1791409762/auctions/DA26/1182658/127987.jpg" }],
  lot_number_meta: "W290", sold: 0, bid_goes_on: 0, highest_bid_or_price: 0 };
const W21: MecumIndexHit = { post_title: "2014 Volkswagen Jetta SportWagen TDI", permalink: "/lots/1180508/2014-volkswagen-jetta-sportwagen-tdi/",
  taxonomies: tax(DFW, "dallas-fort-worth-2026", "2026-10-21", "Auto", 2014, "Volkswagen", "Jetta", ["feature", "no-reserve"]), auction_day_start_meta: "2026-10-21 05:00:00",
  current_bid_meta: 100, lot_number_meta: "W21", sold: 0, bid_goes_on: 0, highest_bid_or_price: 100 };
const Z443: MecumIndexHit = { post_title: "Texaco Single-Sided Porcelain Neon Sign", permalink: "/lots/1183002/texaco-single-sided-porcelain-neon-sign/",
  taxonomies: tax(DFW, "dallas-fort-worth-2026", "2026-10-24", "Road Art", null, null, null, ["general"]), auction_day_start_meta: "2026-10-24 05:00:00",
  current_bid_meta: 2000, has_prebidding_meta: true, lot_number_meta: "Z443", sold: 0, bid_goes_on: 0, highest_bid_or_price: 2000 };
const MECUM_READ_AT = Date.parse("2026-10-20T19:40:00Z");

Deno.test("mecumSalesToRead reads a sale from 00:00 UTC of its first run date to 12:00 UTC after its last, and nothing else", () => {
  assertEquals(mecumSalesToRead(MECUM_FACET, MECUM_READ_AT), []); // read the day before the sale: nothing runs
  assertEquals(mecumSalesToRead(MECUM_FACET, Date.parse("2026-10-21T00:00:00Z")).map((s) => s.name), ["Dallas/Fort Worth 2026"]);
  assertEquals(mecumSalesToRead(MECUM_FACET, Date.parse("2026-10-25T11:59:00Z")).map((s) => s.name), ["Dallas/Fort Worth 2026"]);
  assertEquals(mecumSalesToRead(MECUM_FACET, Date.parse("2026-10-25T12:00:00Z")), []);
  assertEquals(mecumSalesToRead(MECUM_FACET, Date.parse("2026-09-24T18:00:00Z")).map((s) => s.name), ["Nashville 2026"]);
});

Deno.test("mecumRunDatesToRead reads today, and yesterday until 12:00 UTC, inside the sale's dates", () => {
  const [dfw] = mecumSalesToRead(MECUM_FACET, Date.parse("2026-10-21T06:00:00Z"));
  assertEquals(mecumRunDatesToRead(dfw, Date.parse("2026-10-21T06:00:00Z")), ["2026-10-21"]);
  assertEquals(mecumRunDatesToRead(dfw, Date.parse("2026-10-22T07:00:00Z")), ["2026-10-21", "2026-10-22"]);
  assertEquals(mecumRunDatesToRead(dfw, Date.parse("2026-10-22T15:00:00Z")), ["2026-10-22"]);
  assertEquals(mecumRunDatesToRead(dfw, Date.parse("2026-10-25T03:00:00Z")), ["2026-10-24"]);
});

Deno.test("mecumLot: a car is open on its run day, from the day's start until 24 hours later, and upcoming before", () => {
  assertEquals(mecumLot(W290, MECUM_READ_AT)?.state, "upcoming");
  const open = mecumLot(W290, Date.parse("2026-10-21T15:00:00Z"));
  assertEquals(open, {
    url: "https://www.mecum.com/lots/1182658/1955-ford-thunderbird-convertible/",
    lot_id: "1182658", title: "1955 Ford Thunderbird Convertible", lot_number: "W290", sale: "Dallas/Fort Worth 2026", run_day: "2026-10-21",
    opens: "2026-10-21T05:00:00.000Z", closes: "2026-10-22T05:00:00.000Z", state: "open", result: null,
    current_bid: null, closing_bid: null, price_with_premium: null, prebid: false, no_reserve: false,
    image: "https://res.cloudinary.com/mecum/image/upload/v1791409762/auctions/DA26/1182658/127987.jpg",
    year: 1955, make: "Ford", model: "Thunderbird",
  });
  assertEquals(mecumLot(W290, Date.parse("2026-10-22T05:00:00Z"))?.state, "closed");
  const jetta = mecumLot(W21, Date.parse("2026-10-21T15:00:00Z"))!;
  assertEquals([jetta.state, jetta.current_bid, jetta.no_reserve], ["open", 100, true]);
  assertEquals(mecumLot(W21, MECUM_READ_AT)!.current_bid, null); // a stated bid is not shown before the lot's day opens
});

Deno.test("mecumLot: a crossed lot carries its result, its hammer bid when stated and the sale price apart from the bid", () => {
  const sold = mecumLot(T149, Date.parse("2026-09-24T20:00:00Z"))!;
  assertEquals([sold.state, sold.result, sold.closing_bid, sold.price_with_premium, sold.current_bid], ["crossed", "sold", 31000, 34100, null]);
  const bgo = mecumLot(T247, Date.parse("2026-09-24T20:00:00Z"))!;
  assertEquals([bgo.state, bgo.result, bgo.closing_bid, bgo.price_with_premium], ["crossed", "bid-goes-on", 30000, null]);
  const noHammer = mecumLot(T25, Date.parse("2026-09-24T20:00:00Z"))!;
  assertEquals([noHammer.result, noHammer.closing_bid, noHammer.price_with_premium], ["sold", null, 26400]);
  const none = mecumLot(T172, Date.parse("2026-09-25T06:00:00Z"))!;
  assertEquals([none.state, none.result, none.closing_bid], ["closed", null, 115000]);
});

Deno.test("mecumLot leaves out Road Art and records without a lot page", () => {
  assertEquals(mecumLot(Z443, MECUM_READ_AT), null);
  assertEquals(mecumLot({ ...W290, permalink: "" }, MECUM_READ_AT), null);
});

// Barrett-Jackson, read 2026-10-20 ~19:50Z, trimmed to the fields read: its calendar (www.barrett-jackson.com/api/non-past-events),
// its bidding platform bid.barrett-jackson.com (Auctic: the home page, the events archive, the Las Vegas 2026 event page as
// Inertia JSON) and its docket API (/api/docket?slug=2026-las-vegas&type=Vehicles).
const BJ_CALENDAR = [
  { attributes: { start_date: "2026-11-05", end_date: "2026-11-12", name: "2026 Nov. Digital Select", slug: "2026-november-digital-select",
    event_status: "select_preview", event_type: "Online", event_timezone: "America/Phoenix" } },
  { attributes: { start_date: "2027-01-23", end_date: "2027-01-31", name: "2027 Scottsdale", slug: "2027-scottsdale",
    event_status: "upcoming", event_type: "Live", event_timezone: "America/Phoenix" } },
];
const AUCTIC_VERSION = "3e5e1baf188c3de95b428d7839516208"; // gitleaks:allow (the site's public asset-build hash, not a secret)
const AUCTIC_HOME_HTML = `<div class="relative"> <div id="app" data-page="${
  JSON.stringify({ component: "Site/Index", props: { events: [], auctions: [], featured_listings: [] }, url: "/", version: AUCTIC_VERSION })
    .replace(/"/g, "&quot;")}"></div></div>`;
const AUCTIC_ARCHIVE_EVENTS = [
  { id: 327, title: "Las Vegas 2026 Collector Car Auction", slug: "las-vegas-2026-collector-car-auction", status: "archived", event_type: "live_auction",
    category: "Collector Cars", start_time: "2026-09-10T11:59:00.000000Z", end_time: "2026-09-12T23:58:00.000000Z" },
  { id: 328, title: "Las Vegas 2026 - Automobilia Auction", slug: "las-vegas-2026-automobilia-auction", status: "archived", event_type: "live_auction",
    category: "Automobilia", start_time: "2026-09-10T09:36:00.000000Z", end_time: "2026-09-12T11:00:00.000000Z" },
];
const AUCTIC_EVENT_PROPS = {
  event: { id: 327, title: "Las Vegas 2026 Collector Car Auction", slug: "las-vegas-2026-collector-car-auction", event_type: "live_auction",
    status: "archived", start_time: "2026-09-10T11:59:00.000000Z", end_time: "2026-09-12T23:58:00.000000Z" },
  listings: { current_page: 1, per_page: 4000, total: 599, data: [
    { id: 11987, slug: "1981-honda-atc200-three-wheeler", url: "/events/listing/11987/1981-honda-atc200-three-wheeler", lot_number: "1",
      title: "1981 HONDA ATC200 THREE-WHEELER", status: "sold", start_time: "2026-09-10T11:00:00+00:00", end_time: "2026-09-10T17:55:25+00:00",
      starting_bid_amount: 0, highest_bid_amount: 2500, sold_price: 2500, number_of_bids: 17,
      hero: "https://vapor-barrettjackson-production.s3.amazonaws.com/40413/conversions/340c2478-c28b-f111-ab10-000d3a337bf6_a1cd7b50-0093-409f-94f1-649dfe7d721d_Web-xl.jpg",
      sale_day: 1, sale_method: "auction", show_countdown: false, meta: { is_manual_close: true, is_onsite: false, sale_day: 1 } },
    { id: 11988, slug: "1979-honda-atc110-three-wheeler", url: "/events/listing/11988/1979-honda-atc110-three-wheeler", lot_number: "2",
      title: "1979 HONDA ATC110 THREE-WHEELER", status: "sold", start_time: "2026-09-10T11:02:00+00:00", end_time: "2026-09-10T17:56:54+00:00",
      starting_bid_amount: 0, highest_bid_amount: 1000, sold_price: 1000, number_of_bids: 5,
      hero: "https://vapor-barrettjackson-production.s3.amazonaws.com/40421/conversions/a3ce0d7f-ff8a-f111-ab10-000d3a5cf316_777fcfb1-0f47-4215-8353-53fbac613bf7_Web-xl.jpg",
      sale_day: 1, sale_method: "auction", show_countdown: false, meta: { is_manual_close: true, is_onsite: false, sale_day: 1 } },
    { id: 12650, slug: "1965-ford-mustang", url: "/events/listing/12650/1965-ford-mustang", lot_number: "45", title: "1965 FORD MUSTANG",
      status: "passed", start_time: "2026-09-10T12:50:24+00:00", end_time: "2026-09-10T19:01:13+00:00", starting_bid_amount: 0,
      highest_bid_amount: 1000, sold_price: null, number_of_bids: 1,
      hero: "https://vapor-barrettjackson-production.s3.amazonaws.com/58260/conversions/7b0a570f-e677-f011-b4cc-6045bd024560_f190071e-3f13-4916-bf5b-00e9c121b273_Web-xl.jpg",
      sale_day: 1, sale_method: "auction", show_countdown: false, meta: { is_manual_close: true, is_onsite: false, sale_day: 1 } },
  ] },
};
const BJ_DOCKET = { data: [
  { attributes: { lot_number: "1", title: "1981 HONDA ATC200 THREE-WHEELER", slug: "1981-honda-atc200-three-wheeler-302207", item_id: "302207",
    event_slug: "2026-las-vegas", year: "1981", make: "HONDA", model: "ATC200", reserve_type_name: "No Reserve" } },
  { attributes: { lot_number: "2", title: "1979 HONDA ATC110 THREE-WHEELER", slug: "1979-honda-atc110-three-wheeler-302193", item_id: "302193",
    event_slug: "2026-las-vegas", year: "1979", make: "HONDA", model: "ATC110", reserve_type_name: "No Reserve" } },
], meta: { pagination: { page: "1", pageCount: 1, pageSize: "1000", total: 594 } } };

Deno.test("bjCalendar and bjEventsToRead: nothing is read on 20 Oct; the Digital Select is read from a day before it opens", () => {
  const cal = bjCalendar(BJ_CALENDAR);
  assertEquals(cal.map((e) => [e.slug, e.start_date, e.end_date, e.type]), [
    ["2026-november-digital-select", "2026-11-05", "2026-11-12", "Online"], ["2027-scottsdale", "2027-01-23", "2027-01-31", "Live"]]);
  assertEquals(bjEventsToRead(cal, Date.parse("2026-10-20T19:50:00Z")), []);
  assertEquals(bjEventsToRead(cal, Date.parse("2026-11-04T00:00:00Z")).map((e) => e.slug), ["2026-november-digital-select"]);
  assertEquals(bjEventsToRead(cal, Date.parse("2026-11-14T23:59:00Z")).map((e) => e.slug), ["2026-november-digital-select"]);
  assertEquals(bjEventsToRead(cal, Date.parse("2026-11-15T00:00:00Z")), []);
  assertEquals(bjCalendar({ error: "x" }), []);
});

Deno.test("inertiaPage reads the Auctic home page's props and asset version; today it lists no event", () => {
  const page = inertiaPage(AUCTIC_HOME_HTML)!;
  assertEquals([page.component, page.version, aucticEvents(page.props)], ["Site/Index", AUCTIC_VERSION, []]);
  assertEquals(inertiaPage("<html>no app</html>"), null);
});

Deno.test("aucticEventsToRead never reads an archived or automobilia event", () => {
  const events = aucticEvents({ events: AUCTIC_ARCHIVE_EVENTS });
  assertEquals(events.map((e) => [e.id, e.category, e.status]), [[327, "Collector Cars", "archived"], [328, "Automobilia", "archived"]]);
  assertEquals(aucticEventsToRead(events, Date.parse("2026-09-11T18:00:00Z")), []);
  // The archive keeps no record of these events' status while they ran; with the archived flag cleared, the window is
  // two hours before the event opens to 12 hours after it ends, and the automobilia event is still left out.
  const running = events.map((e) => ({ ...e, status: "" }));
  assertEquals(aucticEventsToRead(running, Date.parse("2026-09-11T18:00:00Z")).map((e) => e.id), [327]);
  assertEquals(aucticEventsToRead(running, Date.parse("2026-09-10T09:58:00Z")).map((e) => e.id), []);
  assertEquals(aucticEventsToRead(running, Date.parse("2026-09-13T11:57:00Z")).map((e) => e.id), [327]);
});

Deno.test("aucticEventListings reads each lot's status, times, bid, sold price and count; sold and passed lots are closed", () => {
  const { event, listings } = aucticEventListings(AUCTIC_EVENT_PROPS);
  assertEquals([event?.id, event?.type, listings.length], [327, "live_auction", 3]);
  assertEquals(listings[0], {
    id: 11987, lot_number: "1", title: "1981 HONDA ATC200 THREE-WHEELER", status: "sold", opens: "2026-09-10T11:00:00+00:00",
    closes: "2026-09-10T17:55:25+00:00", high_bid: 2500, sold_price: 2500, bids: 17,
    image: "https://vapor-barrettjackson-production.s3.amazonaws.com/40413/conversions/340c2478-c28b-f111-ab10-000d3a337bf6_a1cd7b50-0093-409f-94f1-649dfe7d721d_Web-xl.jpg",
    url: "https://bid.barrett-jackson.com/events/listing/11987/1981-honda-atc200-three-wheeler", manual_close: true,
  });
  assertEquals([listings[2].status, listings[2].high_bid, listings[2].sold_price], ["passed", 1000, null]);
  const at = Date.parse("2026-09-10T20:00:00Z");
  assertEquals(listings.map((l) => aucticState(l, at)), ["closed", "closed", "closed"]);
  // An active lot (as lot 1 was on its sale day) is open once its own bidding opens, upcoming before.
  assertEquals(aucticState({ ...listings[0], status: "active" }, Date.parse("2026-09-10T12:00:00Z")), "open");
  assertEquals(aucticState({ ...listings[0], status: "active" }, Date.parse("2026-09-10T10:00:00Z")), "upcoming");
  assertEquals(aucticState({ ...listings[0], status: "paused" }, Date.parse("2026-09-10T12:00:00Z")), "upcoming");
});

Deno.test("bjDocketMatch keys a lot to the docket lot with its number and title, in the spelling vehicles hold, and never guesses", () => {
  const { listings } = aucticEventListings(AUCTIC_EVENT_PROPS);
  const docket = bjDocketLots(BJ_DOCKET);
  assertEquals(docket[0], { lot_number: "1", title: "1981 HONDA ATC200 THREE-WHEELER", year: 1981, make: "HONDA", model: "ATC200", no_reserve: true,
    url: "https://barrett-jackson.com/2026-las-vegas/docket/vehicle/1981-honda-atc200-three-wheeler-302207" });
  const match = bjDocketMatch(listings, docket);
  assertEquals([...match.entries()].map(([id, d]) => [id, d.url]), [
    [11987, "https://barrett-jackson.com/2026-las-vegas/docket/vehicle/1981-honda-atc200-three-wheeler-302207"],
    [11988, "https://barrett-jackson.com/2026-las-vegas/docket/vehicle/1979-honda-atc110-three-wheeler-302193"],
  ]);
  // lot 45 (passed) is not in the docket the API returns after the sale; a lot number with another title is no match
  assertEquals(bjDocketMatch([{ ...listings[1], lot_number: "1" }], docket).size, 0);
});
