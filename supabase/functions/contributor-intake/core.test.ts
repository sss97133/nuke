// contributor-intake: token/404 handling, attestation and rate limits. Every dependency is a mock; nothing touches prod.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildDevice, type Deps, handle, ipSha256, NOT_FOUND_BODY, RateLimiter, routeBucket, safeFileName, sanitizeHints, sha256Hex } from "./core.ts";

const GOOD = "a".repeat(43);
const NOW = new Date("2026-10-29T18:00:00Z");
const INVITE = "11111111-0000-4000-a000-000000000001";

function deps(over: Partial<Deps> = {}, calls: Array<[string, Record<string, unknown>]> = []): Deps {
  return {
    rpc: (name, args) => {
      calls.push([name, args]);
      if (args.p_token !== GOOD) return Promise.resolve({ data: null, error: { code: "P0002", message: "invite token not found" } });
      if (name === "contributor_intake_open") return Promise.resolve({ data: { invite: { id: INVITE, expires_at: "2026-11-28T00:00:00Z" }, vehicle: { year: 1973 } }, error: null });
      if (name === "contributor_intake_answer") return Promise.resolve({ data: { observation_id: "obs-1" }, error: null });
      return Promise.resolve({ data: { image_id: "img-1", duplicate: false }, error: null });
    },
    upload: () => Promise.resolve({ error: null }),
    exif: () => Promise.resolve({ Make: "Apple", Model: "iPhone" }),
    resolveUser: () => Promise.resolve(null),
    env: (n) => (n === "CONTRIBUTOR_IP_SALT" ? "test-salt" : n === "SUPABASE_URL" ? "https://proj.supabase.co" : undefined),
    now: () => NOW,
    limiter: new RateLimiter(60, 600_000),
    ...over,
  };
}
const base = "https://x.supabase.co/functions/v1/contributor-intake";
const ua = { "user-agent": "Mozilla/5.0 (iPhone)", "sec-ch-ua-platform": '"iOS"', "accept-language": "en-US,en;q=0.9", "cf-connecting-ip": "203.0.113.9" };

Deno.test("unknown, expired, revoked and malformed tokens all answer the same 404", async () => {
  for (const message of ["invite token not found", "invite expired", "invite revoked"]) {
    const d = deps({ rpc: () => Promise.resolve({ data: null, error: { message } }) });
    const out = await handle(new Request(`${base}?token=${GOOD}`), d);
    assertEquals(out, { status: 404, body: NOT_FOUND_BODY });
  }
  assertEquals(await handle(new Request(`${base}?token=short`), deps()), { status: 404, body: NOT_FOUND_BODY });
  assertEquals(await handle(new Request(`${base}?token=${"b".repeat(43)}`), deps()), { status: 404, body: NOT_FOUND_BODY });
  const ans = await handle(new Request(`${base}/answer`, { method: "POST", body: JSON.stringify({ token: "b".repeat(43), question_key: "q1", answer: "x" }) }), deps());
  assertEquals(ans, { status: 404, body: NOT_FOUND_BODY });
});

Deno.test("open passes the device built from headers and query hints, never the ip", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const out = await handle(new Request(`${base}?token=${GOOD}&sw=390&sh=844&dpr=3&tz=America/Los_Angeles`, { headers: ua }), deps({}, calls));
  assertEquals(out.status, 200);
  const dev = calls[0][1].p_device as Record<string, unknown>;
  assertEquals(dev.platform, "iOS");
  assertEquals(dev.language, "en-US");
  assertEquals(dev.screen, { w: 390, h: 844, dpr: 3 });
  assertEquals(dev.timezone, "America/Los_Angeles");
  assertEquals(dev.ip_sha256, await ipSha256("203.0.113.9", "test-salt", NOW));
  assert(!JSON.stringify(calls).includes("203.0.113.9"));
});

Deno.test("answer passes p_recorded_by only when a user JWT resolves", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const req = (auth?: string) => new Request(`${base}/answer`, { method: "POST", headers: auth ? { authorization: auth } : {}, body: JSON.stringify({ token: GOOD, question_key: "q1", answer: "1970 455", device: { timezone: "UTC" } }) });
  await handle(req(), deps({}, calls));
  assertEquals(calls[0][1].p_recorded_by, null);
  await handle(req("Bearer aaa.bbb.ccc"), deps({ resolveUser: () => Promise.resolve("owner-1") }, calls));
  assertEquals(calls[1][1].p_recorded_by, "owner-1");
  assertEquals(calls[1][0], "contributor_intake_answer");
});

