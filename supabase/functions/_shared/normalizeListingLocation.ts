export function normalizeListingLocation(raw: any): {
  raw: string | null;
  clean: string | null;
} {
  const rawStr = typeof raw === 'string' ? raw : (raw == null ? '' : String(raw));
  let s = rawStr.trim();
  if (!s) return { raw: null, clean: null };

  // Known CTA/link text that gets accidentally concatenated into location strings.
  // Seen in prod: "United StatesView all listingsNotify me about new listings"
  const junkPhrases = ['View all listings', 'Notify me about new listings'];
  for (const phrase of junkPhrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped.replace(/\s+/g, '\\s*'), 'gi');
    s = s.replace(re, ' ');
  }

  // Collapse whitespace and trim trailing separators
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[•·|,;:–—-]\s*$/g, '').trim();

  return { raw: rawStr.trim() || null, clean: s || null };
}


