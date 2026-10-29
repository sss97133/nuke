/**
 * contributor-intake core: everything the handler decides, with its dependencies passed in so tests run offline.
 *
 * Endpoints (one function, verify_jwt off, the service role inside):
 *   GET  /contributor-intake?token=…&sw=&sh=&dpr=&tz=   → contributor_intake_open(p_token, p_device)
 *   POST /contributor-intake/answer {token, question_key, answer, device}     → contributor_intake_answer(…)
 *   POST /contributor-intake/file   multipart {token, label, file, device}    → open, storage upload, contributor_intake_file(…)
 *
 * Device attestation (recorded on every open, answer and upload): user_agent, platform, model_hint, brands, screen
 * {w,h,dpr}, timezone, language, ip_sha256, opened_at. ip_sha256 = sha256(ip + ":" + daily salt), where the daily salt
 * is sha256(CONTRIBUTOR_IP_SALT + UTC date). The ip itself is never stored or returned. With no salt set, ip_sha256 is null.
 *
 * Unknown, expired and revoked tokens all answer 404 with the same body: no oracle on which.
 * Rate limits are an in-memory map per isolate (per token and per ip hash); a cold start resets them.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export const NOT_FOUND_BODY = { error: "not_found" } as const;
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;
export const MAX_FILE_BYTES = 52 * 1024 * 1024;

export const LABELS = ["build photo", "purchase or title paper", "receipt", "cam card / parts paperwork", "dyno or timeslip", "other"] as const;
export type Bucket = "vehicle-photos" | "ownership-documents" | "user-documents";
const HEIC = /^image\/hei[cf]$/;
const BUCKET_RULES: Record<Bucket, { max: number; mime: RegExp; sensitive: boolean }> = {
  "vehicle-photos": { max: 20 * 1024 * 1024, mime: /^image\/(jpeg|png|webp|gif)$/, sensitive: false },
  "ownership-documents": { max: 10 * 1024 * 1024, mime: /^(image\/(jpeg|png|webp)|application\/pdf)$/, sensitive: true },
  "user-documents": { max: 52 * 1024 * 1024, mime: /^(image\/[a-z0-9.+-]+|application\/pdf)$/, sensitive: true },
};

/**
 * Where a file goes, by the label the contributor picked. Only build photos are public; title and purchase papers
 * (they carry a home address) go to ownership-documents; everything else to user-documents. HEIC is refused by
 * vehicle-photos and ownership-documents, so a HEIC file goes to user-documents (private) whatever its label:
 * we never send a phone's HEIC to a public bucket and never convert server-side.
 */
export function routeBucket(label: string | null, mime: string): { bucket: Bucket; sensitive: boolean; max: number } | null {
  let bucket: Bucket = label === "build photo" ? "vehicle-photos" : label === "purchase or title paper" ? "ownership-documents" : "user-documents";
  if (HEIC.test(mime)) bucket = "user-documents";
  const rule = BUCKET_RULES[bucket];
  if (!rule.mime.test(mime)) return null;
  return { bucket, sensitive: rule.sensitive, max: rule.max };
}

