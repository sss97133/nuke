// deno test supabase/functions/_shared/vehicleImageWrite.test.ts
import { fetchHeldImageUrls, insertMissingVehicleImages, missingRows } from "./vehicleImageWrite.ts";

function equal(actual: unknown, expected: unknown, label = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Stub: a vehicle holding `held` urls, paged by .range()
function stub(held: string[], opts: { insertError?: boolean; readError?: boolean } = {}) {
  const inserted: any[][] = [];
  const db = {
    from(_t: string) {
      let range: [number, number] | null = null;
      const q: any = {};
      q.select = () => q; q.eq = () => q; q.order = () => q;
      q.range = (a: number, b: number) => { range = [a, b]; return q; };
      q.insert = (rows: any[]) => { inserted.push(rows); return q; };
      q.then = (ok: (v: unknown) => unknown) => {
        if (range) return ok(opts.readError ? { data: null, error: { message: "boom" } } : { data: held.slice(range[0], range[1] + 1).map((image_url) => ({ image_url })), error: null });
        return ok({ data: null, error: opts.insertError ? { message: "insert boom" } : null });
      };
      return q;
    },
  };
  return { db, inserted };
}

Deno.test("missingRows drops held urls and repeats within the batch", () => {
  const rows = [{ image_url: "a" }, { image_url: "b" }, { image_url: "a" }, { image_url: "c" }, { image_url: null }];
  equal(missingRows(rows, new Set(["b"])).map((r) => r.image_url), ["a", "c"]);
});

Deno.test("held urls are read past one page (a vehicle with more than 1000 rows)", async () => {
  const held = Array.from({ length: 2500 }, (_, i) => `u${i}`);
  const { db } = stub(held);
  const set = await fetchHeldImageUrls(db, "v");
  equal(set.size, 2500);
});

Deno.test("only missing urls are inserted; nothing is inserted when all are held", async () => {
  const { db, inserted } = stub(["a", "b"]);
  const r = await insertMissingVehicleImages(db, "v", [{ image_url: "a" }, { image_url: "c" }, { image_url: "c" }]);
  equal(inserted, [[{ image_url: "c" }]]); equal(r.skipped, 2); equal(r.error, null);
  const again = stub(["a"]);
  const r2 = await insertMissingVehicleImages(again.db, "v", [{ image_url: "a" }]);
  equal(again.inserted.length, 0); equal(r2.error, null);
});

Deno.test("read and insert failures come back as error, not a silent success", async () => {
  const bad = stub([], { readError: true });
  const r = await insertMissingVehicleImages(bad.db, "v", [{ image_url: "a" }]);
  equal(r.error?.message, "vehicle_images read failed: boom"); equal(bad.inserted.length, 0);
  const bad2 = stub([], { insertError: true });
  equal((await insertMissingVehicleImages(bad2.db, "v", [{ image_url: "a" }])).error?.message, "insert boom");
});
