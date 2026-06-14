/**
 * UserRecentPhotos — dense recent-photos strip for the user profile.
 *
 * Replaces PublicImageGallery on the profile (that component is shared with
 * Profile.tsx / Profile.legacy.tsx, so it is left untouched for other consumers).
 *
 * Data: vehicle_images by user_id, newest-first.
 *  - Owner path includes NULL-vehicle (inbox) images.
 *  - Visitor path only vehicle-attached images on public vehicles (RLS-aligned).
 *
 * Header shows EXACT totals via count/head queries (no top-K pretence):
 *   "20,978 IMAGES · 154 THIS WEEK"
 *
 * Self-guarding: returns null while loading and at 0 images (No Empty Shells).
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';

interface UserRecentPhotosProps {
  userId: string;
  isOwnProfile: boolean;
}

interface PhotoRow {
  id: string;
  image_url: string | null;
  thumbnail_url: string | null;
  storage_path: string | null;
  source: string | null;
  source_url: string | null;
  taken_at: string | null;
  created_at: string | null;
}

const GRID_LIMIT = 60;

// Source guards carried over from PublicImageGallery — keep scraped/imported
// imagery out of the personal strip. Applied to displayed thumbs only;
// header counts stay exact.
const SOURCE_BLOCKLIST = new Set([
  'bat_import',
  'bat_listing',
  'external_import',
  'organization_import',
  'scraper',
  'url_scraper',
  'classic_com_indexing',
  'classic_scrape',
  'collector_scrape',
]);

const IMPORT_PATH_TOKENS = [
  'import_queue',
  'external_import',
  'organization_import',
  'bat_import',
  'classic.com/veh',
  'bringatrailer.com/wp-content/uploads',
];

const looksImported = (value?: string | null): boolean => {
  if (!value) return false;
  const lower = String(value).toLowerCase();
  return IMPORT_PATH_TOKENS.some(token => lower.includes(token));
};

const passesSourceGuards = (img: PhotoRow): boolean => {
  const src = String(img.source || '').toLowerCase();
  if (src && SOURCE_BLOCKLIST.has(src)) return false;
  if (looksImported(img.storage_path)) return false;
  if (looksImported(img.image_url)) return false;
  if (String(img.source_url || '').trim().startsWith('http')) return false;
  return true;
};

/** Day (YYYY-MM-DD) for the journal click-through — EXIF taken_at, created_at fallback. */
const journalDay = (img: PhotoRow): string | null => {
  const stamp = img.taken_at || img.created_at;
  if (!stamp || stamp.length < 10) return null;
  return stamp.slice(0, 10);
};

const GRID_COLUMNS = `id, image_url, thumbnail_url, storage_path, source, source_url, taken_at, created_at`;

const UserRecentPhotos: React.FC<UserRecentPhotosProps> = ({ userId, isOwnProfile }) => {
  const [images, setImages] = useState<PhotoRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [weekCount, setWeekCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const load = async () => {
      try {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        // Visitor path inner-joins vehicles and keeps only public ones;
        // owner path has no vehicle filter so NULL-vehicle inbox images count.
        const countSelect = isOwnProfile
          ? 'id'
          : 'id, vehicle:vehicles!vehicle_images_vehicle_id_fkey!inner(id)';
        const gridSelect = isOwnProfile
          ? GRID_COLUMNS
          : `${GRID_COLUMNS}, vehicle:vehicles!vehicle_images_vehicle_id_fkey!inner(id)`;

        const withVisibility = <T,>(query: T): T => {
          if (isOwnProfile) return query;
          return (query as any).eq('vehicle.is_public', true);
        };

        const [totalRes, weekRes, gridRes] = await Promise.all([
          withVisibility(
            supabase
              .from('vehicle_images')
              .select(countSelect, { count: 'exact', head: true })
              .eq('user_id', userId)
          ),
          withVisibility(
            supabase
              .from('vehicle_images')
              .select(countSelect, { count: 'exact', head: true })
              .eq('user_id', userId)
              .gte('created_at', weekAgo)
          ),
          withVisibility(
            supabase
              .from('vehicle_images')
              .select(gridSelect)
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(GRID_LIMIT)
          ),
        ]);

        if (cancelled) return;

        if (totalRes.error) throw totalRes.error;
        if (weekRes.error) throw weekRes.error;
        if (gridRes.error) throw gridRes.error;

        const rows = ((gridRes.data || []) as unknown as PhotoRow[]).filter(passesSourceGuards);

        setTotalCount(totalRes.count || 0);
        setWeekCount(weekRes.count || 0);
        setImages(rows);
      } catch (error) {
        console.error('[UserRecentPhotos] load failed:', error);
        if (!cancelled) {
          setImages([]);
          setTotalCount(0);
          setWeekCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [userId, isOwnProfile]);

  // No Empty Shells: nothing while loading, nothing at 0 images.
  if (loading) return null;
  if (totalCount === 0 || images.length === 0) return null;

  const headerLine = `${totalCount.toLocaleString('en-US')} IMAGES${
    weekCount > 0 ? ` · ${weekCount.toLocaleString('en-US')} THIS WEEK` : ''
  }`;

  return (
    <CollapsibleWidget
      title="RECENT PHOTOS"
      variant="profile"
      badge={
        <span
          style={{
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: '9px',
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          {headerLine}
        </span>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))',
          gap: '2px',
        }}
      >
        {images.map(img => {
          const rawUrl = img.thumbnail_url || img.image_url;
          if (!rawUrl) return null;
          // A failed render is hidden, never swapped for the raw original:
          // the newest uploads are multi-MB HEIC that no browser can decode,
          // so the old raw fallback turned a transient miss into a permanent
          // broken + heavy image (audit P1a).
          if (failedIds.has(img.id)) return null;
          const src = optimizeImageUrl(rawUrl, 'thumbnail') || rawUrl;
          const day = journalDay(img);
          const thumb = (
            <img
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => {
                setFailedIds(prev => {
                  if (prev.has(img.id)) return prev;
                  const next = new Set(prev);
                  next.add(img.id);
                  return next;
                });
              }}
              style={{
                width: '100%',
                aspectRatio: '1 / 1',
                objectFit: 'cover',
                display: 'block',
                background: '#eeeeee',
              }}
            />
          );
          return day ? (
            <Link
              key={img.id}
              to={`/journal/${day}`}
              title={day}
              style={{ display: 'block', lineHeight: 0 }}
            >
              {thumb}
            </Link>
          ) : (
            <div key={img.id} style={{ lineHeight: 0 }}>{thumb}</div>
          );
        })}
      </div>
    </CollapsibleWidget>
  );
};

export default UserRecentPhotos;
