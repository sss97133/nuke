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

  const loadImages = async () => {
    try {
      setLoading(true);
      
      // Load images actually taken/photographed by this user
      // Filter by vehicle_images.user_id (photographer), not vehicle ownership
      let query = supabase
        .from('vehicle_images')
        .select(`
          *,
          vehicle:vehicles!vehicle_images_vehicle_id_fkey(id, is_public, user_id, year, make, model)
        `)
        .eq('user_id', userId); // Filter by who took the photo, not vehicle owner

      // If viewing someone else's profile, only show images from public vehicles
      if (!isOwnProfile) {
        query = query.eq('vehicle.is_public', true);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      // IMPORTANT:
      // The importer sets vehicle_images.user_id to a "runner" user for RLS/ownership in some flows.
      // Those are NOT actually authored/taken by that user and should not appear in a user's gallery.
      // Filter out imported/scraped images by source and/or presence of a source URL in exif_data.
      const cleaned = (data || []).filter((img: any) => {
        const src = String(img?.source || '').toLowerCase();
        if (src === 'organization_import' || src === 'external_import') return false;
        const exifSourceUrl = String(img?.exif_data?.source_url || '').trim();
        if (exifSourceUrl.startsWith('http')) return false;
        return true;
      });

      setImages(cleaned);
    } catch (error) {
      console.error('Error loading image gallery:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
          <div className="text text-muted">Loading gallery...</div>
        </div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
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

