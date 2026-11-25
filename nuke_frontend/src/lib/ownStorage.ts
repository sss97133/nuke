/**
 * Where a signed-in user's own upload lands: one rule for web and iOS. No page types a bucket or a path.
 *
 * Photos go to vehicle-photos at users/<uid>/capture-relay/<sha256>/<filename>, the path the iOS app writes
 * (apps/nuke-capture-ios Config.storagePath) and the only one its insert policy admits ("vehicle-photos: owner insert":
 * folder 1 'users', folder 2 the caller's uid). The path is the bytes' hash, so an object already there is this same
 * photo and its "already exists" is success. Papers (titles, receipts, documents) go to the private user-documents
 * bucket at <uid>/vehicle-papers/<sha256>/<filename> (policy user_documents_owner_insert: folder 1 the caller's uid) and
 * are read back by signed URL, never a public one. vehicle-data, where web uploads went before, admits no client insert.
 */
import { supabase } from './supabase';

export const PHOTO_BUCKET = 'vehicle-photos';
export const PAPER_BUCKET = 'user-documents';

/** A filename safe as one path segment; the bytes' hash beside it keeps it unique. */
export function objectName(filename: string): string {
  const name = String(filename || '').split(/[\\/]/).pop() || '';
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'upload';
}

export function photoObjectPath(uid: string, sha256: string, filename: string): string {
  return `users/${uid}/capture-relay/${sha256}/${objectName(filename)}`;
}

export function paperObjectPath(uid: string, sha256: string, filename: string): string {
  return `${uid}/vehicle-papers/${sha256}/${objectName(filename)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i;

/** The bucket a stored vehicle_images.storage_path lives in, by its shape; null when the shape is not one we write. */
export function bucketForStoragePath(path: string | null | undefined): string | null {
  const p = String(path || '').replace(/^\/+/, '');
  if (!p) return null;
  if (p.startsWith('users/')) return PHOTO_BUCKET;
  if (p.startsWith('vehicles/') || p.startsWith('temp/')) return 'vehicle-data';
  if (UUID.test(p) && p.split('/')[1] === 'vehicle-papers') return PAPER_BUCKET;
  return null;
}

/** "already exists" on a content-addressed path means the same bytes are stored: the upload succeeded. */
export function isSameBytesConflict(error: { message?: string; statusCode?: string | number } | null | undefined): boolean {
  if (!error) return false;
  const m = String(error.message || '').toLowerCase();
  return String(error.statusCode) === '409' || m.includes('already exists') || m.includes('duplicate');
}

/** Upload one object to the caller's own folder. Resolves to null on success (or same bytes), else the refusal. */
export async function uploadOwnObject(bucket: string, path: string, body: Blob, contentType?: string): Promise<string | null> {
  const { error } = await supabase.storage.from(bucket).upload(path, body, { cacheControl: '3600', upsert: false, contentType });
  if (!error || isSameBytesConflict(error)) return null;
  return error.message || 'refused';
}
