// deno test --allow-read supabase/functions/mcp-connector/advisor/vin_test.ts
import { classifyVinQuery, vinCheckDigitValid } from "./vin.ts";
import { detectLoginWall } from "./listing_fetch.ts";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("free text is never a VIN", () => {
  for (const q of ["1972 Chevy C10", "1972CHEVYC10", "E30 M3", "Land Cruiser FJ40", "1966 Ford Mustang", "porsche"]) {
    assert(classifyVinQuery(q).kind === "text", q);
  }
});

Deno.test("17-char VINs and pre-1981 chassis numbers are VINs", () => {
  const a = classifyVinQuery("1GCCS14W8Y8123456");
  assert(a.kind === "vin17", "17-char");
  const b = classifyVinQuery("WBSAK05060AE42262");
  assert(b.kind === "vin17", "euro 17-char");
  assert(classifyVinQuery("1442612348").kind === "chassis", "VW chassis");
  assert(classifyVinQuery("CE142S123456").kind === "chassis", "Chevy chassis");
  assert(classifyVinQuery("9113600123").kind === "chassis", "Porsche chassis");
});

Deno.test("check digit", () => {
  assert(vinCheckDigitValid("1M8GDM9AXKP042788"), "known-good sample VIN");
  assert(!vinCheckDigitValid("1M8GDM9A1KP042788"), "bad check digit");
});

Deno.test("login walls are detected", () => {
  const fb = "https://www.facebook.com/marketplace/item/1553879402836295/";
  assert(detectLoginWall(fb, "https://www.facebook.com/login/?next=%2Fmarketplace%2Fitem%2F1", "") !== null, "fb login redirect");
  assert(detectLoginWall(fb, "https://www.facebook.com/checkpoint/block/", "") !== null, "checkpoint");
  assert(detectLoginWall(fb, fb, `<title>Log into Facebook</title><form id="login_form">`) !== null, "fb login html");
  assert(detectLoginWall(fb, fb, `<title>1966 Ford Mustang | Facebook Marketplace</title>`) === null, "real listing");
  const bat = "https://bringatrailer.com/listing/1994-mazda-mx-5-miata-146/";
  assert(detectLoginWall(bat, bat, `<a href="https://bringatrailer.com/account/login/">Log in</a><title>1994 Mazda</title>`) === null, "login link on a listing page");
});
