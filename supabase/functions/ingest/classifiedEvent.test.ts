import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifiedListingId, classifiedPlatform } from "./classifiedEvent.ts";

Deno.test("only listing pages of the two classified hosts are classified", () => {
  assertEquals(classifiedPlatform("https://classiccars.com/listings/view/2118864/1991-chevrolet-1500-for-sale-in-preston-mississippi-39354"), "classiccars");
  assertEquals(classifiedPlatform("https://www.classiccars.com/listings/view/2118864/x"), "classiccars");
  assertEquals(classifiedPlatform("https://cars.ksl.com/listing/10860045"), "ksl");
  assertEquals(classifiedPlatform("https://cars.ksl.com/search/sort/0"), null);
  assertEquals(classifiedPlatform("https://evil.example/cars.ksl.com/listing/1"), null);
  assertEquals(classifiedPlatform("https://www.facebook.com/marketplace/item/2297460464372011/"), "facebook_marketplace");
  assertEquals(classifiedPlatform("https://www.facebook.com/groups/1/"), null);
  assertEquals(classifiedPlatform("not a url"), null);
});

Deno.test("the listing id is the numeric id in the path", () => {
  assertEquals(classifiedListingId("https://classiccars.com/listings/view/2118864/1991-x"), "2118864");
  assertEquals(classifiedListingId("https://cars.ksl.com/listing/10860045"), "10860045");
  assertEquals(classifiedListingId("https://www.facebook.com/marketplace/item/2297460464372011/"), "2297460464372011");
  assertEquals(classifiedListingId("https://example.com/"), null);
});
