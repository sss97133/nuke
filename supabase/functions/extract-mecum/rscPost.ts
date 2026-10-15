/**
 * Mecum moved lot pages from the Next.js pages router (a __NEXT_DATA__ script) to the app router, which streams the
 * same lot object inside `self.__next_f.push([1,"..."])` flight chunks. Measured 2026-10-15 on /lots/1119537/: no
 * __NEXT_DATA__ element, and the chunks hold `"post":{"__typename":"Lot",...}` with the fields parseNextData reads
 * (title, vinSerial, hammerPrice, odometer, images, makes/models/lotYears/saleResults/runDates edges).
 */

const PUSH_RE = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;

/** The concatenated flight text of a lot page, or "" when the page has none. */
export function flightText(html: string): string {
  let out = "";
  for (const m of html.matchAll(PUSH_RE)) {
    try { out += JSON.parse(m[1]); } catch { /* a malformed chunk is skipped, the balance check below decides */ }
  }
  return out;
}

/** Slice the balanced JSON object that starts at `start` (a "{"), honouring strings and escapes. */
function balancedObject(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/** The lot object (`post`) from an app-router lot page, or null. */
export function postFromFlight(html: string): Record<string, any> | null {
  const text = flightText(html);
  const marker = '"post":{"__typename":"Lot"';
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const raw = balancedObject(text, at + '"post":'.length);
  if (!raw) return null;
  try {
    const post = JSON.parse(raw);
    return post && typeof post === "object" && !Array.isArray(post) ? post : null;
  } catch {
    return null;
  }
}
