import { supabase } from './supabase';

// Files in the private document buckets open through a short-lived signed URL. A stored public URL to them stops
// working once the buckets are private (deal-documents and user-documents, 2026-10-15); signing needs the viewer's
// storage policy (the file's owner, or an active admin). Any other URL, or a failed signing, passes through unchanged.
export const PRIVATE_DOCUMENT_BUCKETS = ['deal-documents', 'user-documents'] as const;
const STORAGE_URL_RE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/;

export function privateStoragePath(url: string): { bucket: string; path: string } | null {
  const m = url.match(STORAGE_URL_RE);
  if (!m || !(PRIVATE_DOCUMENT_BUCKETS as readonly string[]).includes(m[1])) return null;
  return { bucket: m[1], path: decodeURIComponent(m[2]) };
}

export async function signPrivateStorageUrl(url: string, ttlSeconds = 3600): Promise<string> {
  const target = privateStoragePath(url);
  if (!target) return url;
  try {
    const { data, error } = await supabase.storage.from(target.bucket).createSignedUrl(target.path, ttlSeconds);
    return !error && data?.signedUrl ? data.signedUrl : url;
  } catch {
    return url;
  }
}
