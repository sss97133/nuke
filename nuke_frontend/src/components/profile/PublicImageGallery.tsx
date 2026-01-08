import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface PublicImageGalleryProps {
  userId: string;
  isOwnProfile: boolean;
}

const PublicImageGallery: React.FC<PublicImageGalleryProps> = ({ userId, isOwnProfile }) => {
  const [images, setImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadImages();
  }, [userId]);

  const IMAGE_SELECT = `
    id,
    image_url,
    thumbnail_url,
    medium_url,
    storage_path,
    source,
    source_url,
    user_id,
    created_at,
    exif_data,
    vehicle:vehicles!vehicle_images_vehicle_id_fkey(id, is_public, user_id, year, make, model),
    device_attributions(
      ghost_user_id,
      actual_contributor_id
    )
  `;

  const SOURCE_BLOCKLIST = new Set([
    'bat_import',
    'bat_listing',
    'external_import',
    'organization_import',
    'scraper',
    'url_scraper',
    'classic_com_indexing',
    'classic_scrape',
    'collector_scrape'
  ]);

  const IMPORT_PATH_TOKENS = [
    'import_queue',
    'external_import',
    'organization_import',
    'bat_import',
    'classic.com/veh',
    'bringatrailer.com/wp-content/uploads'
  ];

  const REMOTE_HOST_BLOCKLIST = [
    'bringatrailer.com',
    'carsandbids.com',
    'classic.com',
    'hemmings.com',
    'dealeraccelerate',
    'ebayimg.com',
    'goodingco.com',
    'bonhams.com',
    'barrett-jackson.com',
    'barrettjackson.com',
    'rmsothebys.com'
  ];

  const looksImported = (value?: string | null) => {
    if (!value) return false;
    const lower = String(value).toLowerCase();
    return IMPORT_PATH_TOKENS.some(token => lower.includes(token));
  };

  const isRemoteBlockedHost = (value?: string | null) => {
    if (!value) return false;
    const lower = String(value).toLowerCase();
    if (!lower.startsWith('http')) return false;
    if (lower.includes('supabase.co/storage')) return false;
    return REMOTE_HOST_BLOCKLIST.some(host => lower.includes(host));
  };

  const dedupeById = (rows: any[]) => {
    const seen = new Set<string>();
    return rows.filter(row => {
      if (!row?.id) return false;
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  };

  const fetchImagesByIds = async (ids: string[]): Promise<any[]> => {
    if (ids.length === 0) return [];
    const chunkSize = 50;
    const chunks: any[] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('vehicle_images')
        .select(IMAGE_SELECT)
        .in('id', chunk);
      if (error) {
        console.error('Error loading attributed image chunk:', error);
        continue;
      }
      chunks.push(...(data || []));
    }
    return chunks;
  };

  const hasTrustedAttribution = (img: any): boolean => {
    if (!img) return false;
    if (img.user_id === userId) return true;
    const deviceAttrs = Array.isArray(img.device_attributions) ? img.device_attributions : [];
    return deviceAttrs.some((attr: any) => attr?.actual_contributor_id === userId);
  };

  const passesSourceGuards = (img: any): boolean => {
    const src = String(img?.source || '').toLowerCase();
    if (src && SOURCE_BLOCKLIST.has(src)) return false;
    if (looksImported(img?.storage_path)) return false;
    if (looksImported(img?.image_url)) return false;
    if (isRemoteBlockedHost(img?.image_url)) return false;
    const sourceUrl = String(img?.source_url || '').trim();
    if (sourceUrl.startsWith('http')) return false;
    const exifSourceUrl = String(img?.exif_data?.source_url || '').trim();
    if (exifSourceUrl.startsWith('http')) return false;
    return true;
  };

  const isVisibleToViewer = (img: any): boolean => {
    if (isOwnProfile) return true;
    if (!img?.vehicle) return false;
    return Boolean(img.vehicle.is_public);
  };

  const loadImages = async () => {
    try {
      setLoading(true);

      const { data: userImages, error: userImagesError } = await supabase
        .from('vehicle_images')
        .select(IMAGE_SELECT)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (userImagesError) throw userImagesError;

      const directImages = userImages || [];
      const directIds = new Set(directImages.map((img: any) => img.id));

      const { data: attributionRows, error: attributionError } = await supabase
        .from('device_attributions')
        .select('image_id')
        .eq('actual_contributor_id', userId)
        .limit(500);

      if (attributionError) throw attributionError;

      const attributedIds = (attributionRows || [])
        .map(row => row?.image_id)
        .filter((id): id is string => Boolean(id) && !directIds.has(id));

      const attributedImages = attributedIds.length > 0
        ? await fetchImagesByIds(Array.from(new Set(attributedIds)))
        : [];

      const combined = dedupeById([...directImages, ...attributedImages]);

      const cleaned = combined
        .filter(img => hasTrustedAttribution(img))
        .filter(img => passesSourceGuards(img))
        .filter(img => isVisibleToViewer(img))
        .sort((a, b) => {
          const aDate = new Date(a?.created_at || 0).getTime();
          const bDate = new Date(b?.created_at || 0).getTime();
          return bDate - aDate;
        });

      setImages(cleaned);
    } catch (error) {
      console.error('Error loading image gallery:', error);
      setImages([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body text-center" style={{ padding: 'var(--space-6)' }}>
          <div className="text text-muted">Loading gallery...</div>
        </div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="card">
        <div className="card-body text-center" style={{ padding: 'var(--space-6)' }}>
          <div className="text text-muted">
            {isOwnProfile ? 'No images in your gallery yet.' : 'No public images to display.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h3 className="heading-3">Image Gallery ({images.length})</h3>
        </div>
        <div className="card-body">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 'var(--space-2)'
          }}>
            {images.map(image => (
              <div
                key={image.id}
                style={{
                  aspectRatio: '1 / 1',
                  backgroundImage: `url(${image.image_url})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  // Navigate to vehicle if available
                  if (image.vehicle?.id) {
                    window.location.href = `/vehicle/${image.vehicle.id}`;
                  }
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicImageGallery;