Deno.test("file: validates the token before storage, hashes, and uses the contributors path", async () => {
  const uploads: string[] = [];
  const calls: Array<[string, Record<string, unknown>]> = [];
  const form = (token: string) => { const f = new FormData(); f.set("token", token); f.set("label", "build photo"); f.set("file", new File([new Uint8Array([1, 2, 3])], "Cam card.jpg", { type: "image/jpeg" })); return f; };
  const bad = await handle(new Request(`${base}/file`, { method: "POST", body: form("b".repeat(43)) }), deps({ upload: (b, p) => { uploads.push(`${b}:${p}`); return Promise.resolve({ error: null }); } }));
  assertEquals(bad.status, 404);
  assertEquals(uploads.length, 0);
  const ok = await handle(new Request(`${base}/file`, { method: "POST", body: form(GOOD) }), deps({ upload: (b, p) => { uploads.push(`${b}:${p}`); return Promise.resolve({ error: null }); } }, calls));
  assertEquals(ok.status, 200);
  const sha = await sha256Hex(new Uint8Array([1, 2, 3]));
  assertEquals(uploads[0], `vehicle-photos:contributors/${INVITE}/${sha}/Cam_card.jpg`);
  const file = calls.find(([n]) => n === "contributor_intake_file")![1].p_file as Record<string, unknown>;
  assertEquals(file.sha256, sha);
  assertEquals(file.storage_path, `contributors/${INVITE}/${sha}/Cam_card.jpg`);
  assertEquals(file.bucket, "vehicle-photos");
  assertEquals(file.is_sensitive, false);
  assertEquals(file.image_url, `https://proj.supabase.co/storage/v1/object/public/vehicle-photos/contributors/${INVITE}/${sha}/Cam_card.jpg`);
  assert(!("recorded_by" in file));
  assertEquals((file.exif as Record<string, unknown>).Make, "Apple");
});

Deno.test("rate limit per token answers 429 after the window fills", async () => {
  const d = deps({ limiter: new RateLimiter(2, 600_000) });
  await handle(new Request(`${base}?token=${GOOD}`), d);
  await handle(new Request(`${base}?token=${GOOD}`), d);
  assertEquals((await handle(new Request(`${base}?token=${GOOD}`), d)).status, 429);
});

Deno.test("hints and names are sanitized", async () => {
  assertEquals(sanitizeHints({ screen: { w: "x", h: -1 }, timezone: 5 }), { screen: null, timezone: null });
  assertEquals(safeFileName("../../etc/passwd"), "etc_passwd");
  assertEquals(await ipSha256("1.2.3.4", undefined, NOW), null);
  const dev = await buildDevice(new Headers(), {}, "s", NOW);
  assertEquals(dev.opened_at, NOW.toISOString());
});

Deno.test("documents route to private buckets by label; HEIC never goes public", () => {
  assertEquals(routeBucket("build photo", "image/jpeg")?.bucket, "vehicle-photos");
  assertEquals(routeBucket("purchase or title paper", "image/jpeg"), { bucket: "ownership-documents", sensitive: true, max: 10 * 1024 * 1024 });
  for (const l of ["receipt", "cam card / parts paperwork", "dyno or timeslip", "other"]) assertEquals(routeBucket(l, "application/pdf")?.bucket, "user-documents");
  assertEquals(routeBucket("build photo", "image/heic")?.bucket, "user-documents");
  assertEquals(routeBucket("purchase or title paper", "image/heic")?.sensitive, true);
  assertEquals(routeBucket("build photo", "application/pdf"), null);
});

Deno.test("a title photo lands private with sensitive, image_url and recorded_by for a signed-in owner", async () => {
  const uploads: string[] = [];
  const calls: Array<[string, Record<string, unknown>]> = [];
  const f = new FormData(); f.set("token", GOOD); f.set("label", "purchase or title paper");
  f.set("file", new File([new Uint8Array([9])], "title.heic", { type: "" }));
  const out = await handle(new Request(`${base}/file`, { method: "POST", headers: { authorization: "Bearer aaa.bbb.ccc" }, body: f }),
    deps({ upload: (b, p) => { uploads.push(`${b}:${p}`); return Promise.resolve({ error: null }); }, resolveUser: () => Promise.resolve("owner-1") }, calls));
  assertEquals(out.status, 200);
  assert(uploads[0].startsWith("user-documents:contributors/"));
  const file = calls.find(([n]) => n === "contributor_intake_file")![1].p_file as Record<string, unknown>;
  assertEquals([file.bucket, file.is_sensitive, file.recorded_by, file.mime_type], ["user-documents", true, "owner-1", "image/heic"]);
  assert(String(file.image_url).startsWith("https://proj.supabase.co/storage/v1/object/authenticated/user-documents/"));
});

Deno.test("a content refusal is a 400, not the token 404", async () => {
  const d = deps({ rpc: () => Promise.resolve({ data: { ok: false, error: "unknown_question" }, error: null }) });
  const out = await handle(new Request(`${base}/answer`, { method: "POST", body: JSON.stringify({ token: GOOD, question_key: "zz", answer: "x" }) }), d);
  assertEquals(out, { status: 400, body: { error: "unknown_question" } });
  const nf = deps({ rpc: () => Promise.resolve({ data: { ok: false, error: "not_found" }, error: null }) });
  assertEquals((await handle(new Request(`${base}?token=${GOOD}`), nf)).status, 404);
});
