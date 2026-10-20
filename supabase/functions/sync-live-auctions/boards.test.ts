import { assertEquals } from "jsr:@std/assert@1";
import {
  type BonhamsSaleDoc, bonhamsLot, bonhamsLotPhase, bonhamsSaleKind, parseBonhamsBidStates, parsePcarBids, parsePcarBoard,
} from "./boards.ts";
import { type AmLotDoc, type AmSale, amIsVehicleLot, amOpenTimedSales, amSales, amTimedLot } from "./boards.ts";
import {
  goodingBoardLot, type GoodingCatalogLot, goodingCatalogFor, goodingLinkPlan, goodingWithBidState, parseGoodingLots,
} from "./boards.ts";
// Gooding, captured from the house (each file names its source): its bidding platform's lot documents while a timed sale
// was open (Internet Archive capture), after a timed sale with cars closed, and today's board; its catalog for those lots.
import amOpen from "./fixtures/gooding_am_open_2025-04-18.json" with { type: "json" };
import amClosed from "./fixtures/gooding_am_closed_2023-12.json" with { type: "json" };
import amToday from "./fixtures/gooding_am_upcoming_2026-10-20.json" with { type: "json" };
import catDec23 from "./fixtures/gooding_catalog_2023-12.json" with { type: "json" };
import catSpring25 from "./fixtures/gooding_catalog_2025-04.json" with { type: "json" };
import amWidget from "./fixtures/gooding_am_widget_2023-12.json" with { type: "json" };

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

import { berlinWallClockIso, kickdownRssImages, parseKickdownList } from "./boards.ts";

// Three cards of https://www.kickdown.com/en/auctions/live (2026-10-20 20:11Z), as served but trimmed: the watch-list star,
// the 6-hour signed image links, the teaser text and the utility classes inside a card are cut. A lot closing within a day
// (countdown with offset), one a week out with no bid yet ("Starting bid", printed German time after the 25 Oct clock
// change) and one without reserve.
const KD_CARD = (body: string) => `<div class="tw-auction-card-white tw-relative tw-group" ${body}`;
const KD_BOARD = '<div>45 cars</div>' +
  KD_CARD('id="auction_card_bf16c411738f"><div><div></div><a data-turbo="false" href="/en/postings/bf16c411738f-2008-porsche-911-997-turbo-in-de-32105-bad-salzuflen"><div><img alt="" /></div><div></div><div><div><div><div><div>41.000 €</div><div>Highest bid</div></div></div><div><div><span id="countdown" data-controller="countdown" data-countdown-end-time-value="2026-10-21 19:30:00 +0200" data-ending-text="Closing auction..."></span></div><div>21/10/2026 7:30 PM</div></div></div></div></a></div><a data-turbo="false" href="/en/postings/bf16c411738f-2008-porsche-911-997-turbo-in-de-32105-bad-salzuflen"><div><h3>Porsche 911 997 Turbo (2008)</h3><span><span>480 HP</span><span aria-hidden="true">·</span><span>97.014 km</span></span><div><p></p></div></div></a><div><div><turbo-frame loading="lazy" id="badge_Running"><span>Running</span></turbo-frame><turbo-frame loading="lazy" id="badge_Expert report"><a data-turbo="false" href="/en/postings/bf16c411738f-2008-porsche-911-997-turbo-in-de-32105-bad-salzuflen#photos-documents">Expert report</a></turbo-frame></div></div></div>') +
  KD_CARD('id="auction_card_ee93a278586c"><div><div></div><a data-turbo="false" href="/en/postings/ee93a278586c-1947-willys-overland-jeepster-in-de-14797-potsdam"><div><img alt="" /></div><div></div><div><div><div><div><div>0 €</div><div>Starting bid</div></div></div><div><div>7 days</div><div>27/10/2026 7:45 PM</div></div></div></div></a></div><a data-turbo="false" href="/en/postings/ee93a278586c-1947-willys-overland-jeepster-in-de-14797-potsdam"><div><h3>Willys Overland Jeepster (1947)</h3><span><span>14.263 mi</span></span><div><p></p></div></div></a><div><div><turbo-frame loading="lazy" id="badge_Running"><span>Running</span></turbo-frame></div></div></div>') +
  KD_CARD('id="auction_card_9a7e8f74b8a9"><div><div></div><a data-turbo="false" href="/en/postings/9a7e8f74b8a9-1977-audi-80-gls-in-de-23564-luebeck"><div><img alt="" /></div><div></div><div><div><div><div><div>1.700 €</div><div>Highest bid</div></div></div><div><div>2 days</div><div>22/10/2026 7:55 PM</div></div></div></div></a></div><a data-turbo="false" href="/en/postings/9a7e8f74b8a9-1977-audi-80-gls-in-de-23564-luebeck"><div><h3>Audi 80 GLS (1977)</h3><span><span>86 HP</span><span aria-hidden="true">·</span><span>69.638 km</span></span><div><p></p></div></div></a><div><div><turbo-frame loading="lazy" id="badge_Running"><span>Running</span></turbo-frame><turbo-frame loading="lazy" id="badge_Without reserve"><span>Without reserve</span></turbo-frame></div></div></div>') +
  '<a href="/en/auctions/live?page=2">2</a>';

