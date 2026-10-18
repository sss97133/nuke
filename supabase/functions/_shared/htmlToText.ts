// HTML to plain text for scraped lot prose (Gooding and Bonhams). Tag stripping runs to a fixed point and entities are
// decoded in one pass, so neither "<scr<script>ipt>" nor "&amp;lt;script&amp;gt;" survives as a tag (CodeQL, 2026-10-15).
// Tested in extract-gooding/goodingText.test.ts.

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '-',
};

/** Decode HTML entities in ONE pass over the string, so "&amp;lt;" becomes "&lt;" and is not decoded a second time. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Remove tags until nothing more is removed, so "<scr<script>ipt>" cannot reassemble into a tag. */
function removeTags(text: string): string {
  let prev: string;
  let cur = text;
  do {
    prev = cur;
    cur = prev.replace(/<[^<>]*>/g, '');
  } while (cur !== prev);
  return cur;
}

/** HTML to plain text: block ends become newlines, tags are removed to a fixed point, entities decoded once, and tags
 *  that decoding produced ("&lt;script&gt;") are removed again. */
export function htmlToText(html: string): string {
  const spaced = html.replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  return removeTags(decodeEntities(removeTags(spaced)))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}
