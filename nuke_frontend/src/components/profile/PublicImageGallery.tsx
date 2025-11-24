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
      
      // Load public images from user's vehicles
      // For own profile, show all images
      // For public profile, only show images from public vehicles
      const { data, error } = await supabase
        .from('vehicle_images')
        .select(`
          *,
          vehicles!inner(id, is_public, user_id)
        `)
        .eq('vehicles.user_id', userId)
        .eq(isOwnProfile ? 'vehicles.user_id' : 'vehicles.is_public', isOwnProfile ? userId : true)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      setImages(data || []);
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
                  if (image.vehicles?.id) {
                    window.location.href = `/vehicle/${image.vehicles.id}`;
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

