// contributor-intake: token/404 handling, attestation and rate limits. Every dependency is a mock; nothing touches prod.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildDevice, type Deps, type FrameRow, handle, ipSha256, NOT_FOUND_BODY, pickFrames, RateLimiter, routeBucket, safeFileName, sanitizeHints, sha256Hex } from "./core.ts";

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
    frames: () => Promise.resolve([]),
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

Deno.test("a named shot becomes the file's label for the ladder; the document label still picks the bucket; junk is dropped", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const send = async (shot: string) => {
    const form = new FormData();
    form.set("token", GOOD); form.set("label", "build photo"); form.set("shot", shot); form.set("device", "{}");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "pad.jpg", { type: "image/jpeg" }));
    calls.length = 0;
    const out = await handle(new Request(`${base}/file`, { method: "POST", body: form }), deps({}, calls));
    assertEquals(out.status, 200);
    return calls.find(([n]) => n === "contributor_intake_file")![1].p_file as Record<string, unknown>;
  };
  const named = await send("Engine pad stamp");
  assertEquals([named.label, named.document_label, named.bucket], ["Engine pad stamp", "build photo", "vehicle-photos"]);
  const junk = await send("<script>alert(1)</script>");
  assertEquals([junk.label, junk.document_label], ["build photo", "build photo"]);
});

Deno.test("frames: the public gate holds; hero, emblem, primary, then newest; a storage path never leaves", () => {
  const row = (id: string, over: Partial<FrameRow> = {}): FrameRow => ({ id, image_url: `https://cdn.example/${id}.jpg`, created_at: `2026-10-${id.padStart(2, "0")}T00:00:00Z`, ...over });
  const rows: FrameRow[] = [
    row("1", { caption: "title paper", is_sensitive: true }),
    row("2", { is_document: true }),
    row("3", { vision_gate_status: "rejected_personal" }),
    row("4", { image_vehicle_match_status: "mismatch" }),
    row("5", { image_url: "vehicle-photos/users/x/IMG_1.jpg" }),
    row("14", { image_url: "https://cdn.example/IMG_5094.HEIC" }),
    row("15", { image_url: "https://cdn.example/IMG_5095.HEIC", medium_url: "https://cdn.example/IMG_5095-m.jpg", created_at: "2026-09-01T00:00:00Z" }),
    row("6", { caption: "hood bird decal" }),
    row("7", { caption: "front 3/4 at the shop" }),
    row("8", { is_primary: true }),
    row("9"), row("10"), row("11"), row("12"), row("13"),
  ];
  const picked = pickFrames(rows);
  assertEquals(picked.length, 6);
  assertEquals(picked[0], { image_id: "7", url: "https://cdn.example/7.jpg", role: "hero", caption: "front 3/4 at the shop" });
  assertEquals([picked[1].image_id, picked[1].role], ["6", "emblem"]);
  assertEquals(picked[2].image_id, "8");
  assertEquals(picked.slice(3).map((f) => f.image_id), ["13", "12", "11"]);
  assert(picked.every((f) => f.url.startsWith("https://")));
  assertEquals(pickFrames([]), []);
});

Deno.test("open returns the car's frames from the gated read, and an empty list when that read fails", async () => {
  const calls: string[] = [];
  const d = deps({
    rpc: () => Promise.resolve({ data: { invite_id: INVITE, vehicle: { id: "veh-1", year: 1973 } }, error: null }),
    frames: (id) => { calls.push(id); return Promise.resolve([{ id: "f1", image_url: "https://cdn.example/f1.jpg" }]); },
  });
  const out = await handle(new Request(`${base}?token=${GOOD}`), d);
  assertEquals(calls, ["veh-1"]);
  assertEquals((out.body as { frames: unknown[] }).frames, [{ image_id: "f1", url: "https://cdn.example/f1.jpg", role: "hero", caption: null }]);
  const broken = deps({
    rpc: () => Promise.resolve({ data: { invite_id: INVITE, vehicle: { id: "veh-1" } }, error: null }),
    frames: () => Promise.reject(new Error("db down")),
  });
  assertEquals(((await handle(new Request(`${base}?token=${GOOD}`), broken)).body as { frames: unknown[] }).frames, []);
});