/** https URL for the object: the public URL for vehicle-photos, the authenticated object URL for the private buckets. */
export function objectUrl(supabaseUrl: string, bucket: Bucket, path: string): string {
  const base = supabaseUrl.replace(/^http:\/\//, "https://").replace(/\/+$/, "");
  const enc = path.split("/").map(encodeURIComponent).join("/");
  return bucket === "vehicle-photos" ? `${base}/storage/v1/object/public/${bucket}/${enc}` : `${base}/storage/v1/object/authenticated/${bucket}/${enc}`;
}
export const MAX_ANSWER_CHARS = 20000;

export interface Deps {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  upload: (bucket: Bucket, path: string, bytes: Uint8Array, contentType: string) => Promise<{ error: { message?: string } | null }>;
  exif: (bytes: Uint8Array, mime: string) => Promise<JsonObject | null>;
  resolveUser: (jwt: string) => Promise<string | null>;
  env: (name: string) => string | undefined;
  now: () => Date;
  limiter: RateLimiter;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientIp(h: Headers): string | null {
  return h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** sha256(ip + daily salt). The secret never leaves the function; the date rotates the salt each UTC day. */
export async function ipSha256(ip: string | null, secret: string | undefined, now: Date): Promise<string | null> {
  if (!ip || !secret) return null;
  const salt = await sha256Hex(`${secret}:${now.toISOString().slice(0, 10)}`);
  return sha256Hex(`${ip}:${salt}`);
}

const unquote = (v: string | null) => (v ? v.replace(/^"|"$/g, "").trim() || null : null);
const finite = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
};
const short = (v: unknown, max = 64) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Client hints the page sends: screen and timezone. Anything else in the hint object is dropped. */
export function sanitizeHints(h: unknown): { screen: { w: number | null; h: number | null; dpr: number | null } | null; timezone: string | null } {
  const o = h && typeof h === "object" ? h as Record<string, unknown> : {};
  const s = o.screen && typeof o.screen === "object" ? o.screen as Record<string, unknown> : {};
  const screen = { w: finite(s.w), h: finite(s.h), dpr: finite(s.dpr) };
  return { screen: screen.w || screen.h || screen.dpr ? screen : null, timezone: short(o.timezone) };
}

export async function buildDevice(h: Headers, hints: unknown, secret: string | undefined, now: Date): Promise<JsonObject> {
  const { screen, timezone } = sanitizeHints(hints);
  return {
    user_agent: short(h.get("user-agent"), 512),
    platform: unquote(h.get("sec-ch-ua-platform")),
    model_hint: unquote(h.get("sec-ch-ua-model")),
    brands: short(h.get("sec-ch-ua"), 256),
    screen,
    timezone,
    language: short(h.get("accept-language")?.split(",")[0] ?? null, 32),
    ip_sha256: await ipSha256(clientIp(h), secret, now),
    opened_at: now.toISOString(),
  };
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  allow(key: string, nowMs: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (recent.length >= this.max) { this.hits.set(key, recent); return false; }
    recent.push(nowMs);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) for (const k of this.hits.keys()) { this.hits.delete(k); if (this.hits.size < 4000) break; }
    return true;
  }
}

/** Per token 60 / 10 min; per ip hash 240 / 10 min (a phone uploading a box of receipts stays under both). */
export function defaultLimiter(): RateLimiter { return new RateLimiter(60, 10 * 60 * 1000); }
const ipLimiter = new RateLimiter(240, 10 * 60 * 1000);

/** The database says a token does not resolve: null, {ok:false, error:'not_found'}, or a token error. One 404 for all. */
export function isTokenRefusal(data: unknown, error: { code?: string; message?: string } | null): boolean {
  if (error) return error.code === "P0002" || /token|not.?found|expired|revoked/i.test(error.message ?? "");
  if (data == null) return true;
  const o = typeof data === "object" ? data as Record<string, unknown> : null;
  return o?.ok === false && o.error === "not_found";
}

/** {ok:false, error:<other>}: the writer refused the content (unknown_question, invalid_sha256, …). */
const contentRefusal = (data: unknown): Out | null => {
  const o = data && typeof data === "object" ? data as Record<string, unknown> : null;
  return o?.ok === false ? { status: 400, body: { error: typeof o.error === "string" ? o.error : "refused" } } : null;
};

export const safeFileName = (name: string) =>
  (name.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(-120)) || "file";

type Out = { status: number; body: unknown };
const notFound = (): Out => ({ status: 404, body: NOT_FOUND_BODY });

export function route(url: URL): "open" | "answer" | "file" | null {
  const tail = url.pathname.replace(/\/+$/, "").split("/").pop();
  if (tail === "contributor-intake") return "open";
  if (tail === "answer" || tail === "file") return tail;
  return null;
}

async function recordedBy(req: Request, deps: Deps): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt || jwt.startsWith("sb_") || jwt.split(".").length !== 3) return null;
  return await deps.resolveUser(jwt);
}

