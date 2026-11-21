import { describe, expect, it } from 'vitest';
import { appendFrames, coverDayOf, dayFrameIndex, dayReadSize, REEL_DAY_CAP, REEL_PAGE, REEL_SEQUENCE, type ReelFrame } from './garageReel';

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

  it('lands a square on the first photo of its day in the newest-first run, a lead view only as a stand-in', () => {
    const frames: ReelFrame[] = [
      { url: 'a', day: '2024-05-01' }, { url: 'b', day: '2026-01-02' }, // lead views
      { url: 'c', day: '2026-01-03' }, { url: 'd', day: '2024-05-01' }, { url: 'e', day: '2024-05-01' }, { url: 'f', day: null },
    ];
    expect(dayFrameIndex(frames, '2024-05-01', 2)).toBe(3);
    expect(dayFrameIndex(frames, '2026-01-02', 2)).toBe(1);
    expect(dayFrameIndex(frames, '2023-01-01', 2)).toBe(-1);
  });

  it('reads as far as the day reader places the day, and no further than the cap', () => {
    const days: [string, number, number, number, number][] = [['2026-03-01', 40, 0, 0, 0], ['2025-06-01', 500, 1, 0, 0], ['2024-05-01', 7, 0, 0, 0], ['2023-01-01', 9, 0, 0, 0]];
    // 540 photos on newer days, 7 on the day, a page of slack: read from 12 to 559.
    expect(dayReadSize({ day: '2024-05-01', lastDay: '2026-02-01', loaded: 12, total: 2000, days })).toBe(540 + 7 + REEL_PAGE - 12);
    // The estimate fell short: reach half again as far.
    expect(dayReadSize({ day: '2024-05-01', lastDay: '2024-06-01', loaded: 600, total: 2000, days })).toBe(300);
    // One read is at most 1,000 photos.
    expect(dayReadSize({ day: '2023-01-01', lastDay: '2026-02-01', loaded: 12, total: 5000, days: [['2025-01-01', 2500, 0, 0, 0], ['2023-01-01', 1, 0, 0, 0]] })).toBe(1000);
  });

  it('stops when the run has passed the day, reached undated photos, the end or the cap', () => {
    const days: [string, number, number, number, number][] = [['2024-05-01', 7, 0, 0, 0]];
    expect(dayReadSize({ day: '2024-05-01', lastDay: '2024-04-30', loaded: 12, total: 2000, days })).toBe(0);
    expect(dayReadSize({ day: '2024-05-01', lastDay: null, loaded: 12, total: 2000, days })).toBe(0);
    expect(dayReadSize({ day: '2024-05-01', lastDay: '2025-01-01', loaded: 2000, total: 2000, days })).toBe(0);
    expect(dayReadSize({ day: '2024-05-01', lastDay: '2025-01-01', loaded: REEL_DAY_CAP, total: 9000, days })).toBe(0);
  });
});
