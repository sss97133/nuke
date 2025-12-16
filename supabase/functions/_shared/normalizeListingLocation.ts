export function normalizeListingLocation(raw: any): {
  raw: string | null;
  clean: string | null;
} {
  const rawStr = typeof raw === 'string' ? raw : (raw == null ? '' : String(raw));
  let s = rawStr.trim();
  if (!s) return { raw: null, clean: null };

  // Hard reject obvious non-location payloads (JS blobs, JSON, URLs, HTML, etc).
  // We prefer returning null over poisoning canonical fields.
  const rejectPatterns: RegExp[] = [
    /https?:\/\//i,
    /<[^>]+>/, // HTML
    /[{}[\]"]/,
    /\\[uU]?[0-9a-f]{2,4}/i, // escaped sequences
    /\bwp-admin\b/i,
    /\bnewrelic\b/i,
    /\bcommentRatingUri\b/i,
    /\bStorageKey\b/i,
  ];
  if (rejectPatterns.some((re) => re.test(s))) {
    return { raw: rawStr.trim() || null, clean: null };
  }

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

  // Require it to look like a place string (letters, spaces, comma, period, apostrophe, hyphen).
  // Reject if it contains other punctuation that often indicates code/config.
  if (!/[A-Za-z]/.test(s)) return { raw: rawStr.trim() || null, clean: null };
  if (!/^[A-Za-z\s,.'’-]{2,80}$/.test(s)) return { raw: rawStr.trim() || null, clean: null };

  return { raw: rawStr.trim() || null, clean: s || null };
}

export function normalizeListingLocation(raw: any): {
  raw: string | null;
  clean: string | null;
} {
  const rawStr = typeof raw === 'string' ? raw : (raw == null ? '' : String(raw));
  let s = rawStr.trim();
  if (!s) return { raw: null, clean: null };

  // Hard reject obvious non-location payloads (JS blobs, JSON, URLs, HTML, etc).
  // We prefer returning null over poisoning canonical fields.
  const rejectPatterns: RegExp[] = [
    /https?:\/\//i,
    /<[^>]+>/, // HTML
    /[{}[\]"]/,
    /\\[uU]?[0-9a-f]{2,4}/i, // escaped sequences
    /\bwp-admin\b/i,
    /\bnewrelic\b/i,
    /\bcommentRatingUri\b/i,
    /\bStorageKey\b/i,
  ];
  if (rejectPatterns.some((re) => re.test(s))) {
    return { raw: rawStr.trim() || null, clean: null };
  }

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

  // Require it to look like a place string (letters, spaces, comma, period, apostrophe, hyphen).
  // Reject if it contains other punctuation that often indicates code/config.
  if (!/[A-Za-z]/.test(s)) return { raw: rawStr.trim() || null, clean: null };
  if (!/^[A-Za-z\s,.'’-]{2,80}$/.test(s)) return { raw: rawStr.trim() || null, clean: null };

  return { raw: rawStr.trim() || null, clean: s || null };
}


