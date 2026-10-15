import { describe, expect, it } from 'vitest';
import { evidenceSpan, parseTestimonySummary, splitTestimony, type TestimonyRow } from './showcaseTestimony';

const row = (id: string, kind: string, observed_at: string | null, source_url: string | null = null): TestimonyRow =>
  ({ id, kind, observed_at, content_text: 'Unclassified (classifier unavailable) - left for review', source_url, image_id: `img-${id}` });
const all = (rows: TestimonyRow[]) => new Set(rows.map(r => r.image_id as string));

describe('splitTestimony', () => {
  it('shows media observations as one photo group, never as their classifier text', () => {
    const rows = [
      row('a', 'media', '2026-07-12T10:00:00Z', 'https://x/a.jpg'),
      row('b', 'comment', '2026-07-11T10:00:00Z'),
      row('c', 'media', '2026-07-06T10:00:00Z', 'https://x/c.jpg'),
      row('d', 'media', null, null),
    ];
    const { photos, listed } = splitTestimony(rows, all(rows));
    expect(listed.map(r => r.id)).toEqual(['b']);
    expect(photos).toEqual({ count: 3, shown: 2, first: '2026-07-06T10:00:00Z', last: '2026-07-12T10:00:00Z',
      photos: [{ id: 'a', url: 'https://x/a.jpg' }, { id: 'c', url: 'https://x/c.jpg' }] });
  });

  it('caps the thumbnails but counts every photo', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(`m${i}`, 'media', '2026-07-12T00:00:00Z', `https://x/${i}.jpg`));
    const { photos } = splitTestimony(rows, all(rows), 12);
    expect(photos?.count).toBe(40);
    expect(photos?.photos).toHaveLength(12);
  });

  it('returns no photo group when there is no media', () => {
    expect(splitTestimony([row('b', 'comment', null)], new Set()).photos).toBeNull();
  });

  it('never shows a frame the viewer cannot read: the image gate decides, not the storage URL', () => {
    const rows = [row('a', 'media', '2026-07-12T00:00:00Z', 'https://x/a.jpg'), row('b', 'media', '2026-07-12T00:00:00Z', 'https://x/b.jpg'),
      { ...row('c', 'media', '2026-07-12T00:00:00Z', 'https://x/c.jpg'), image_id: null }];
    const { photos } = splitTestimony(rows, new Set(['img-b']));
    expect(photos?.photos).toEqual([{ id: 'b', url: 'https://x/b.jpg' }]);
    expect(photos).toMatchObject({ count: 3, shown: 1 });
    expect(splitTestimony(rows, new Set()).photos).toMatchObject({ count: 3, shown: 0, photos: [] });
  });
});

describe('evidenceSpan', () => {
  it('spans observation clocks and photo capture times together, skipping missing and bad dates', () => {
    expect(evidenceSpan('2026-07-06T00:00:00Z', null, '2025-10-06T12:00:00Z', 'not a date', undefined, '2026-07-12T00:00:00Z'))
      .toEqual({ first: '2025-10-06T12:00:00Z', last: '2026-07-12T00:00:00Z' });
    expect(evidenceSpan(null, undefined)).toEqual({ first: null, last: null });
  });
});

describe('parseTestimonySummary', () => {
  it('reads the reader value: every kind, the total past the 1,000-row cut, and the span', () => {
    const s = parseTestimonySummary({ total: 7202, by_kind: { condition: 2709, specification: 2693, media: 1794, splice: 4, comment: 1, listing: 1 },
      first_observed: '2016-04-23T17:44:41+00:00', last_observed: '2026-10-14T07:25:40+00:00' });
    expect(s).toEqual({ total: 7202, byKind: { condition: 2709, specification: 2693, media: 1794, splice: 4, comment: 1, listing: 1 },
      first: '2016-04-23T17:44:41+00:00', last: '2026-10-14T07:25:40+00:00' });
    expect(Object.values(s!.byKind).reduce((a, b) => a + b, 0)).toBe(s!.total);
  });
  it('reads a vehicle with nothing readable as zero, with no kinds and no span', () => {
    expect(parseTestimonySummary({ total: 0, by_kind: {}, first_observed: null, last_observed: null }))
      .toEqual({ total: 0, byKind: {}, first: null, last: null });
  });
  it('returns null for anything that is not a summary, so the page falls back to the count', () => {
    for (const bad of [null, undefined, 'x', 3, [], { by_kind: {} }, { total: 'many' }, { total: -1 }]) {
      expect(parseTestimonySummary(bad)).toBeNull();
    }
  });
});
