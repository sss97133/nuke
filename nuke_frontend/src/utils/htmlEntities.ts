// decodeHtmlEntities: text scraped from auction pages (BaT comments JSON) arrives HTML-escaped —
// "Don&#039;t", "4&#215;4", "&amp;" — and is stored that way (the stored text feeds the comment
// content_hash two writers dedupe on, so it stays as served). Decode for display only; the result
// is rendered as a React text node, never as HTML, so a decoded "<" stays text.
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', times: '×', deg: '°',
  frac12: '½', frac14: '¼', frac34: '¾', eacute: 'é', euro: '€', pound: '£',
};

export function decodeHtmlEntities(text: string): string {
  if (!text || text.indexOf('&') === -1) return text;
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}