Deno.test("parseKickdownList reads each running card's canonical link, euro bid, close time with offset and reserve", () => {
  const { items, total, lastPage } = parseKickdownList(KD_BOARD);
  assertEquals([items.length, total, lastPage], [3, 45, 2]);
  assertEquals(items[0], {
    id: "bf16c411738f",
    url: "https://www.kickdown.com/postings/bf16c411738f-2008-porsche-911-997-turbo-in-de-32105-bad-salzuflen",
    title: "Porsche 911 997 Turbo (2008)",
    year: 2008,
    current_bid: 41000,
    currency: "EUR",
    ends: "2026-10-21T19:30:00+02:00",
    no_reserve: false,
    running: true,
  });
  // the lot page of the Jeepster reads data-tab-title-ends-at-value="2026-10-27T19:45:00+01:00" (CET after the clock change)
  assertEquals([items[1].current_bid, items[1].currency, items[1].ends], [null, "EUR", "2026-10-27T19:45:00+01:00"]);
  assertEquals([items[2].current_bid, items[2].ends, items[2].no_reserve], [1700, "2026-10-22T19:55:00+02:00", true]);
  assertEquals(berlinWallClockIso(2026, 1, 15, 20, 0), "2026-01-15T20:00:00+01:00");
});

Deno.test("kickdownRssImages maps each lot id to the feed's lasting image link", () => {
  // One item of https://www.kickdown.com/en/auctions/live.rss (2026-10-20), content_encoded cut.
  const item = "<item>\n      <media:image>https://www.kickdown.com/rails/active_storage/representations/redirect/eyJfcmFpbHMiOnsiZGF0YSI6Mjc1NjUzNCwicHVyIjoiYmxvYl9pZCJ9fQ==--365441b7f6cb2149a4969bde6f26e7ebef8e9d58/eyJfcmFpbHMiOnsiZGF0YSI6eyJmb3JtYXQiOiJqcGVnIiwicmVzaXplIjoiMTAwMHg3NTBeIiwiZXh0ZW50IjoiMTAwMHg3NTAiLCJncmF2aXR5IjoiY2VudGVyIiwiYXV0b19vcmllbnQiOnRydWUsInF1YWxpdHkiOiI4MCUifSwicHVyIjoidmFyaWF0aW9uIn19--853c794402a4d9508eeb1b8f3ea2123749aa81eb/Fahrzeug-1.jpg?locale=en</media:image>\n" + // gitleaks:allow (a public image link's blob digests, not secrets)
    "      <title>Porsche 911 997 Turbo (2008), one previous owner, extensive service history, and extremely well-maintained, rated 2+, ceramic brakes</title>\n" +
    "      <pubDate>Auktionsende: 21.10.2026 - 19:30</pubDate>\n      <link>https://www.kickdown.com/postings/bf16c411738f</link>\n    </item>";
  const images = kickdownRssImages(`<rss><channel>${item}</channel></rss>`);
  assertEquals([...images.keys()], ["bf16c411738f"]);
  assertEquals(images.get("bf16c411738f")?.startsWith("https://www.kickdown.com/rails/active_storage/representations/redirect/"), true);
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

Deno.test("Gooding today: no lot of a timed sale is open or upcoming on its bidding platform (2026-10-20)", () => {
  const page = parseGoodingLots(amToday, Date.parse("2026-10-20T19:45:57Z"));
  assertEquals([page.lots.length, page.total, page.next], [0, 0, null]);
});

Deno.test("Gooding open sale: each active lot with its standing bid, its own staggered close, estimate and currency", () => {
  const now = amOpen.serverTime; // 2025-04-18T00:18:22Z, the capture's own server clock
  const page = parseGoodingLots(amOpen.lots, now);
  assertEquals([page.total, page.next], [525, 3]); // the platform's total; the next offset after this (trimmed) page
  assertEquals(page.lots.map((l) => [l.lot_number, l.phase, l.current_bid, l.ends, l.reserve_met]), [
    [1, "open", 2300, "2025-04-18T16:00:00Z", null],
    [2, "open", 775, "2025-04-18T16:00:30Z", true],
    [28, "open", 14500, "2025-04-18T16:13:30Z", true],
  ]);
  const [first] = page.lots;
  assertEquals(first, {
    am_lot_id: "1-AF7H9S", am_auction_id: "1-9QGHT2", sale: "Geared Online | Spring Automobilia 2025", auction_type: "timed",
    auction_active_lots: 525, lot_number: 1, title: "Ferrari Illuminated Dealership Sign", status: "active", phase: "open",
    current_bid: 2300, bid_at: "2025-04-17T20:04:42.479Z", bid_count: null, opening_bid: 25, sold_price: null, reserve_met: null, without_reserve: true,
    starts: "2025-04-11T16:00:00Z", ends: "2025-04-18T16:00:00Z", estimate_low: 10000, estimate_high: 15000, currency: "USD",
    image: "https://images-cdn.auctionmobility.com/is3/auctionmobility-static/iiyL-1-NERL3/1-AGYT8D/aaf88261-e500-4cc4-90ef-c7bfee313de8",
    bid_url: "https://bid.goodingco.com/lots/view/1-AF7H9S/ferrari-illuminated-dealership-sign", state_sequence: 35,
  });
  // the same documents judged before the sale opened, and 15 seconds after lot 1's close
  assertEquals(parseGoodingLots(amOpen.lots, Date.parse("2025-04-11T15:00:00Z")).lots.map((l) => l.phase), ["upcoming", "upcoming", "upcoming"]);
  assertEquals(parseGoodingLots(amOpen.lots, Date.parse("2025-04-18T16:00:15Z")).lots.map((l) => l.phase), ["closed", "open", "open"]);
});

Deno.test("Gooding open sale of automobilia: the catalog says Automobilia, so no lot is a vehicle for the board", () => {
  const catalog = catSpring25.data.getVehicles.vehicles as GoodingCatalogLot[];
  const rows = parseGoodingLots(amOpen.lots, amOpen.serverTime).lots.map((l) => goodingBoardLot(l, goodingCatalogFor(l, catalog)));
  assertEquals(rows.map((r) => [r.url, r.item_type, r.vehicle]), [
    ["https://goodingco.com/lot/ferrari-illuminated-dealership-sign", "Automobilia", false],
    ["https://goodingco.com/lot/ferrari-logo-sign-1a", "Automobilia", false],
    ["https://goodingco.com/lot/ferrari-brochures-for-212-tuboscocca-and-340-america", "Automobilia", false],
  ]);
});

Deno.test("Gooding closed sale with cars: closed lots, the hammer kept, catalog identity by sale id and lot number", () => {
  const lots = parseGoodingLots(amClosed, Date.parse("2026-10-20T19:00:00Z")).lots;
  assertEquals(lots.map((l) => [l.lot_number, l.status, l.phase, l.current_bid, l.sold_price, l.ends]), [
    [2, "sold", "closed", 8000, 8000, "2023-12-08T17:04:00Z"],
    [19, "sold", "closed", 245000, 245000, "2023-12-08T18:13:49Z"],
    [43, "reserve_not_met", "closed", null, null, "2023-12-08T19:48:00Z"],
  ]);
  const catalog = catDec23.data.getVehicles.vehicles as GoodingCatalogLot[];
  const rows = lots.map((l) => goodingBoardLot(l, goodingCatalogFor(l, catalog)));
  assertEquals(rows[1], {
    url: "https://goodingco.com/lot/1957-porsche-356-a-speedster-1c",
    title: "1957 Porsche 356 A Speedster", year: 1957, make: "Porsche", model: "356 A Speedster",
    // the spelling vehicle de44862c-3aff-45b3-8f1c-ff7808ddd570 holds as primary_image_url (read 2026-10-20)
    image: "https://media.goodingco.com/image/upload/c_fill,g_auto,q_90,w_1800/v1/Prod/O23G_December%202023/214_1957%20Porsche%20356%20A%20Speedster/1957_Porsche_356_A_Speedster_52_dn263q",
    no_reserve: true, item_type: "Cars", vehicle: true,
  });
  assertEquals([rows[0].vehicle, rows[2].vehicle, rows[2].no_reserve, rows[2].url], [false, true, false, "https://goodingco.com/lot/1973-porsche-911-carrera-rs-27-lightweight-1b"]);
  // unmatched in the catalog: the platform's own lot page, a vehicle only when the title opens with a year
  assertEquals([goodingBoardLot(lots[1], null).url, goodingBoardLot(lots[1], null).vehicle, goodingBoardLot(lots[0], null).vehicle],
    ["https://bid.goodingco.com/lots/view/1-8DT8SX/1957-porsche-356-a-speedster", true, false]);
});

Deno.test("Gooding bid box state: the widget answer adds the bid count and the close it moved, read by the shared parser", () => {
  const now = Date.parse("2026-10-20T19:00:00Z");
  const lots = parseGoodingLots(amClosed, now).lots;
  const states = new Map(parseBonhamsBidStates(amWidget).map((s) => [s.am_lot_id, s]));
  const [, porsche356, rs27] = lots.map((l) => goodingWithBidState(l, states.get(l.am_lot_id), now));
  assertEquals([porsche356.bid_count, porsche356.current_bid, porsche356.bid_at, porsche356.ends, porsche356.phase],
    [54, 245000, "2023-12-08T18:10:49.400Z", "2023-12-08T18:13:49.307Z", "closed"]);
  assertEquals([rs27.bid_count, rs27.current_bid, rs27.status], [36, null, "reserve_not_met"]);
  assertEquals(goodingWithBidState(lots[0], undefined, now), lots[0]); // no state: as listed
});

Deno.test("Gooding link plan: write under the spelling a vehicle holds, claim a discovery-only vehicle, never mint a twin", () => {
  // vehicles rows as read 2026-10-20
  assertEquals(goodingLinkPlan("https://goodingco.com/lot/1957-porsche-356-a-speedster-1c", [
    { id: "de44862c-3aff-45b3-8f1c-ff7808ddd570", listing_url: null, discovery_url: "https://goodingco.com/lot/1957-porsche-356-a-speedster-1c" },
  ]), { url: "https://goodingco.com/lot/1957-porsche-356-a-speedster-1c", link: "claim", vehicle_id: "de44862c-3aff-45b3-8f1c-ff7808ddd570" });
  assertEquals(goodingLinkPlan("https://goodingco.com/lot/2006-ferrari-f430-spider", [
    { id: "beac6545-451a-470f-865b-0eeca43a5671", listing_url: "https://www.goodingco.com/lot/2006-ferrari-f430-spider", discovery_url: "https://goodingco.com/lot/2006-ferrari-f430-spider" },
  ]), { url: "https://www.goodingco.com/lot/2006-ferrari-f430-spider", link: "held", vehicle_id: "beac6545-451a-470f-865b-0eeca43a5671" });
  assertEquals(goodingLinkPlan("https://goodingco.com/lot/1990-ferrari-348-tb", [
    { id: "1349de34-a459-47b0-8411-3bd39cf2fca8", listing_url: "https://bringatrailer.com/listing/1990-ferrari-348-5", discovery_url: "https://goodingco.com/lot/1990-ferrari-348-tb" },
  ]), { url: "https://goodingco.com/lot/1990-ferrari-348-tb", link: "other", vehicle_id: null });
  assertEquals(goodingLinkPlan("https://goodingco.com/lot/not-held", []), { url: "https://goodingco.com/lot/not-held", link: "new", vehicle_id: null });
});
