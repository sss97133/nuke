// Verbatim excerpt around a VIN in a listing page, so a vehicles.vin written from a snapshot carries its citation.

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Page text with tags, scripts and styles removed and whitespace collapsed. */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The text around the first case-insensitive occurrence of `vin` in the page's visible text, at most `max` characters,
 * or null when the VIN is not in the visible text (e.g. it came only from a JSON blob). Never invents text.
 */
export function vinExcerpt(html: string | null | undefined, vin: string, max = 200): string | null {
  if (!html || !vin || vin.trim().length < 5) return null;
  const text = pageText(html);
  const at = text.toUpperCase().indexOf(vin.trim().toUpperCase());
  if (at < 0) return null;
  const pad = Math.max(0, Math.floor((max - vin.length) / 2));
  const start = Math.max(0, at - pad);
  const end = Math.min(text.length, at + vin.length + pad);
  return text.slice(start, end).trim();
}
