// Run: deno test supabase/functions/_shared/craigslistImages.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { imageKey, planCraigslistImages } from "./craigslistImages.ts";

const u = (id: string, size = "600x450") => `https://images.craigslist.org/${id}_${size}.jpg`;

Deno.test("two sizes of a photo share a key", () => {
  assertEquals(imageKey(u("00a_x1_0CI0t2")), imageKey(u("00a_x1_0CI0t2", "1200x900")));
});

Deno.test("a 600x450 row is superseded by its full-size row; a new photo is added; a full-size row is left alone", () => {
  const existing = [
    { id: "r1", image_url: u("00a_x1_0CI0t2"), is_primary: true },
    { id: "r2", image_url: u("00b_x2_0CI0t2", "1200x900") },
    { id: "r9", image_url: u("00z_gone_0CI0t2") },
  ];
  const gallery = [u("00a_x1_0CI0t2", "1200x900"), u("00b_x2_0CI0t2", "1200x900"), u("00c_x3_0CI0t2", "1200x900")];
  const plan = planCraigslistImages(existing, gallery);
  assertEquals(plan.insert.map((i) => [i.url, i.position, i.replaces, i.primary]), [
    [u("00a_x1_0CI0t2", "1200x900"), 0, ["r1"], true],
    [u("00c_x3_0CI0t2", "1200x900"), 2, [], false],
  ]);
  assertEquals(plan.supersede, [{ id: "r1", key: "00a_x1_0CI0t2" }]);
});

Deno.test("rows already marked duplicate are not planned against, and a second run plans nothing", () => {
  const existing = [
    { id: "r1", image_url: u("00a_x1_0CI0t2"), is_duplicate: true },
    { id: "n1", image_url: u("00a_x1_0CI0t2", "1200x900") },
  ];
  const plan = planCraigslistImages(existing, [u("00a_x1_0CI0t2", "1200x900")]);
  assertEquals(plan.insert, []);
  assertEquals(plan.supersede, []);
});
