import { describe, expect, it } from 'vitest';
import { photoDayLabel } from './BarcodeTimeline';

describe('photoDayLabel', () => {
  it('reads a stored pending day as analysed once the photo reader has seen every photo', () => {
    expect(photoDayLabel('Pending Analysis', { photos: 391, seen: 391 })).toBe('Photo Session (391 photos, analysed)');
  });
  it('shows partial progress and keeps pending when nothing is analysed or the reader is silent', () => {
    expect(photoDayLabel('Pending Analysis', { photos: 10, seen: 4 })).toBe('Photo Session (4 of 10 photos analysed)');
    expect(photoDayLabel('Pending Analysis', { photos: 10, seen: 0 })).toBe('Pending Analysis');
    expect(photoDayLabel('Pending Analysis', undefined)).toBe('Pending Analysis');
  });
  it('leaves every other label alone', () => {
    expect(photoDayLabel('Repair', { photos: 3, seen: 3 })).toBe('Repair');
  });
});
