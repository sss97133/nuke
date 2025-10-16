import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import LazyImage from './LazyImage';
import { imageOptimizationService } from '../services/imageOptimizationService';
// import exifr from 'exifr'; // Lazy loaded to prevent build issues

interface ImageData {
  id: string;
  image_url: string;
  is_primary?: boolean;
  storage_path?: string;
  thumbnail_url?: string;
  medium_url?: string;
  large_url?: string;
}

interface SimpleImageViewerProps {
  vehicleId: string;
  onImageUpdate?: () => void;
}

const SimpleImageViewer: React.FC<SimpleImageViewerProps> = ({
  vehicleId,
  onImageUpdate
}) => {
  const [images, setImages] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [settingLead, setSettingLead] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // sorting / organization
  const [sortMode, setSortMode] = useState<'newest' | 'oldest' | 'by_day'>('newest');

  // Listen for image updates from upload components
  useEffect(() => {
    const handleImageUpdate = (event: CustomEvent) => {
      if (event.detail?.vehicleId === vehicleId) {
        loadImages();
      }
    };

    window.addEventListener('vehicle_images_updated', handleImageUpdate as EventListener);
    return () => {
      window.removeEventListener('vehicle_images_updated', handleImageUpdate as EventListener);
    };
  }, [vehicleId]);

  // Load images on mount and when vehicleId changes
  useEffect(() => {
    loadImages();
  }, [vehicleId]);

  const loadImages = async () => {
    if (!vehicleId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('id, image_url, is_primary, storage_path, created_at, thumbnail_url, medium_url, large_url')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const rows = data || [];
      
      // Fast loading: Use existing image_url directly (they're already public URLs)
      // Only generate signed URLs if absolutely necessary
      const mapped: ImageData[] = rows.map((row: any) => {
        // If image_url exists and looks like a valid URL, use it directly
        if (row.image_url && (row.image_url.startsWith('http') || row.image_url.startsWith('/'))) {
          return row as ImageData;
        }
        
        // Fallback: if no valid image_url, skip for now (can be lazy-loaded later)
        return { ...row, image_url: '' } as ImageData;
      }).filter(img => img.image_url); // Remove empty URLs
      
      console.log('🖼️ IMAGE DEBUG:', {
        vehicleId,
        totalRows: rows.length,
        validImages: mapped.length,
        imageUrls: mapped.map(img => img.image_url)
      });
      
      setImages(mapped);
    } catch (error) {
      console.error('Failed to load images:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadImages();
  }, [vehicleId]);

  const handleImageUpload = async (files: FileList) => {
    if (!files || files.length === 0) return;
    
    setUploading(true);
    try {
      const uploadedPaths: string[] = [];
      // Track counts per date (yyyy-mm-dd) from EXIF, fallback to file.lastModified
      const dateCounts: Record<string, number> = {};
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = `${Date.now()}_${i}_${file.name}`;

        // Generate optimized variants
        const optimization = await imageOptimizationService.generateVariants(file);
        let thumbnailUrl, mediumUrl, largeUrl;
        
        if (optimization.success && optimization.variants) {
          const { urls } = await imageOptimizationService.uploadVariants(
            vehicleId,
            fileName,
            optimization.variants
          );
          thumbnailUrl = urls.thumbnail;
          mediumUrl = urls.medium;
          largeUrl = urls.large;
        }
        
        // Extract EXIF date for timeline grouping (NO FALLBACK)
        let dateStr: string | null = null;
        let orientation: number | undefined;
        try {
          const exif = await exifr.parse(file, { exif: true, tiff: true });
          const dt: any = (exif as any)?.DateTimeOriginal || (exif as any)?.CreateDate || (exif as any)?.ModifyDate;
          if (dt instanceof Date && !isNaN(dt.getTime())) {
            dateStr = dt.toISOString().slice(0, 10);
          }
          orientation = (exif as any)?.Orientation;
        } catch {}
        // Only count images that truly have an EXIF-derived date
        if (dateStr) {
          dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
        }

        // Upload original
        const filePath = `vehicles/${vehicleId}/images/${fileName}`;
        const { error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(filePath, file);
        
        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('vehicle-data')
            .getPublicUrl(filePath);
          
          await supabase
            .from('vehicle_images')
            .insert({
              vehicle_id: vehicleId,
              image_url: urlData.publicUrl,
              storage_path: filePath,
              thumbnail_url: thumbnailUrl,
              medium_url: mediumUrl,
              large_url: largeUrl,
              filename: file.name,
              mime_type: file.type,
              file_size: file.size,
              category: 'general',
              is_primary: images.length === 0,
              optimization_status: optimization.success ? 'completed' : 'failed',
              exif_data: dateStr ? { dateTaken: dateStr, orientation: orientation || null } : { orientation: orientation || null }
            });

          uploadedPaths.push(filePath);
        }
      }
      
      await loadImages();
      if (onImageUpdate) onImageUpdate();

      // Dispatch global events so VehicleProfile/Timeline react immediately
      try {
        const { data: authData } = await supabase.auth.getUser();
        const userId = authData.user?.id || null;
        const totalDated = Object.values(dateCounts).reduce((a, b) => a + b, 0);
        if (totalDated > 0) {
          // Create one event per date bucket
          const entries = Object.entries(dateCounts);
          const createdDates: string[] = [];
          for (const [date, cnt] of entries) {
            const { error: eventErr } = await supabase
              .from('timeline_events')
              .insert({
                vehicle_id: vehicleId,
                user_id: userId,
                event_type: 'batch_image_upload',
                event_date: date,
                title: `${cnt} Photo${cnt === 1 ? '' : 's'} Added`,
                description: `Batch upload of ${cnt} image${cnt === 1 ? '' : 's'} via SimpleImageViewer`,
                metadata: { source: 'SimpleImageViewer', count: cnt }
              });
            if (eventErr) {
              console.warn('SimpleImageViewer: timeline event insert failed:', eventErr.message);
            } else {
              createdDates.push(date);
            }
          }

          window.dispatchEvent(new CustomEvent('vehicle_images_updated', { detail: { vehicleId } } as any));
          window.dispatchEvent(new CustomEvent('timeline_updated', { detail: { vehicleId } } as any));
          window.dispatchEvent(new CustomEvent('timeline_events_created', { detail: { vehicleId, count: totalDated, dates: createdDates } } as any));
        }
      } catch (e) {
        // Non-critical
        console.debug('SimpleImageViewer: post-upload propagation failed (non-critical):', e);
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  const setAsLead = async (imageId: string) => {
    setSettingLead(imageId);
    try {
      await supabase
        .from('vehicle_images')
        .update({ is_primary: false })
        .eq('vehicle_id', vehicleId)
        .eq('is_primary', true);

      const { error } = await supabase
        .from('vehicle_images')
        .update({ is_primary: true })
        .eq('id', imageId);

      if (error) throw error;
      await loadImages();
      if (onImageUpdate) onImageUpdate();
      
      // Emit lead image update event
      window.dispatchEvent(new CustomEvent('lead_image_updated', { 
        detail: { vehicleId } 
      } as any));
    } catch (error) {
      console.error('Failed to set lead image:', error);
    } finally {
      setSettingLead(null);
    }
  };

  const deleteImage = async (imageId: string, storagePath?: string) => {
    try {
      if (storagePath) {
        await supabase.storage
          .from('vehicle-data')
          .remove([storagePath]);
      }
      
      await supabase
        .from('vehicle_images')
        .delete()
        .eq('id', imageId);
        
      await loadImages();
      if (onImageUpdate) onImageUpdate();
    } catch (error) {
      console.error('Failed to delete image:', error);
    }
  };

  const openImage = (image: ImageData) => {
    setSelectedImage(image);
  };

  const closeImage = () => {
    setSelectedImage(null);
  };

  const navigateImage = (direction: 'prev' | 'next') => {
    if (!selectedImage) return;
    
    const currentIndex = images.findIndex(img => img.id === selectedImage.id);
    let newIndex;
    
    if (direction === 'prev') {
      newIndex = currentIndex > 0 ? currentIndex - 1 : images.length - 1;
    } else {
      newIndex = currentIndex < images.length - 1 ? currentIndex + 1 : 0;
    }
    
    setSelectedImage(images[newIndex]);
  };

  // Keyboard shortcuts in modal
  useEffect(() => {
    if (!selectedImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeImage();
      if (e.key === 'ArrowLeft') navigateImage('prev');
      if (e.key === 'ArrowRight') navigateImage('next');
      if (e.key.toLowerCase() === 'l') {
        if (!selectedImage.is_primary) setAsLead(selectedImage.id);
      }
      if (e.key === 'Delete') {
        deleteImage(selectedImage.id, selectedImage.storage_path);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedImage, images]);

  const copyLink = async (url: string) => {
    try { await navigator.clipboard.writeText(url); } catch {}
  };

  if (loading) {
    return <div className="text" style={{ padding: '8px', color: '#424242' }}>Loading...</div>;
  }

  return (
    <div>
      {images.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: '#666', fontWeight: 'bold' }}>
            {images.length} image{images.length !== 1 ? 's' : ''} • {sortMode === 'newest' ? 'Newest first' : sortMode === 'oldest' ? 'Oldest first' : 'Grouped by day'} • Lead: {images.find(img => img.is_primary)?.id ? 'Set' : 'None'}
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="button" style={{ fontSize: '10px', padding: '4px 8px', border: sortMode === 'newest' ? '2px solid #000' : '1px solid #ccc' }} onClick={() => setSortMode('newest')}>Newest</button>
            <button className="button" style={{ fontSize: '10px', padding: '4px 8px', border: sortMode === 'oldest' ? '2px solid #000' : '1px solid #ccc' }} onClick={() => setSortMode('oldest')}>Oldest</button>
            <button className="button" style={{ fontSize: '10px', padding: '4px 8px', border: sortMode === 'by_day' ? '2px solid #000' : '1px solid #ccc' }} onClick={() => setSortMode('by_day')}>By day</button>
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={(e) => e.target.files && handleImageUpload(e.target.files)} style={{ display: 'none' }} />

      {sortMode !== 'by_day' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
          {[...images]
            .sort((a: any, b: any) => {
              const ca = (a as any).created_at ? new Date((a as any).created_at).getTime() : 0;
              const cb = (b as any).created_at ? new Date((b as any).created_at).getTime() : 0;
              return sortMode === 'newest' ? cb - ca : ca - cb;
            })
            .map((image) => (
              <div key={image.id} className="group" style={{ position: 'relative', aspectRatio: '4/3', border: image.is_primary ? '3px solid #000000' : '1px solid #e0e0e0', borderRadius: '4px', overflow: 'hidden', cursor: 'pointer' }}>
                <LazyImage
                  src={image.image_url}
                  thumbnailUrl={image.thumbnail_url}
                  mediumUrl={image.medium_url}
                  largeUrl={image.large_url}
                  alt=""
                  size="thumbnail"
                  style={{ width: '100%', height: '100%' }}
                  onClick={() => openImage(image)}
                />
              </div>
            ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {Object.entries(images.reduce((acc: Record<string, ImageData[]>, img: any) => {
            const dateStr = img.created_at ? new Date(img.created_at).toISOString().slice(0, 10) : 'unknown';
            if (!acc[dateStr]) acc[dateStr] = [];
            acc[dateStr].push(img);
            return acc;
          }, {}))
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, imgs]) => (
              <div key={date}>
                <div style={{ fontSize: '11px', color: '#444', fontWeight: 700, margin: '4px 0' }}>{date} • {(imgs as ImageData[]).length} image{(imgs as ImageData[]).length !== 1 ? 's' : ''}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
                  {(imgs as ImageData[])
                    .sort((a: any, b: any) => {
                      const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
                      const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
                      return cb - ca;
                    })
                    .map((image) => (
                      <div key={image.id} className="group" style={{ position: 'relative', aspectRatio: '4/3', border: image.is_primary ? '3px solid #000000' : '1px solid #e0e0e0', borderRadius: '4px', overflow: 'hidden', cursor: 'pointer' }}>
                        <LazyImage
                          src={image.image_url}
                          thumbnailUrl={image.thumbnail_url}
                          mediumUrl={image.medium_url}
                          largeUrl={image.large_url}
                          alt=""
                          size="thumbnail"
                          style={{ width: '100%', height: '100%' }}
                          onClick={() => openImage(image)}
                        />
                      </div>
                    ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {selectedImage && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={closeImage}>
          <img src={selectedImage.large_url || selectedImage.image_url} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', cursor: 'zoom-out' }} onClick={(e) => e.stopPropagation()} />
          {images.length > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); navigateImage('prev'); }} style={{ position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.3)', color: 'white', fontSize: '20px', padding: '12px 16px', cursor: 'pointer', borderRadius: '4px' }}>‹</button>
              <button onClick={(e) => { e.stopPropagation(); navigateImage('next'); }} style={{ position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.3)', color: 'white', fontSize: '20px', padding: '12px 16px', cursor: 'pointer', borderRadius: '4px' }}>›</button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SimpleImageViewer;
