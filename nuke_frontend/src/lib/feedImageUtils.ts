import { supabase, SUPABASE_URL } from './supabase';

/**
 * Image URL normalization for feed cards.
 *
 * We have a mix of legacy/public URLs, occasionally-stored signed URLs, and sometimes raw storage paths.
 * The homepage must never prefer expiring signed URLs (they break image loading in production).
 */

export const parseVariants = (variants: any): Record<string, string> | null => {
  if (!variants) return null;
  if (typeof variants === 'object') return variants as Record<string, string>;
  if (typeof variants === 'string') {
    try {
      const parsed = JSON.parse(variants);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
    } catch {
      // ignore parse failures
    }
  }
  return null;
};

export const normalizeSupabaseStorageUrl = (raw: any): string | null => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Convert signed URLs to stable public URLs (strip token and swap path segment).
  // Signed:  .../storage/v1/object/sign/<bucket>/<path>?token=...
  // Public:  .../storage/v1/object/public/<bucket>/<path>
  if (s.includes('/storage/v1/object/sign/')) {
    const base = s.split('?')[0];
    const publicUrl = base.replace('/storage/v1/object/sign/', '/storage/v1/object/public/');
    if (SUPABASE_URL && publicUrl.startsWith('/storage/')) return `${SUPABASE_URL}${publicUrl}`;
    return publicUrl;
  }

  // If a path-only Supabase storage URL is stored, prefix with Supabase host so it loads cross-origin.
  if (SUPABASE_URL && s.startsWith('/storage/')) return `${SUPABASE_URL}${s}`;

  return s;
};

export const isUsableImageSrc = (url: string | null): url is string => {
  if (!url) return false;
  return (
    url.startsWith('https://') ||
    url.startsWith('http://') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('/')
  );
};

export const getPublicUrlFromStoragePath = (storagePath: any): string | null => {
  if (!storagePath) return null;
  const path = String(storagePath).replace(/^\/+/, '').trim();
  if (!path) return null;

  const preferBucket = path.startsWith('vehicles/') ? 'vehicle-data' : 'vehicle-images';
  const altBucket = preferBucket === 'vehicle-data' ? 'vehicle-images' : 'vehicle-data';

  try {
    const { data: preferred } = supabase.storage.from(preferBucket).getPublicUrl(path);
    if (preferred?.publicUrl) return preferred.publicUrl;
  } catch {
    // ignore
  }
  try {
    const { data: alt } = supabase.storage.from(altBucket).getPublicUrl(path);
    return alt?.publicUrl || null;
  } catch {
    return null;
  }
};

export const resolveVehicleImageUrl = (img: any): string | null => {
  if (!img) return null;

  const variants = parseVariants(img.variants);
  const candidates = [
    variants?.large,
    variants?.medium,
    variants?.full,
    variants?.thumbnail,
    img.large_url,
    img.medium_url,
    img.image_url,
    img.thumbnail_url,
    getPublicUrlFromStoragePath(img.storage_path),
  ];

  for (const c of candidates) {
    const normalized = normalizeSupabaseStorageUrl(c);
    if (isUsableImageSrc(normalized)) return normalized;
  }

  return null;
};

export const getOriginImages = (vehicle: any): string[] => {
  const raw = vehicle?.origin_metadata?.images || vehicle?.origin_metadata?.image_urls;
  const list = Array.isArray(raw) ? raw : [];

  const thumb =
    (typeof vehicle?.origin_metadata?.thumbnail_url === 'string' && vehicle.origin_metadata.thumbnail_url) ||
    (typeof vehicle?.origin_metadata?.thumbnail === 'string' && vehicle.origin_metadata.thumbnail) ||
    null;

  const candidates = [
    ...(thumb ? [thumb] : []),
    ...list,
  ];

  return candidates
    .filter((url: any) => typeof url === 'string')
    .map((url: string) => url.trim())
    .filter((url: string) => url.startsWith('http'))
    .filter((url: string) => !url.includes('youtube.com'))
    .filter((url: string) => !url.toLowerCase().endsWith('.svg'));
};

export const cleanDisplayMake = (raw: any): string | null => {
  if (!raw) return null;
  const s = String(raw).replace(/&#0*38;/g, '&').replace(/&amp;/g, '&').replace(/[/_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s === '*' || s.length > 40) return null;
  if (s.toUpperCase() === s && s.length <= 6) return s;
  return s
    .split(' ')
    .map((p) => (p.length <= 2 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
    .join(' ');
};

export const cleanDisplayModel = (raw: any): string | null => {
  if (!raw) return null;
  let s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  s = s.replace(/&#0*38;/g, '&').replace(/&#0*39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  s = s.replace(/\s*-\s*\$[\d,]+(?:\.\d{2})?.*$/i, '').trim();
  s = s.replace(/\s*\([^)]*\)\s*$/i, '').trim();
  s = s.replace(/\s*\(\s*Est\.\s*payment.*$/i, '').trim();
  s = s.replace(/\s*-\s*craigslist\b.*$/i, '').trim();
  if (!s || s.length > 120) return null;
  return s;
};
