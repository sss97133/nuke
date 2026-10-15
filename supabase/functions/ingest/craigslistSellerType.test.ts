// Run: deno test --allow-env supabase/functions/ingest/craigslistSellerType.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseSellerClass } from "../_shared/craigslistAttributes.ts";
import { craigslistSellerTypeRow, dealerWordingIn, SELLER_TYPE_METHOD } from "./craigslistSellerType.ts";

const ID = "00000000-0000-4000-8000-000000000001";
const crumb = (p: string) => `<script type="application/ld+json">{"itemListElement":[{"item":"https://www.craigslist.org/search/subarea/pen?cat=cta&purveyor=${p}","name":"cars+trucks"}]}</script>`;

Deno.test("the breadcrumb's search link names the class the page belongs to", () => {
  assertEquals(parseSellerClass(crumb("owner"))?.value, "owner");
  assertEquals(parseSellerClass(crumb("dealer"))?.value, "dealer");
  assertEquals(parseSellerClass(crumb("owner"))?.text, "search/subarea/pen?cat=cta&purveyor=owner");
  assertEquals(parseSellerClass("<html>no breadcrumb</html>"), null);
});

Deno.test("a declared owner is private at 0.9, a declared dealer is dealer at 0.9, a page with no class is unknown", () => {
  const o = craigslistSellerTypeRow(ID, parseSellerClass(crumb("owner")), "1 owner, runs great");
  assertEquals([o.value, o.method, (o.evidence as any).basis, (o.evidence as any).confidence, (o.evidence as any).field], ["private", SELLER_TYPE_METHOD, "declared", 0.9, "purveyor"]);
  const d = craigslistSellerTypeRow(ID, parseSellerClass(crumb("dealer")), "We offer financing");
  assertEquals([d.value, (d.evidence as any).confidence], ["dealer", 0.9]);
  const u = craigslistSellerTypeRow(ID, null, "x");
  assertEquals([u.value, (u.evidence as any).confidence], ["unknown", 0]);
});

Deno.test("a private post that uses dealer wording drops to 0.5 and lists the terms", () => {
  const r = craigslistSellerTypeRow(ID, parseSellerClass(crumb("owner")), "Trade-ins welcome, we offer financing");
  assertEquals((r.evidence as any).confidence, 0.5);
  assertEquals((r.evidence as any).wording_terms, ["financing", "we offer", "trade-ins"]);
  assertEquals(dealerWordingIn("clean title, one owner"), []);
});
