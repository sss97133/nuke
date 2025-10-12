import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import ImageLightbox from '../image/ImageLightbox';
import '../../design-system.css';

interface VehicleImage {
  id: string;
  image_url: string;
  description?: string;
  uploaded_by: string;
  created_at: string;
  gps_latitude?: number;
  gps_longitude?: number;
}

interface VehicleImageGalleryProps {
  vehicleId: string;
  showThumbnails?: boolean;
  maxImages?: number;
}

const VehicleImageGallery = ({ vehicleId, showThumbnails = true, maxImages }: VehicleImageGalleryProps) => {
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  useEffect(() => {
    loadImages();
  }, [vehicleId]);

  const loadImages = async () => {
    try {
      let query = supabase
        .from('vehicle_images')
        .select(`
          id,
          image_url,
          description,
          uploaded_by,
          created_at,
          gps_latitude,
          gps_longitude
        `)
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      if (maxImages) {
        query = query.limit(maxImages);
      }

      const { data, error } = await query;

      if (!error && data) {
        setImages(data);
      }
    } catch (error) {
      console.error('Error loading vehicle images:', error);
    } finally {
      setLoading(false);
    }
  };

  const openLightbox = (index: number) => {
    setCurrentImageIndex(index);
    setLightboxOpen(true);
  };

  const goToNext = () => {
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };

  const goToPrev = () => {
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '40px',
        background: '#f8fafc',
        borderRadius: '8px',
        border: '2px dashed #d1d5db'
      }}>
        <span style={{ fontSize: '32px', display: 'block', marginBottom: '8px' }}>📸</span>
        <p className="text text-muted">No images uploaded yet</p>
      </div>
    );
  }

  const currentImage = images[currentImageIndex];

  return (
    <div className="vehicle-image-gallery">
      {showThumbnails && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: '8px',
          marginBottom: '16px'
        }}>
          {images.map((image, index) => (
            <div
              key={image.id}
              onClick={() => openLightbox(index)}
              style={{
                aspectRatio: '1',
                borderRadius: '8px',
                overflow: 'hidden',
                cursor: 'pointer',
                border: '1px solid #e5e7eb',
                background: `url(${image.image_url}) center/cover`,
                position: 'relative',
                transition: 'transform 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              {/* Image overlay with info */}
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                color: 'white',
                padding: '4px',
                fontSize: '10px'
              }}>
                {new Date(image.created_at).toLocaleDateString()}
              </div>

              {/* Tag indicator */}
              <div style={{
                position: 'absolute',
                top: '4px',
                right: '4px',
                background: 'rgba(59, 130, 246, 0.8)',
                color: 'white',
                borderRadius: '12px',
                padding: '2px 6px',
                fontSize: '10px',
                fontWeight: 'bold'
              }}>
                🏷️ Tag
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Image Lightbox */}
      {currentImage && (
        <ImageLightbox
          imageUrl={currentImage.image_url}
          imageId={currentImage.id}
          vehicleId={vehicleId}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          onNext={images.length > 1 ? goToNext : undefined}
          onPrev={images.length > 1 ? goToPrev : undefined}
          title={`Vehicle Image ${currentImageIndex + 1} of ${images.length}`}
          description={currentImage.description || `Uploaded ${new Date(currentImage.created_at).toLocaleDateString()}`}
          canEdit={true}
        />
      )}

      {/* Image Counter */}
      {images.length > 1 && (
        <div style={{
          textAlign: 'center',
          marginTop: '8px',
          fontSize: '14px',
          color: '#6b7280'
        }}>
          {images.length} image{images.length !== 1 ? 's' : ''} • Click to view and tag
        </div>
      )}
    </div>
  );
};

export default VehicleImageGallery;