export async function handle(req: Request, deps: Deps): Promise<Out> {
  const url = new URL(req.url);
  const kind = route(url);
  const now = deps.now();
  if (!kind) return { status: 404, body: { error: "unknown_route" } };
  if ((kind === "open") !== (req.method === "GET")) return { status: 405, body: { error: "method_not_allowed" } };

  let token = "", form: FormData | null = null, body: Record<string, unknown> = {};
  if (kind === "open") token = url.searchParams.get("token") ?? "";
  else if (kind === "answer") {
    try { body = await req.json(); } catch { return { status: 400, body: { error: "bad_json" } }; }
    token = typeof body.token === "string" ? body.token : "";
  } else {
    try { form = await req.formData(); } catch { return { status: 400, body: { error: "bad_form" } }; }
    token = String(form.get("token") ?? "");
  }
  if (!TOKEN_RE.test(token)) return notFound();

  const secret = deps.env("CONTRIBUTOR_IP_SALT");
  const ipHash = await ipSha256(clientIp(req.headers), secret, now);
  const tokenKey = await sha256Hex(token);
  if (!deps.limiter.allow(`t:${tokenKey}`, now.getTime()) || (ipHash && !ipLimiter.allow(`i:${ipHash}`, now.getTime()))) {
    return { status: 429, body: { error: "rate_limited", retry_after_seconds: 600 } };
  }

  let hints: unknown = body.device;
  if (kind === "open") hints = { screen: { w: url.searchParams.get("sw"), h: url.searchParams.get("sh"), dpr: url.searchParams.get("dpr") }, timezone: url.searchParams.get("tz") };
  if (form) { try { hints = JSON.parse(String(form.get("device") ?? "{}")); } catch { hints = {}; } }
  const device = await buildDevice(req.headers, hints, secret, now);
  const recorder = await recordedBy(req, deps);

  if (kind === "open") {
    const { data, error } = await deps.rpc("contributor_intake_open", { p_token: token, p_device: device });
    if (isTokenRefusal(data, error)) return notFound();
    if (error) return { status: 500, body: { error: "open_failed" } };
    return { status: 200, body: { ...(data as JsonObject), recorded_by_owner: recorder != null } };
  }

  if (kind === "answer") {
    const key = typeof body.question_key === "string" ? body.question_key.trim() : "";
    const answer = typeof body.answer === "string" ? body.answer : "";
    if (!key || key.length > 128) return { status: 400, body: { error: "question_key_required" } };
    if (answer.length > MAX_ANSWER_CHARS) return { status: 413, body: { error: "answer_too_long" } };
    const { data, error } = await deps.rpc("contributor_intake_answer", {
      p_token: token, p_question_key: key, p_answer: answer, p_device: device, p_recorded_by: recorder,
    });
    if (isTokenRefusal(data, error)) return notFound();
    if (error) return { status: 500, body: { error: "not_saved" } };
    return contentRefusal(data) ?? { status: 200, body: data };
  }

  const file = form!.get("file");
  if (!(file instanceof File)) return { status: 400, body: { error: "file_required" } };
  const lower = (file.name || "").toLowerCase();
  const given = file.type && file.type !== "application/octet-stream" ? file.type : "";
  const mime = (given || (lower.endsWith(".pdf") ? "application/pdf" : /\.hei[cf]$/.test(lower) ? "image/heic" : "application/octet-stream")).toLowerCase();
  const rawLabel = short(form!.get("label"), 64);
  const label = rawLabel && (LABELS as readonly string[]).includes(rawLabel) ? rawLabel : "other";
  const dest = routeBucket(label, mime);
  if (!dest) return { status: 415, body: { error: "images_or_pdf_only" } };
  if (file.size === 0 || file.size > dest.max) return { status: 413, body: { error: "file_size", max_bytes: dest.max } };

  // Validate the token (and record this upload's visit) before anything reaches storage.
  const opened = await deps.rpc("contributor_intake_open", { p_token: token, p_device: { ...device, purpose: "file" } });
  if (isTokenRefusal(opened.data, opened.error)) return notFound();
  if (opened.error) return { status: 500, body: { error: "open_failed" } };
  const inv = (opened.data as JsonObject).invite;
  const inviteId = inv && typeof inv === "object" && !Array.isArray(inv) && typeof inv.id === "string" ? inv.id : null;
  if (!inviteId) return { status: 500, body: { error: "invite_unresolved" } };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha = await sha256Hex(bytes);
  const name = safeFileName(file.name || "file");
  const path = `contributors/${inviteId}/${sha}/${name}`;
  const up = await deps.upload(dest.bucket, path, bytes, mime);
  if (up.error && !/exists|duplicate/i.test(up.error.message ?? "")) return { status: 502, body: { error: "storage_failed" } };
  let exif: JsonObject | null = null;
  try { exif = /^image\//.test(mime) ? await deps.exif(bytes, mime) : null; } catch { exif = null; }
  const { data, error } = await deps.rpc("contributor_intake_file", {
    p_token: token,
    p_file: {
      bucket: dest.bucket, is_sensitive: dest.sensitive, storage_path: path,
      image_url: objectUrl(deps.env("SUPABASE_URL") ?? "", dest.bucket, path),
      file_name: name, mime_type: mime, size_bytes: bytes.length, sha256: sha, exif, device, label,
      ...(recorder ? { recorded_by: recorder } : {}),
    },
  });
  if (isTokenRefusal(data, error)) return notFound();
  if (error) return { status: 500, body: { error: "not_saved" } };
  return contentRefusal(data) ?? { status: 200, body: data };
}
