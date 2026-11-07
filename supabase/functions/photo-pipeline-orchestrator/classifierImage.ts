// Resilient classifier image fetch (v99 downscale/renderer fallback). Split out of the provider section so classifier.ts need not import the provider.
import { CLASSIFIER_BUDGET, ClassifierError, readBounded } from "./classifierBase.ts";

/** HEIC/HEIF is not accepted by OpenAI. Supabase Storage's image renderer returns a JPEG for any object in a public bucket. */
export function jpegRenderUrl(imageUrl: string, width = 1600, quality = 85): string | null {
  try {
    const u = new URL(imageUrl);
    if (!u.pathname.includes("/storage/v1/object/public/")) return null;
    u.pathname = u.pathname.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
    u.search = `?width=${width}&quality=${quality}`;
    return u.href;
  } catch { return null; }
}

const RAW_FETCH_MAX = 12 * 1024 * 1024;   // refuse to decode anything bigger (isolate memory)

const MAX_SIDE = 1568;

export interface FetchedImage { bytes: Uint8Array; mimeType: string; resized?: string }

async function resizeToJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  const mod = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
  const img = await mod.Image.decode(bytes);
  const longest = Math.max(img.width, img.height);
  const out = longest > MAX_SIDE ? img.resize(Math.round(img.width * MAX_SIDE / longest), Math.round(img.height * MAX_SIDE / longest)) : img;
  return await out.encodeJPEG(80);
}

/** Fetch an image small enough to send (<= CLASSIFIER_BUDGET.image_bytes). Supabase-storage originals go through the image
 *  renderer (1600px, then 1024px/q70 if still too big); anything else is downscaled in-function. Throws ClassifierError(code, status). */
export async function fetchClassifierImage(imageUrl: string, fetchImpl: typeof globalThis.fetch, acceptHeic: boolean): Promise<FetchedImage> {
  const accepted = ["image/jpeg", "image/png", "image/webp", ...(acceptHeic ? ["image/heic", "image/heif"] : [])];
  const limit = CLASSIFIER_BUDGET.image_bytes;
  type Got = { status: number } | { tooLarge: true } | { bytes: Uint8Array; mimeType: string };
  const get = async (url: string, cap: number): Promise<Got> => {
    const r = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(CLASSIFIER_BUDGET.image_ms) });
    if (!r.ok) { await r.body?.cancel(); return { status: r.status }; }
    const mime = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!accepted.includes(mime)) { await r.body?.cancel(); throw new ClassifierError("image_mime_invalid"); }
    try { return { bytes: await readBounded(r, cap), mimeType: mime }; }
    catch (e) { if (e instanceof ClassifierError && e.code === "payload_too_large") return { tooLarge: true }; throw e; }
  };
  let renderStatus: number | null = null;
  for (const [w, q] of [[1600, 85], [1024, 70]] as const) {
    const rurl = jpegRenderUrl(imageUrl, w, q);
    if (!rurl) break;
    const r = await get(rurl, limit);
    if ("bytes" in r) return { bytes: r.bytes, mimeType: r.mimeType, resized: w === 1600 ? "render_1600" : "render_1024" };
    if ("status" in r) { renderStatus = r.status; break; }       // renderer refused: fall through to the original
  }
  if (renderStatus !== null && (renderStatus === 429 || renderStatus >= 500)) throw new ClassifierError("image_http_error", renderStatus);
  const raw = await get(imageUrl, RAW_FETCH_MAX);
  if ("status" in raw) throw new ClassifierError("image_http_error", raw.status);
  if ("tooLarge" in raw) throw new ClassifierError("payload_too_large");
  if (raw.bytes.length <= limit) return { bytes: raw.bytes, mimeType: raw.mimeType };
  if (!["image/jpeg", "image/png"].includes(raw.mimeType)) throw new ClassifierError("payload_too_large");
  try {
    const out = await resizeToJpeg(raw.bytes);
    if (out.length > limit) throw new ClassifierError("payload_too_large");
    return { bytes: out, mimeType: "image/jpeg", resized: `inline_${MAX_SIDE}` };
  } catch (e) { if (e instanceof ClassifierError) throw e; throw new ClassifierError("payload_too_large"); }
}
