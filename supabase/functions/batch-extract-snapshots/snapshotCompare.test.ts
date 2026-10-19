import { assertEquals } from "jsr:@std/assert@1";
import { compareIdentity, judge, pickBjLotPrice, urlVariants } from "./snapshotCompare.ts";

Deno.test("a page naming the row's car publishes; case, punctuation and make aliases do not matter", () => {
  const row = { year: 1970, make: "Ford", model: "Ranchero GT", vin: "0A48H123456" };
  const lots = [{ event_id: "e1", url: "https://www.barrett-jackson.com/a/docket/vehicle/x-1", snapshot_id: "s1",
    page: { year: 1970, make: "FORD", model: "RANCHERO GT PICKUP", vin: "0A48H123456" } }];
  assertEquals(judge(row, lots).verdict, "publish");
  assertEquals(compareIdentity({ make: "Chevy" }, { make: "Chevrolet" }).make, true);
});

Deno.test("a missing VIN on either side is unknown, not a disagreement; a different VIN is", () => {
  const row = { year: 2017, make: "Chevrolet", model: "Silverado 1500", vin: null };
  const page = { year: 2017, make: "Chevrolet", model: "Silverado 1500", vin: "1GCVKREC5HZ000001" };
  assertEquals(judge(row, [{ event_id: "e", url: "u", snapshot_id: "s", page }]).verdict, "publish");
  assertEquals(judge({ ...row, vin: "1GCVKREC5HZ000002" }, [{ event_id: "e", url: "u", snapshot_id: "s", page }]).verdict, "row_disagrees");
});

Deno.test("lots naming different cars are a split candidate, never a publish", () => {
  const row = { year: 1999, make: "Dodge", model: "Durango Shelby SUV" };
  const lots = [
    { event_id: "a", url: "https://barrett-jackson.com/palm-beach-2006/docket/vehicle/1999-dodge-durango-custom-suv-40002", snapshot_id: "s1",
      page: { year: 1999, make: "Dodge", model: "Durango Custom SUV" } },
    { event_id: "b", url: "https://barrett-jackson.com/scottsdale-2004/docket/vehicle/1999-dodge-durango-shelby-suv-20235", snapshot_id: "s2",
      page: { year: 1999, make: "Dodge", model: "Durango Shelby SUV" } },
  ];
  assertEquals(judge(row, lots).verdict, "lots_disagree");
});

Deno.test("a different year or no readable page holds the vehicle back", () => {
  const page = { year: 1968, make: "Chevrolet", model: "Camaro" };
  assertEquals(judge({ year: 1969, make: "Chevrolet", model: "Camaro" }, [{ event_id: "e", url: "u", snapshot_id: "s", page }]).verdict, "row_disagrees");
  assertEquals(judge({ year: 1969, make: "Chevrolet", model: "Camaro" }, [{ event_id: "e", url: "u", snapshot_id: null, page: null }]).verdict, "no_page");
});

Deno.test("url variants cover www, scheme and a trailing slash", () => {
  const v = urlVariants("https://barrett-jackson.com/scottsdale-2013/docket/vehicle/x-138413");
  for (const s of ["https://www.barrett-jackson.com/scottsdale-2013/docket/vehicle/x-138413/",
    "http://barrett-jackson.com/scottsdale-2013/docket/vehicle/x-138413"]) assertEquals(v.includes(s), true);
});

Deno.test("the same VIN decides identity over model labels; a different VIN is a different car", () => {
  const lots = [
    { event_id: "a", url: "u1", snapshot_id: "s1", page: { year: 1970, make: "Plymouth", model: "Coupe", vin: "BS23R0B216443" } },
    { event_id: "b", url: "u2", snapshot_id: "s2", page: { year: 1970, make: "Plymouth", model: "Hemi 'Cuda", vin: "BS23R0B216443" } },
  ];
  assertEquals(judge({ year: 1970, make: "Plymouth", model: "Hemi 'Cuda", vin: "BS23R0B216443" }, lots).verdict, "publish");
  assertEquals(judge({ year: 1973, make: "Nissan", model: "240z 2 Door Coupe", vin: "HLS30140531" },
    [{ event_id: "e", url: "u", snapshot_id: "s", page: { year: 1973, make: "Datsun", model: "240z", vin: "HLS30140531" } }]).verdict, "publish");
  assertEquals(judge({ year: 1969, make: "Chevrolet", model: "Camaro Z/28", vin: "124379N623063" },
    [{ event_id: "e", url: "u", snapshot_id: "s", page: { year: 1969, make: "Chevrolet", model: "Camaro Z/28", vin: "123679N685509" } }]).verdict, "row_disagrees");
});

Deno.test("the lot price is the lot record's, not the menu's bidder-package promo", () => {
  const promo = '{"title":"2026 Palm Beach","label":"Bidder packages start at","price":"$$250.00"}';
  const lot = '{"lot_number":"75470","description":"350 TPI, 700R4","price":"$$66,000.00","is_reserve":false,"main_image_url":"x"}';
  assertEquals(pickBjLotPrice(promo + promo + lot), 66000);
  assertEquals(pickBjLotPrice(promo + promo), null);
  assertEquals(pickBjLotPrice('"price":"$$12,500.00","other":1'), 12500);
});
