import { describe, expect, it } from 'vitest';
import { answersReducer, buildDeviceHints, hintsQuery, needsSave, statusWord, uploadsReducer, type Answers } from './intakeState';

describe('answer saves', () => {
  it('goes edit → saving → saved, and keeps newer text unsaved', () => {
    let s: Answers = answersReducer({}, { type: 'load', key: 'q1', savedText: null });
    s = answersReducer(s, { type: 'edit', key: 'q1', text: 'a 1970 455' });
    expect(needsSave(s.q1)).toBe(true);
    s = answersReducer(s, { type: 'save_started', key: 'q1' });
    expect(statusWord(s.q1)).toBe('saving…');
    expect(needsSave(s.q1)).toBe(false);
    s = answersReducer(s, { type: 'edit', key: 'q1', text: 'a 1970 455, four-bolt' });
    s = answersReducer(s, { type: 'save_ok', key: 'q1', text: 'a 1970 455' });
    expect(s.q1.status).toBe('idle');
    expect(needsSave(s.q1)).toBe(true);
    s = answersReducer(s, { type: 'save_ok', key: 'q1', text: 'a 1970 455, four-bolt' });
    expect(statusWord(s.q1)).toBe('saved');
    expect(needsSave(s.q1)).toBe(false);
  });
  it('a failed save keeps the text and says so; retry can save it', () => {
    let s = answersReducer({}, { type: 'edit', key: 'q2', text: 'D-port heads' });
    s = answersReducer(s, { type: 'save_started', key: 'q2' });
    s = answersReducer(s, { type: 'save_failed', key: 'q2' });
    expect(s.q2.text).toBe('D-port heads');
    expect(statusWord(s.q2)).toBe('not saved, try again');
    expect(needsSave(s.q2)).toBe(true);
  });
  it('a stored unsent draft comes back as not saved', () => {
    const s = answersReducer({}, { type: 'load', key: 'q3', savedText: 'old', draft: 'newer' });
    expect(s.q3).toEqual({ text: 'newer', savedText: 'old', status: 'failed' });
    const t = answersReducer({}, { type: 'load', key: 'q3', savedText: 'old', draft: 'old' });
    expect(t.q3.status).toBe('saved');
  });
});

describe('uploads', () => {
  it('uploading → received or already received; failed → retry → uploading', () => {
    let u = uploadsReducer([], { type: 'added', upload: { id: 'a', name: 'r.jpg', isImage: true, previewUrl: null } });
    expect(u[0].status).toBe('uploading');
    expect(uploadsReducer(u, { type: 'done', id: 'a', duplicate: false })[0].status).toBe('received');
    expect(uploadsReducer(u, { type: 'done', id: 'a', duplicate: true })[0].status).toBe('duplicate');
    u = uploadsReducer(u, { type: 'failed', id: 'a' });
    expect(u[0].status).toBe('failed');
    expect(uploadsReducer(u, { type: 'retry', id: 'a' })[0].status).toBe('uploading');
  });
});

describe('device hints', () => {
  it('takes screen, dpr and timezone; drops junk', () => {
    expect(buildDeviceHints({ screen: { width: 390, height: 844 }, devicePixelRatio: 3 }, () => 'America/Los_Angeles'))
      .toEqual({ screen: { w: 390, h: 844, dpr: 3 }, timezone: 'America/Los_Angeles' });
    expect(buildDeviceHints({ screen: { width: NaN }, devicePixelRatio: -1 }, () => undefined))
      .toEqual({ screen: { w: null, h: null, dpr: null }, timezone: null });
    expect(hintsQuery({ screen: { w: 390, h: 844, dpr: 3 }, timezone: 'UTC' })).toBe('sw=390&sh=844&dpr=3&tz=UTC');
  });
});
