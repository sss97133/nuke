// Run: deno test supabase/functions/ingest/repostMatch.test.ts
// A re-posted Craigslist car is the vehicle it already is: the decision (photo ids shared, identity agrees, no VIN conflict,
// never an owned or merged vehicle) and the lookup around it (bounded, never throws).
import { craigslistPhotoKeys, decideRepost, findCraigslistRepost, MIN_RATIO, MIN_SHARED, type RepostCandidate } from "./repostMatch.ts";

function equal(actual: unknown, expected: unknown, note = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${note} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const url = (id: string, size = "1200x900") => `https://images.craigslist.org/${id}_${size}.jpg`;
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, "0")}_abc_0gw0co`);
const urls = (keys: string[], size?: string) => keys.map((k) => url(k, size));
const keySet = (keys: string[]) => new Set(keys);

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const photos = ids("p", 24);

const post = { year: 1978, make: "Buick", model: "Electra LTD", vin: null, imageUrls: urls(photos) };
const cand = (over: Partial<RepostCandidate> = {}): RepostCandidate => ({
  id: A, year: 1978, make: "Buick", model: "Electra LTD", vin: null, user_id: null, status: "discovered", deleted_at: null,
  created_at: "2026-10-18T05:46:28Z", photoKeys: keySet(photos), ...over,
});

Deno.test("photo keys: size suffix dropped, only images.craigslist.org files count", () => {
  equal([...craigslistPhotoKeys([url("x1_abc", "600x450"), url("x1_abc", "1200x900"), url("x2_abc"), "https://example.com/a.jpg", "https://www.craigslist.org/view/d/car/tok"])].sort(), ["x1_abc", "x2_abc"]);
  equal(craigslistPhotoKeys(null).size, 0);
  equal(craigslistPhotoKeys(undefined).size, 0);
});

Deno.test("the same photos at another size are the same photos", () => {
  const m = decideRepost({ ...post, imageUrls: urls(photos, "600x450") }, [cand()]);
  assert(m && m.vehicleId === A && m.shared === 24, "600x450 copies match the 1200x900 rows");
});

Deno.test("a re-post sharing the photo set matches the vehicle", () => {
  const m = decideRepost(post, [cand()]);
  equal(m && [m.vehicleId, m.shared, m.ratio, m.postPhotos, m.candidatePhotos], [A, 24, 1, 24, 24]);
});

Deno.test("fewer than the minimum shared photos is no match", () => {
  const few = ids("q", MIN_SHARED - 1);
  equal(decideRepost({ ...post, imageUrls: urls([...few, ...ids("z", 20)]) }, [cand({ photoKeys: keySet([...few, ...ids("y", 20)]) })]), null);
  equal(decideRepost({ ...post, imageUrls: urls(ids("p", MIN_SHARED - 1)) }, [cand()]), null, "a post with too few photos never matches");
});

Deno.test("the shared photos must be a real part of the smaller set", () => {
  // 6 shared of a 20-photo candidate = 0.3 < MIN_RATIO
  const shared = ids("s", 6);
  equal(decideRepost({ ...post, imageUrls: urls([...shared, ...ids("n", 18)]) }, [cand({ photoKeys: keySet([...shared, ...ids("m", 14)]) })]), null);
  // 6 shared of a 10-photo candidate = 0.6 >= MIN_RATIO: a thin re-post of a short gallery matches
  const m = decideRepost({ ...post, imageUrls: urls([...shared, ...ids("n", 18)]) }, [cand({ photoKeys: keySet([...shared, ...ids("m", 4)]) })]);
  assert(m && m.ratio >= MIN_RATIO && m.shared === 6, "6 of 10 matches");
});

Deno.test("year, make and model must agree", () => {
  equal(decideRepost(post, [cand({ year: 1979 })]), null, "year");
  equal(decideRepost(post, [cand({ make: "Cadillac" })]), null, "make");
  equal(decideRepost(post, [cand({ model: "Park Avenue" })]), null, "model");
  assert(decideRepost(post, [cand({ model: "Electra 225" })]), "the first word of the model is the identity (Electra LTD vs Electra 225)");
  assert(decideRepost({ ...post, model: null }, [cand()]), "a post that names no model matches on year and make");
  equal(decideRepost({ ...post, year: null }, [cand()]), null, "a post with no year never matches");
});

Deno.test("two different VINs are two cars; the same VIN, or one side with none, is not a conflict", () => {
  equal(decideRepost({ ...post, vin: "1G4AN69Y1JH123456" }, [cand({ vin: "1G4AN69Y1JH654321" })]), null);
  assert(decideRepost({ ...post, vin: "1g4an69y1jh123456" }, [cand({ vin: "1G4AN69Y1JH123456" })]), "same VIN, any case");
  assert(decideRepost({ ...post, vin: "1G4AN69Y1JH123456" }, [cand({ vin: null })]), "candidate has none");
  assert(decideRepost(post, [cand({ vin: "1G4AN69Y1JH123456" })]), "post has none");
});

Deno.test("an owned, merged or deleted vehicle is never a target", () => {
  equal(decideRepost(post, [cand({ user_id: "0b9f107a-d124-49de-9ded-94698f63c1c4" })]), null, "owned");
  equal(decideRepost(post, [cand({ status: "merged" })]), null, "merged");
  equal(decideRepost(post, [cand({ deleted_at: "2026-10-19T00:00:00Z" })]), null, "deleted");
});

Deno.test("among qualifying vehicles the most shared photos wins, ties go to the oldest", () => {
  const more = decideRepost(post, [cand({ id: A, photoKeys: keySet(photos.slice(0, 10)) }), cand({ id: B, photoKeys: keySet(photos.slice(0, 20)) })]);
  equal(more?.vehicleId, B, "most shared");
  const tie = decideRepost(post, [cand({ id: B, created_at: "2026-10-19T00:00:00Z" }), cand({ id: A, created_at: "2026-10-18T00:00:00Z" })]);
  equal(tie?.vehicleId, A, "oldest on a tie");
});

// ---- the lookup -----------------------------------------------------------------------------------------------------

function fakeClient(vehicles: unknown[], images: unknown[], opts: { failImages?: boolean; throws?: boolean } = {}) {
  const log: Array<[string, string, unknown[]]> = [];
  const client = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: (...a: unknown[]) => { log.push([table, "eq", a]); return chain; },
        is: (...a: unknown[]) => { log.push([table, "is", a]); return chain; },
        neq: (...a: unknown[]) => { log.push([table, "neq", a]); return chain; },
        in: (...a: unknown[]) => { log.push([table, "in", a]); return chain; },
        like: (...a: unknown[]) => { log.push([table, "like", a]); return chain; },
        order: () => chain,
        limit: (n: number) => {
          log.push([table, "limit", [n]]);
          if (opts.throws) throw new Error("boom");
          if (table === "vehicles") return Promise.resolve({ data: vehicles, error: null });
          return Promise.resolve(opts.failImages ? { data: null, error: { message: "timeout" } } : { data: images, error: null });
        },
      };
      return chain;
    },
  };
  return { client, log };
}

Deno.test("lookup: reads same-year-make-model live unowned vehicles, then their Craigslist photo rows, and matches", async () => {
  const { client, log } = fakeClient(
    [{ id: A, year: 1978, make: "Buick", model: "Electra LTD", vin: null, user_id: null, status: "discovered", deleted_at: null, created_at: "2026-10-18T05:46:28Z" }],
    photos.map((k) => ({ vehicle_id: A, image_url: url(k, "600x450") })),
  );
  const m = await findCraigslistRepost(client, post);
  equal(m && [m.vehicleId, m.shared], [A, 24]);
  const asked = log.map(([t, op, a]) => `${t}.${op}(${a.join(",")})`);
  for (const want of ["vehicles.eq(year,1978)", "vehicles.eq(make,Buick)", "vehicles.eq(model,Electra LTD)", "vehicles.is(deleted_at,)", "vehicles.is(user_id,)", "vehicles.neq(status,merged)", "vehicles.limit(40)", "vehicle_images.like(image_url,https://images.craigslist.org/%)", "vehicle_images.limit(4000)"]) {
    assert(asked.includes(want), `the lookup asked for ${want}; asked ${asked.join(" | ")}`);
  }
});

Deno.test("lookup: a post with too few photos or no year reads nothing", async () => {
  const { client, log } = fakeClient([], []);
  equal(await findCraigslistRepost(client, { ...post, imageUrls: urls(ids("p", 3)) }), null);
  equal(await findCraigslistRepost(client, { ...post, year: null }), null);
  equal(log.length, 0, "no database read");
});

Deno.test("lookup: a failed or throwing read means no match, never an error", async () => {
  const v = [{ id: A, year: 1978, make: "Buick", model: "Electra LTD", vin: null, user_id: null, status: "discovered", deleted_at: null, created_at: "x" }];
  equal(await findCraigslistRepost(fakeClient(v, [], { failImages: true }).client, post), null, "image read failed");
  equal(await findCraigslistRepost(fakeClient(v, [], { throws: true }).client, post), null, "a thrown error");
  equal(await findCraigslistRepost(fakeClient([], []).client, post), null, "no candidates");
});
