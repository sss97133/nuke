import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isGarbageHtml, pickCachedSnapshot } from "./archiveFetch.ts";

Deno.test("a firecrawl snapshot is a cache hit for a direct read, and the reverse", () => {
  const fc = { id: "a", fetch_method: "firecrawl" };
  const direct = { id: "b", fetch_method: "direct" };
  assertEquals(pickCachedSnapshot([fc], "direct")?.id, "a");
  assertEquals(pickCachedSnapshot([direct], "firecrawl")?.id, "b");
  assertEquals(pickCachedSnapshot([fc, direct], "direct")?.id, "b");
  assertEquals(pickCachedSnapshot([], "direct"), null);
  assertEquals(pickCachedSnapshot(null, "direct"), null);
});

Deno.test("a large lot page that carries a login modal is not garbage", () => {
  const page = `<html><head><title>2017 Porsche 911 for sale by auction | Collecting Cars</title></head><body>${"<p>lot content</p>".repeat(20000)}
    <div class="modal">Sign in to bid. Forgot your password? Create an account or register.</div></body></html>`;
  assert(page.length > 150_000);
  assertEquals(isGarbageHtml(page, "collectingcars"), false);
});

Deno.test("a small login wall is still garbage", () => {
  const wall = `<html><head><title>Log in</title></head><body><form id="login-form"><input type="password"></form></body></html>`;
  assertEquals(isGarbageHtml(wall, "collectingcars"), true);
  const bodyOnly = `<html><body>Sign in to continue. Forgot your password? Create an account.<input type="password"></body></html>`;
  assertEquals(isGarbageHtml(bodyOnly, "x"), true);
});
