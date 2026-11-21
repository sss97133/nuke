import { describe, expect, it } from 'vitest';
import { appendFrames, coverDayOf, REEL_SEQUENCE } from './garageReel';

const row = (n: number, extra: Partial<{ is_sensitive: boolean; taken_at: string | null }> = {}) =>
  ({ id: `i${n}`, image_url: `https://images.example/${n}.jpg`, is_sensitive: false, taken_at: `2026-0${(n % 9) + 1}-02T10:00:00Z`, ...extra });

describe('garage reel order', () => {
  it('keeps the cover out, drops sensitive photos and never shows a photo twice', () => {
    const cover = row(0).image_url;
    const first = appendFrames([], [row(0), row(1), row(2, { is_sensitive: true }), row(1)], cover);
    expect(first.map(frame => frame.url)).toEqual([row(1).image_url]);
    const next = appendFrames(first, [row(1), row(3, { taken_at: null })], cover);
    expect(next).toEqual([{ url: row(1).image_url, day: '2026-02-02' }, { url: row(3).image_url, day: null }]);
  });

  it('finds the cover day only from a loaded row that is the cover', () => {
    expect(coverDayOf([row(1), row(4)], row(4).image_url)).toBe('2026-05-02');
    expect(coverDayOf([row(1)], row(4).image_url)).toBeNull();
    expect(coverDayOf([row(1)], null)).toBeNull();
  });

  it('follows the cover with the same views in the same order on every card', () => {
    expect(REEL_SEQUENCE).toEqual(['exterior_side', 'exterior_front', 'exterior_rear', 'interior_dashboard', 'engine_bay', 'undercarriage']);
  });
});
