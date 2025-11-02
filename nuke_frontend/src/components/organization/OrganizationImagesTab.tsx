import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { extractImageMetadata } from '../../utils/imageMetadata';
import ImageLightbox from '../image/ImageLightbox';

interface OrgImage {
  id: string;
  organization_id: string;
  user_id: string;
  image_url: string;
  thumbnail_url?: string;
  medium_url?: string;
  category?: string;
  caption?: string;
  is_primary: boolean;
  taken_at?: string;
  latitude?: number;
  longitude?: number;
  created_at: string;
}

interface Props {
  organizationId: string;
  userId: string | null;
  canEdit: boolean;
}

const OrganizationImagesTab: React.FC<Props> = ({ organizationId, userId, canEdit }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [images, setImages] = useState<OrgImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<OrgImage | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    loadImages();
  }, [organizationId]);

  const loadImages = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('organization_images')
        .select(`
          id,
          organization_id,
          user_id,
          image_url,
          thumbnail_url,
          medium_url,
          category,
          caption,
          is_primary,
          taken_at,
          latitude,
          longitude,
          created_at
        `)
        .eq('organization_id', organizationId)
        .order('taken_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setImages(data || []);
    } catch (error) {
      console.error('Failed to load images:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploading(true);
    try {
      for (const file of files) {
        // Extract EXIF metadata
        const metadata = await extractImageMetadata(file);
        console.log('Extracted EXIF for org image:', metadata);

        // Upload to Supabase Storage
        const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(`organization-data/${organizationId}/images/${fileName}`, file);

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-data')
          .getPublicUrl(uploadData.path);

        // Insert image record
        const { error: insertError } = await supabase
          .from('organization_images')
          .insert({
            organization_id: organizationId,
            user_id: userId,
            image_url: publicUrl,
            category: 'facility',
            taken_at: metadata.dateTaken?.toISOString(),
            latitude: metadata.location?.latitude,
            longitude: metadata.location?.longitude,
            exif_data: {
              camera: metadata.camera,
              technical: metadata.technical,
              location: metadata.location
            }
          });

        if (insertError) throw insertError;
      }

      await loadImages();
      alert(`Uploaded ${files.length} image(s) successfully!`);
    } catch (error: any) {
      console.error('Upload failed:', error);
      alert('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    if (!canEdit) {
      alert('You do not have permission to set primary image');
      return;
    }

    try {
      // Clear all primary flags
      await supabase
        .from('organization_images')
        .update({ is_primary: false })
        .eq('organization_id', organizationId);

      // Set new primary
      const { error } = await supabase
        .from('organization_images')
        .update({ is_primary: true })
        .eq('id', imageId);

      if (error) throw error;

      await loadImages();
    } catch (error: any) {
      alert('Failed to set primary: ' + error.message);
    }
  };

  const handleDelete = async (imageId: string, imageUserId: string) => {
    const canDelete = userId === imageUserId || canEdit;
    if (!canDelete) {
      alert('You can only delete your own images');
      return;
    }

    if (!confirm('Delete this image?')) return;

    try {
      const { error } = await supabase
        .from('organization_images')
        .delete()
        .eq('id', imageId);

      if (error) throw error;

      setImages(images.filter(img => img.id !== imageId));
      if (selectedImage?.id === imageId) {
        setLightboxOpen(false);
        setSelectedImage(null);
      }
    } catch (error: any) {
      alert('Failed to delete: ' + error.message);
    }
  };

  const openLightbox = (image: OrgImage) => {
    setSelectedImage(image);
    setLightboxOpen(true);
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontSize: '9pt', color: 'var(--text-muted)' }}>
        Loading images...
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      {/* Upload Section */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
          Upload Images
        </div>
        <div className="card-body">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !userId}
            className="button button-primary"
            style={{ fontSize: '9pt', width: '100%' }}
          >
            {uploading ? 'Uploading...' : 'Choose Images'}
          </button>
          
          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center' }}>
            Supports JPG, PNG, HEIC. GPS and date extracted automatically.
          </div>
        </div>
      </div>

      {/* Image Grid */}
      {images.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{
            textAlign: 'center',
            padding: '40px',
            color: 'var(--text-muted)',
            fontSize: '9pt'
          }}>
            <div style={{ marginBottom: '8px', fontSize: '11pt', fontWeight: 600 }}>
              No images yet
            </div>
            <div>
              Upload photos of your facility, team, or work
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '12px'
        }}>
          {images.map(img => (
            <div
              key={img.id}
              style={{
                position: 'relative',
                aspectRatio: '1',
                backgroundImage: `url(${img.thumbnail_url || img.medium_url || img.image_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                border: img.is_primary ? '3px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: '4px',
                cursor: 'pointer',
                overflow: 'hidden'
              }}
              onClick={() => openLightbox(img)}
            >
              {/* Primary Badge */}
              {img.is_primary && (
                <div style={{
                  position: 'absolute',
                  top: '6px',
                  left: '6px',
                  padding: '3px 6px',
                  background: 'var(--accent)',
                  color: 'white',
                  fontSize: '7pt',
                  fontWeight: 700,
                  borderRadius: '3px'
                }}>
                  PRIMARY
                </div>
              )}

              {/* Date Badge */}
              {img.taken_at && (
                <div style={{
                  position: 'absolute',
                  bottom: '6px',
                  right: '6px',
                  padding: '3px 6px',
                  background: 'rgba(0, 0, 0, 0.7)',
                  backdropFilter: 'blur(5px)',
                  color: 'white',
                  fontSize: '7pt',
                  borderRadius: '3px'
                }}>
                  {new Date(img.taken_at).toLocaleDateString()}
                </div>
              )}

              {/* GPS Badge */}
              {img.latitude && img.longitude && (
                <div style={{
                  position: 'absolute',
                  top: '6px',
                  right: '6px',
                  padding: '3px 6px',
                  background: 'rgba(0, 150, 0, 0.8)',
                  color: 'white',
                  fontSize: '7pt',
                  fontWeight: 700,
                  borderRadius: '3px'
                }}>
                  GPS
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxOpen && selectedImage && (
        <ImageLightbox
          imageUrl={selectedImage.medium_url || selectedImage.image_url}
          onClose={() => {
            setLightboxOpen(false);
            setSelectedImage(null);
          }}
          vehicleId={null}
          organizationId={organizationId}
          imageId={selectedImage.id}
        />
      )}
    </div>
  );
};

export default OrganizationImagesTab;

