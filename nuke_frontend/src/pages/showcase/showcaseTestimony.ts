/**
 * What the showcase lists as testimony. A media observation is a photo: it is shown as the photo, never as the text
 * a classifier left on it (on the GAA-listed Blazer the showcase featured until 2026-10-15, all 42 media observations
 * carry "classifier unavailable" notes). A photo is shown only when the viewer can read its image row: the public read
 * gate on vehicle_images holds back frames the vision gate rejected as personal or misattributed (on that Blazer, 297
 * of 298), and an observation's storage URL must not route around it. The record's span counts photo capture times
 * as well.
 */
export interface TestimonyRow {
  id: string;
  kind: string;
  observed_at: string | null;
  content_text: string | null;
  source_url: string | null;
  image_id?: string | null;
}

export interface PhotoGroup {
  count: number;
  /** Media observations whose image row the viewer can read; the rest are not public. */
  shown: number;
  first: string | null;
  last: string | null;
  photos: { id: string; url: string }[];
}

/** `visible`: the image ids the viewer's own read of vehicle_images returned (the gate applied). */
export function splitTestimony(rows: TestimonyRow[], visible: ReadonlySet<string>, thumbs = 12): { photos: PhotoGroup | null; listed: TestimonyRow[] } {
  const media = rows.filter(r => r.kind === 'media');
  const listed = rows.filter(r => r.kind !== 'media');
  if (media.length === 0) return { photos: null, listed };
  const span = evidenceSpan(...media.map(r => r.observed_at));
  const readable = media.filter(r => r.source_url && r.image_id && visible.has(r.image_id));
  const photos = readable.slice(0, thumbs).map(r => ({ id: r.id, url: r.source_url as string }));
  return { photos: { count: media.length, shown: readable.length, ...span, photos }, listed };
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

/** The vehicle_testimony_summary reader's value: counts by kind and the first/last observed, as the viewer may read them. */
export interface TestimonySummary {
  total: number;
  byKind: Record<string, number>;
  first: string | null;
  last: string | null;
}

/** Null when the value is not a summary (the reader failed or is missing); the page then shows the count alone. */
export function parseTestimonySummary(raw: unknown): TestimonySummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const total = typeof r.total === 'number' ? r.total : Number(r.total);
  if (!Number.isFinite(total) || total < 0) return null;
  const byKind: Record<string, number> = {};
  if (r.by_kind && typeof r.by_kind === 'object' && !Array.isArray(r.by_kind)) {
    for (const [kind, v] of Object.entries(r.by_kind as Record<string, unknown>)) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && n > 0) byKind[kind] = n;
    }
  }
  const at = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return { total, byKind, first: at(r.first_observed), last: at(r.last_observed) };
}
