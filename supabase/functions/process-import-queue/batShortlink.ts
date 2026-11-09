/**
 * BaT posts are also addressable as `https://bringatrailer.com/?post_type=bat-listing&p=<post id>` (and `?p=<id>`).
 * extract-bat-core only accepts `/listing/<slug>/` URLs, so a queued shortlink could never land; the Nov 5 2026
 * evaluate_listing coverage miss (`?post_type=bat-listing&p=126086136`) sat pending for that reason.
 *
 * resolveBatQueueUrl follows the shortlink once and returns the lot URL, or says the post is not public
 * (404/410: unpublished or removed — terminal, retrying cannot help).
 */
export type BatQueueUrl =
  | { kind: "lot"; url: string; resolved_from: string | null }
  | { kind: "dead"; http_status: number; resolved_from: string }
  | { kind: "unresolved"; error: string; resolved_from: string };

const LOT_PATH = /^\/listing\/([a-z0-9][a-z0-9-]*)\/?$/i;

export function isBatHost(u: URL): boolean {
  return /(^|\.)bringatrailer\.com$/i.test(u.hostname);
}

/** null = not a BaT URL (route as before). */
export async function resolveBatQueueUrl(
  raw: string,
  fetchFn: typeof fetch = fetch,
): Promise<BatQueueUrl | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!isBatHost(u)) return null;
  const lot = u.pathname.match(LOT_PATH);
  if (lot) {
    return {
      kind: "lot",
      url: `https://bringatrailer.com/listing/${lot[1].toLowerCase()}/`,
      resolved_from: null,
    };
  }
  const postId = u.searchParams.get("p");
  if (!postId || !/^\d{3,}$/.test(postId)) {
    return {
      kind: "unresolved",
      error: "BaT URL is neither a /listing/ lot nor a ?p=<post id> shortlink",
      resolved_from: raw,
    };
  }
  try {
    const res = await fetchFn(`https://bringatrailer.com/?p=${postId}`, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NukeQueue/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });
    // Body is not needed; release it.
    await res.body?.cancel().catch(() => {});
    if (res.status === 404 || res.status === 410) {
      return { kind: "dead", http_status: res.status, resolved_from: raw };
    }
    let finalPath = "";
    try {
      finalPath = new URL(res.url).pathname;
    } catch { /* keep empty */ }
    const m = finalPath.match(LOT_PATH);
    if (res.ok && m) {
      return {
        kind: "lot",
        url: `https://bringatrailer.com/listing/${m[1].toLowerCase()}/`,
        resolved_from: raw,
      };
    }
    return {
      kind: "unresolved",
      error: `BaT shortlink answered HTTP ${res.status} at ${finalPath || "?"}`,
      resolved_from: raw,
    };
  } catch (e) {
    return {
      kind: "unresolved",
      error: `BaT shortlink fetch failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
      resolved_from: raw,
    };
  }
}
