import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
import { bucketForStoragePath, isSameBytesConflict, objectName, paperObjectPath, photoObjectPath } from './ownStorage';

const uid = '11111111-1111-4111-8111-111111111111';
const sha = 'a'.repeat(64);

describe('ownStorage: one landing rule with iOS', () => {
  it('writes photos where iOS writes them, inside the caller\'s own folder', () => {
    // apps/nuke-capture-ios Config.storagePath: users/<uid>/capture-relay/<sha256>/<filename>
    expect(photoObjectPath(uid, sha, 'IMG_0001.JPG')).toBe(`users/${uid}/capture-relay/${sha}/IMG_0001.JPG`);
    const [first, second] = photoObjectPath(uid, sha, 'x.jpg').split('/');
    expect([first, second]).toEqual(['users', uid]);
  });

  it('writes papers to the private bucket under the caller\'s uid', () => {
    expect(paperObjectPath(uid, sha, 'title scan.pdf')).toBe(`${uid}/vehicle-papers/${sha}/title_scan.pdf`);
    expect(paperObjectPath(uid, sha, 'x.pdf').split('/')[0]).toBe(uid);
  });

  it('keeps a filename to one safe segment', () => {
    expect(objectName('../../etc/passwd')).toBe('passwd');
    expect(objectName('a b#c%.jpg')).toBe('a_b_c_.jpg');
    expect(objectName('')).toBe('upload');
  });

  it('names the bucket of a stored path by its shape', () => {
    expect(bucketForStoragePath(photoObjectPath(uid, sha, 'x.jpg'))).toBe('vehicle-photos');
    expect(bucketForStoragePath(paperObjectPath(uid, sha, 'x.pdf'))).toBe('user-documents');
    expect(bucketForStoragePath('vehicles/v1/images/general/x.jpg')).toBe('vehicle-data');
    expect(bucketForStoragePath(`${uid}/other/x.pdf`)).toBeNull();
    expect(bucketForStoragePath(null)).toBeNull();
  });

  it('treats an object already at a content-addressed path as the same bytes', () => {
    expect(isSameBytesConflict({ message: 'The resource already exists', statusCode: '409' })).toBe(true);
    expect(isSameBytesConflict({ message: 'new row violates row-level security policy', statusCode: '403' })).toBe(false);
    expect(isSameBytesConflict(null)).toBe(false);
  });
});
