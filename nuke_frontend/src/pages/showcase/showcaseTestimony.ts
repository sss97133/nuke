/**
 * What the showcase lists as testimony. A media observation is a photo: it is shown as the photo, never as the text
 * a classifier left on it (on the featured K5 all 42 media observations carry "classifier unavailable" notes, read
 * 2026-10-15). The record's span counts photo capture times as well as observation clocks.
 */
export interface TestimonyRow {
  id: string;
  kind: string;
  observed_at: string | null;
  content_text: string | null;
  source_url: string | null;
}

export interface PhotoGroup {
  count: number;
  first: string | null;
  last: string | null;
  photos: { id: string; url: string }[];
}

export function splitTestimony(rows: TestimonyRow[], thumbs = 12): { photos: PhotoGroup | null; listed: TestimonyRow[] } {
  const media = rows.filter(r => r.kind === 'media');
  const listed = rows.filter(r => r.kind !== 'media');
  if (media.length === 0) return { photos: null, listed };
  const span = evidenceSpan(...media.map(r => r.observed_at));
  const photos = media.filter(r => r.source_url).slice(0, thumbs).map(r => ({ id: r.id, url: r.source_url as string }));
  return { photos: { count: media.length, ...span, photos }, listed };
}

export function evidenceSpan(...dates: (string | null | undefined)[]): { first: string | null; last: string | null } {
  let first: string | null = null;
  let last: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    const t = Date.parse(d);
    if (Number.isNaN(t)) continue;
    if (first === null || t < Date.parse(first)) first = d;
    if (last === null || t > Date.parse(last)) last = d;
  }
  return { first, last };
}
