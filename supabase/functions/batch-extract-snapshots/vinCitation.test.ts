import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pageText, vinExcerpt } from "./vinCitation.ts";

Deno.test("vinExcerpt returns the visible text around the VIN", () => {
  const html = `<html><script>var vin="X";</script><ul><li>Chassis: <a href="#">WP0AB0916KS120001</a></li><li>3.2L flat-six</li></ul></html>`;
  assertEquals(vinExcerpt(html, "WP0AB0916KS120001"), "Chassis: WP0AB0916KS120001 3.2L flat-six");
});

Deno.test("vinExcerpt is case-insensitive and bounded", () => {
  const html = `<p>${"a ".repeat(300)}vin wp0ab0916ks120001 ${"b ".repeat(300)}</p>`;
  const ex = vinExcerpt(html, "WP0AB0916KS120001", 60)!;
  assertEquals(ex.includes("wp0ab0916ks120001"), true);
  assertEquals(ex.length <= 60, true);
});

Deno.test("vinExcerpt returns null when the VIN is not visible text", () => {
  assertEquals(vinExcerpt(`<script>{"vin":"WP0AB0916KS120001"}</script><p>no vin here</p>`, "WP0AB0916KS120001"), null);
  assertEquals(vinExcerpt(null, "WP0AB0916KS120001"), null);
  assertEquals(vinExcerpt("<p>x</p>", ""), null);
});

Deno.test("pageText decodes basic entities", () => {
  assertEquals(pageText("<b>A&amp;B</b>&nbsp;C"), "A&B C");
});
