/**
 * Mobile-Optimized Vehicle Profile
 * Responsive layout with swipe gestures and touch-friendly UI
 */

import React, { useState, useEffect } from 'react';
import { MobileImageControls } from '../image/MobileImageControls';
import { UserInteractionService } from '../../services/userInteractionService';
import { supabase } from '../../lib/supabase';
import EventDetailModal from './EventDetailModal';
import { MobileImageCarousel } from './MobileImageCarousel';
import { PriceCarousel } from './PriceCarousel';
import { MobileTimelineHeatmap } from './MobileTimelineHeatmap';
import SpecResearchModal from './SpecResearchModal';
import { EnhancedMobileImageViewer } from './EnhancedMobileImageViewer';
import { TimelinePhotosView } from './TimelinePhotosView';
import { MobileDocumentUploader } from './MobileDocumentUploader';
import { MobilePriceEditor } from './MobilePriceEditor';
import { MobileCommentBox } from './MobileCommentBox';
import { MobileVehicleDataEditor } from './MobileVehicleDataEditor';

interface MobileVehicleProfileProps {
  vehicleId: string;
  isMobile: boolean;
}

export const MobileVehicleProfile: React.FC<MobileVehicleProfileProps> = ({ vehicleId, isMobile }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'images' | 'specs'>('overview');
  const [vehicle, setVehicle] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [showDocUploader, setShowDocUploader] = useState(false);
  const [showPriceEditor, setShowPriceEditor] = useState(false);

  useEffect(() => {
    console.log('[MobileVehicleProfile] Component mounted, isMobile:', isMobile);
    loadVehicle();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, [vehicleId]);

  useEffect(() => {
    console.log('[MobileVehicleProfile] Active tab changed to:', activeTab);
  }, [activeTab]);

  const loadVehicle = async () => {
    const { data } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();
    
    setVehicle(data);
  };

  const handleQuickUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!session?.user?.id) {
      alert('Please log in to upload images');
      return;
    }

    setUploading(true);
    
    try {
      const { ImageUploadService } = await import('../../services/imageUploadService');
      
      for (let i = 0; i < files.length; i++) {
        const result = await ImageUploadService.uploadImage(vehicleId, files[i], 'general');
        if (!result.success) {
          console.error('Upload failed:', result.error);
          alert(`Upload failed: ${result.error}`);
        }
      }
      
      // Trigger refresh on images tab
      window.dispatchEvent(new Event('vehicle_images_updated'));
      
      // Show success message
      alert(`✓ ${files.length} photo${files.length > 1 ? 's' : ''} uploaded successfully!`);
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  if (!isMobile) {
    return null; // Use desktop version
  }

  if (!vehicle) {
    return <div style={styles.loading}>Loading...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Mobile Header - Sticky */}
      <div style={styles.header}>
        <div style={styles.headerContent}>
          <button
            onClick={() => window.history.back()}
            style={{
              background: '#e0e0e0',
              border: '2px outset #ffffff',
              color: '#000000',
              padding: '4px 8px',
              fontSize: '12px',
              cursor: 'pointer',
              fontFamily: 'Arial, sans-serif',
              marginRight: '8px'
            }}
          >
            ← Back
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={styles.title}>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h1>
          </div>
        </div>
      </div>

      {/* Tab Bar - Sticky */}
      <div style={styles.tabBar}>
        {['overview', 'timeline', 'images', 'specs'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            style={{
              ...styles.tab,
              ...(activeTab === tab ? styles.activeTab : {})
            }}
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Scrollable Content */}
      <div style={styles.content}>
        {activeTab === 'overview' && (
          <MobileOverviewTab vehicleId={vehicleId} vehicle={vehicle} onTabChange={setActiveTab} session={session} />
        )}
        {activeTab === 'timeline' && (
          <div>
            <MobileTimelineHeatmap vehicleId={vehicleId} />
            <MobileCommentBox vehicleId={vehicleId} session={session} targetType="vehicle" />
          </div>
        )}
        {activeTab === 'images' && (
          <MobileImagesTab vehicleId={vehicleId} session={session} />
        )}
        {activeTab === 'specs' && (
          <MobileSpecsTab vehicle={vehicle} session={session} vehicleId={vehicleId} />
        )}
      </div>

      {/* Floating Action Button (FAB) for Camera - Always visible when logged in */}
      {session?.user && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => handleQuickUpload(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              position: 'fixed',
              bottom: '24px',
              right: '24px',
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: uploading ? '#bdbdbd' : '#0066cc',
              color: '#ffffff',
              border: '3px outset #ffffff',
              fontSize: '28px',
              cursor: uploading ? 'wait' : 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'Arial, sans-serif',
              transition: 'transform 0.2s',
              WebkitTapHighlightColor: 'transparent'
            }}
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.95)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
            title="Take photo"
          >
            {uploading ? '⏳' : '📷'}
          </button>
        </>
      )}

      {/* Event Detail Modal */}
      {selectedEvent && (
        <EventDetailModal 
          event={selectedEvent} 
          onClose={() => setSelectedEvent(null)} 
        />
      )}
    </div>
  );
};

const MobileOverviewTab: React.FC<{ vehicleId: string; vehicle: any; onTabChange: (tab: string) => void; session: any }> = ({ vehicleId, vehicle, onTabChange, session }) => {
  const [stats, setStats] = useState<any>(null);
  const [vehicleImages, setVehicleImages] = useState<string[]>([]);
  const [showPriceEditor, setShowPriceEditor] = useState(false);
  const [showDocUploader, setShowDocUploader] = useState(false);

  useEffect(() => {
    loadStats();
    loadImages();
  }, [vehicleId]);

  const loadStats = async () => {
    const [images, events, tags, workSessions] = await Promise.all([
      supabase.from('vehicle_images').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
      supabase.from('vehicle_timeline_events').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
      supabase.from('image_tags').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
      supabase.from('work_sessions').select('duration_minutes').eq('vehicle_id', vehicleId)
    ]);

    // Calculate total labor hours from work_sessions (duration is in minutes)
    const totalMinutes = workSessions.data?.reduce((sum, s) => sum + (s.duration_minutes || 0), 0) || 0;
    const totalLabor = Math.round(totalMinutes / 60);

    setStats({
      images: images.count || 0,
      events: events.count || 0,
      tags: tags.count || 0,
      labor_hours: totalLabor
    });
  };

  const loadImages = async () => {
    const { data } = await supabase
      .from('vehicle_images')
      .select('image_url, medium_url, large_url')
      .eq('vehicle_id', vehicleId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);
    
    // Use medium_url for mobile carousel (400px), fallback to large, then original
    setVehicleImages(data?.map(img => img.medium_url || img.large_url || img.image_url) || []);
  };

  return (
    <div style={styles.tabContent}>
      {/* Image Carousel */}
      {vehicleImages.length > 0 && (
        <MobileImageCarousel 
          images={vehicleImages}
          liveStreamUrl={vehicle.live_stream_url}
        />
      )}

      {/* Price Carousel - Now Clickable to Edit */}
      <div onClick={() => session?.user && setShowPriceEditor(true)} style={{ cursor: session?.user ? 'pointer' : 'default' }}>
        <PriceCarousel vehicle={vehicle} stats={stats} session={session} />
      </div>

      {/* Action Buttons (Owner Only) */}
      {session?.user && (
        <div style={styles.actionButtonsRow}>
          <button
            onClick={() => setShowPriceEditor(true)}
            style={styles.actionBtn}
          >
            💰 Edit Price
          </button>
          <button
            onClick={() => setShowDocUploader(true)}
            style={styles.actionBtn}
          >
            📄 Upload Doc
          </button>
        </div>
      )}

      {/* Modals */}
      {showPriceEditor && (
        <MobilePriceEditor
          vehicleId={vehicleId}
          initialData={vehicle}
          session={session}
          onClose={() => setShowPriceEditor(false)}
          onSaved={() => {
            setShowPriceEditor(false);
            window.location.reload(); // Refresh to show new prices
          }}
        />
      )}

      {showDocUploader && (
        <MobileDocumentUploader
          vehicleId={vehicleId}
          session={session}
          onClose={() => setShowDocUploader(false)}
          onSuccess={() => {
            setShowDocUploader(false);
            window.dispatchEvent(new Event('vehicle_documents_updated'));
          }}
        />
      )}

      {/* Comment Section */}
      <MobileCommentBox 
        vehicleId={vehicleId}
        session={session}
        targetType="vehicle"
      />
      
      {/* Quick Stats - Touch Friendly & Clickable */}
      <div style={styles.statsGrid}>
        <div style={{...styles.statCard, cursor: 'pointer'}} onClick={() => onTabChange('images')}>
          <div style={styles.statValue}>{stats?.images || 0}</div>
          <div style={styles.statLabel}>Photos</div>
        </div>
        <div style={{...styles.statCard, cursor: 'pointer'}} onClick={() => onTabChange('timeline')}>
          <div style={styles.statValue}>{stats?.events || 0}</div>
          <div style={styles.statLabel}>Events</div>
        </div>
        <div style={{...styles.statCard, cursor: 'pointer'}}>
          <div style={styles.statValue}>{stats?.tags || 0}</div>
          <div style={styles.statLabel}>Tags</div>
        </div>
        <div style={{...styles.statCard, cursor: 'pointer'}}>
          <div style={styles.statValue}>{stats?.labor_hours || 0}</div>
          <div style={styles.statLabel}>Hours</div>
        </div>
      </div>

      {/* Comments Section */}
      <div style={styles.commentsSection}>
        <div style={styles.commentsHeader}>
          <span style={styles.commentsTitle}>💬 Vehicle Comments</span>
          <span style={styles.commentsCount}>View all</span>
        </div>
        <div style={styles.commentInput}>
          <input 
            type="text" 
            placeholder="Add a comment about this vehicle..."
            style={styles.input}
          />
        </div>
      </div>

      {/* VIN */}
      {vehicle.vin && (
        <div style={styles.card}>
          <div style={styles.cardLabel}>VIN</div>
          <div style={styles.cardValue}>{vehicle.vin}</div>
        </div>
      )}

      {/* Mileage */}
      {vehicle.mileage && (
        <div style={styles.card}>
          <div style={styles.cardLabel}>Mileage</div>
          <div style={styles.cardValue}>{vehicle.mileage.toLocaleString()} miles</div>
        </div>
      )}
    </div>
  );
};

// Old MobileTimelineTab component removed - replaced by MobileTimelineHeatmap

const MobileImagesTab: React.FC<{ vehicleId: string; session: any }> = ({ vehicleId, session }) => {
  const [images, setImages] = useState<any[]>([]);
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [viewMode, setViewMode] = useState<'feed' | 'timeline' | 'discover'>('timeline');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadImages();
    
    // Listen for image updates
    const handler = () => loadImages();
    window.addEventListener('vehicle_images_updated', handler);
    
    // Listen for timeline image clicks to open in enhanced viewer
    const imageViewerHandler = (e: any) => {
      const { imageUrl, eventId, vehicleId: eventVehicleId } = e.detail;
      // Find the image in our list
      const image = images.find(img => img.image_url === imageUrl);
      if (image) {
        setSelectedImage(image);
      } else {
        // If not found, create a minimal image object
        setSelectedImage({
          id: `timeline-${eventId}`,
          image_url: imageUrl,
          vehicle_id: eventVehicleId,
          timeline_event_id: eventId
        });
      }
    };
    window.addEventListener('open_image_viewer', imageViewerHandler);
    
    return () => {
      window.removeEventListener('vehicle_images_updated', handler);
      window.removeEventListener('open_image_viewer', imageViewerHandler);
    };
  }, [vehicleId, images]);

  const loadImages = async () => {
    const { data } = await supabase
      .from('vehicle_images')
      .select(`
        *,
        timeline_events:timeline_event_id(
          id,
          title,
          event_date,
          cost_amount,
          duration_hours,
          description
        )
      `)
      .eq('vehicle_id', vehicleId)
      .order('taken_at', { ascending: false });

    setImages(data || []);
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!session?.user?.id) {
      alert('Please log in to upload images');
      return;
    }

    setUploading(true);
    
    try {
      const { ImageUploadService } = await import('../../services/imageUploadService');
      
      for (let i = 0; i < files.length; i++) {
        const result = await ImageUploadService.uploadImage(vehicleId, files[i], 'general');
        if (!result.success) {
          console.error('Upload failed:', result.error);
          alert(`Upload failed: ${result.error}`);
        }
      }
      
      // Refresh images
      await loadImages();
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const [likedImages, setLikedImages] = useState<Set<string>>(new Set());
  const [savedImages, setSavedImages] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadUserInteractions();
  }, [session]);

  const loadUserInteractions = async () => {
    if (session?.user) {
      const prefs = await UserInteractionService.getUserPreferences(session.user.id);
      setSavedImages(new Set(prefs.saved_images));
    }
  };

  const handleLike = async (imageId: string) => {
    if (session?.user) {
      await UserInteractionService.likeImage(session.user.id, imageId, vehicleId);
      setLikedImages(prev => new Set([...prev, imageId]));
    }
  };

  const handleSave = async (imageId: string) => {
    if (session?.user) {
      const success = await UserInteractionService.saveImage(session.user.id, imageId, vehicleId);
      if (success) {
        setSavedImages(prev => new Set([...prev, imageId]));
      }
    }
  };

  const handleDislike = async (imageId: string) => {
    if (session?.user) {
      await UserInteractionService.dislikeImage(session.user.id, imageId, vehicleId);
      // Remove from liked if it was liked
      setLikedImages(prev => {
        const updated = new Set(prev);
        updated.delete(imageId);
        return updated;
      });
    }
  };

  const handleDelete = async (imageId: string, image: any) => {
    if (!session?.user?.id) return;
    if (image.user_id !== session.user.id) {
      alert('You can only delete images you uploaded');
      return;
    }
    
    if (!confirm('Delete this image? This cannot be undone.')) return;
    
    try {
      // Delete from database (will cascade to storage via trigger or we handle it)
      const { error } = await supabase
        .from('vehicle_images')
        .delete()
        .eq('id', imageId);
      
      if (error) throw error;
      
      // Refresh images
      await loadImages();
      
      // Close viewer if this was the selected image
      if (selectedImage?.id === imageId) {
        setSelectedImage(null);
      }
      
      // Dispatch update event
      window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
        detail: { vehicleId }
      }));
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete image. Please try again.');
    }
  };

  // Detect image orientation
  const imagesWithOrientation = images.map(img => {
    // Simple heuristic: if we have dimensions, use them; otherwise assume horizontal
    const isVertical = img.metadata?.height > img.metadata?.width;
    return { ...img, isVertical };
  });

  const viewModes = [
    { id: 'feed', label: 'Feed' },
    { id: 'timeline', label: 'Timeline Photos' },
    { id: 'discover', label: 'Discover' }
  ];

  return (
    <div style={styles.tabContent}>
      {/* Upload Button - Only for logged in users */}
      {session?.user && (
        <div style={{ marginBottom: '12px' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => handleFileUpload(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              width: '100%',
              background: '#0066cc',
              color: '#ffffff',
              border: '2px outset #ffffff',
              padding: '12px',
              fontSize: '14px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontFamily: 'Arial, sans-serif'
            }}
          >
            {uploading ? 'Uploading...' : '📷 Add Photos'}
          </button>
        </div>
      )}

      {/* View Mode Selector */}
      <div style={styles.viewModeBar}>
        {viewModes.map(mode => (
          <button
            key={mode.id}
            onClick={() => setViewMode(mode.id as any)}
            style={{
              ...styles.viewModeButton,
              ...(viewMode === mode.id ? styles.viewModeButtonActive : {})
            }}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* Dynamic Layout Based on View Mode */}
      {viewMode === 'feed' && (
        <InstagramFeedView images={imagesWithOrientation} onImageClick={setSelectedImage} />
      )}
      {viewMode === 'timeline' && (
        <TimelinePhotosView images={images} onImageClick={setSelectedImage} session={session} />
      )}
      {viewMode === 'discover' && (
        <DiscoverGridView images={imagesWithOrientation} onImageClick={setSelectedImage} />
      )}

      {/* Enhanced fullscreen image viewer with gestures and context */}
      {selectedImage && (
        <EnhancedMobileImageViewer
          images={images}
          initialIndex={images.findIndex(img => img.id === selectedImage.id)}
          vehicleId={vehicleId}
          session={session}
          onClose={() => setSelectedImage(null)}
          onDelete={(imageId) => handleDelete(imageId, selectedImage)}
        />
      )}

      {/* OLD VIEWER - Keeping as fallback */}
      {false && selectedImage && (
        <MobileImageControls
          onSwipeLeft={() => {
            const idx = images.findIndex(i => i.id === selectedImage.id);
            if (idx < images.length - 1) setSelectedImage(images[idx + 1]);
          }}
          onSwipeRight={() => {
            const idx = images.findIndex(i => i.id === selectedImage.id);
            if (idx > 0) setSelectedImage(images[idx - 1]);
          }}
          onSwipeUp={() => handleSave(selectedImage.id)}
          onSwipeDown={() => setSelectedImage(null)}
          onDoubleTap={() => handleLike(selectedImage.id)}
          onLongPress={() => {
            // Show options menu
            console.log('Long press - show options');
          }}
        >
          <div style={styles.fullscreenImage}>
            <img
              src={selectedImage.large_url || selectedImage.image_url}
              alt=""
              style={styles.fullImage}
            />

            {/* Image counter */}
            <div style={styles.imageCounter}>
              {images.findIndex(i => i.id === selectedImage.id) + 1} / {images.length}
            </div>

            {/* Floating action buttons */}
            <div style={styles.floatingActions}>
              <button
                onClick={() => handleLike(selectedImage.id)}
                style={{
                  ...styles.actionButton,
                  background: likedImages.has(selectedImage.id) ? '#28a745' : '#e0e0e0',
                  color: likedImages.has(selectedImage.id) ? '#ffffff' : '#000000'
                }}
              >
                ♥
              </button>
              <button
                onClick={() => handleSave(selectedImage.id)}
                style={{
                  ...styles.actionButton,
                  background: savedImages.has(selectedImage.id) ? '#0066cc' : '#e0e0e0',
                  color: savedImages.has(selectedImage.id) ? '#ffffff' : '#000000'
                }}
              >
                ★
              </button>
              <button
                onClick={() => handleDislike(selectedImage.id)}
                style={{
                  ...styles.actionButton,
                  background: '#e0e0e0'
                }}
              >
                ✕
              </button>
            </div>

            {/* Gesture hints */}
            <div style={styles.gestureHints}>
              <div style={styles.hintText}>Double tap = Like • Swipe up = Save • Swipe down = Close</div>
            </div>

            {/* Close button */}
            <button
              onClick={() => setSelectedImage(null)}
              style={styles.closeButton}
            >
              ✕
            </button>
          </div>
        </MobileImageControls>
      )}

      {/* Comment Section for Images */}
      <MobileCommentBox 
        vehicleId={vehicleId}
        session={session}
        targetType="vehicle"
      />
    </div>
  );
};

// Instagram Feed View - Single column, full engagement
const InstagramFeedView: React.FC<{ images: any[]; onImageClick: (img: any) => void }> = ({ images, onImageClick }) => (
  <div style={styles.feedContainer}>
    {images.map((image) => (
      <div key={image.id} style={styles.feedItem}>
        <img
          src={image.medium_url || image.large_url || image.image_url}
          alt=""
          style={styles.feedImage}
          loading="lazy"
          onClick={() => onImageClick(image)}
        />
        <div style={styles.feedActions}>
          <button style={styles.feedActionButton}>❤️ Like</button>
          <button style={styles.feedActionButton}>💬 Comment</button>
        </div>
      </div>
    ))}
  </div>
);

// Discover View - 4-across masonry, verticals span 2 rows
const DiscoverGridView: React.FC<{ images: any[]; onImageClick: (img: any) => void }> = ({ images, onImageClick }) => (
  <div style={styles.discoverGrid}>
    {images.map((image) => (
      <div
        key={image.id}
        style={{
          ...styles.discoverItem,
          gridRowEnd: image.isVertical ? 'span 2' : 'span 1'
        }}
        onClick={() => onImageClick(image)}
      >
        <img
          src={image.thumbnail_url || image.medium_url || image.image_url}
          alt=""
          style={styles.discoverImage}
          loading="lazy"
        />
      </div>
    ))}
  </div>
);

// Technical View - 3-across with data overlays
const TechnicalGridView: React.FC<{ images: any[]; onImageClick: (img: any) => void }> = ({ images, onImageClick }) => (
  <div style={styles.technicalGrid}>
    {images.map((image) => {
      const views = image.view_count || 0;
      const engagement = image.engagement_score || 0;
      const value = image.technical_value || 0;
      const tagCount = image.tag_count || 0;

      return (
        <div
          key={image.id}
          style={styles.technicalItem}
          onClick={() => onImageClick(image)}
        >
        <img
          src={image.thumbnail_url || image.medium_url || image.image_url}
          alt=""
          style={styles.technicalImage}
          loading="lazy"
        />
          {/* Data Overlay */}
          <div style={styles.technicalOverlay}>
            {views > 0 && <div style={styles.technicalStat}>{views} views</div>}
            {engagement > 0 && <div style={styles.technicalStat}>{engagement}%</div>}
            {value > 0 && <div style={styles.technicalStat}>${value.toLocaleString()}</div>}
            {tagCount > 0 && <div style={styles.technicalStat}>{tagCount} tags</div>}
          </div>
        </div>
      );
    })}
  </div>
);

const MobileSpecsTab: React.FC<{ vehicle: any; session: any; vehicleId: string }> = ({ vehicle, session, vehicleId }) => {
  const [selectedSpec, setSelectedSpec] = useState<{name: string; value: any} | null>(null);
  const [showDataEditor, setShowDataEditor] = useState(false);

  const importantSpecs = [
    { key: 'year', label: 'Year', researchable: false },
    { key: 'make', label: 'Make', researchable: false },
    { key: 'model', label: 'Model', researchable: false },
    { key: 'vin', label: 'VIN', researchable: false },
    { key: 'engine', label: 'Engine', researchable: true },
    { key: 'transmission', label: 'Transmission', researchable: true },
    { key: 'drivetrain', label: 'Drivetrain', researchable: true },
    { key: 'axles', label: 'Axles', researchable: true },
    { key: 'suspension', label: 'Suspension', researchable: true },
    { key: 'tires', label: 'Tires', researchable: true },
    { key: 'mileage', label: 'Mileage', researchable: false }
  ];

  const handleSpecClick = (spec: any) => {
    if (spec.researchable) {
      setSelectedSpec({ name: spec.label, value: vehicle[spec.key] });
    }
  };

  return (
    <div style={styles.tabContent}>
      {/* Edit Button */}
      {session?.user && (
        <button
          onClick={() => setShowDataEditor(true)}
          style={{
            width: '100%',
            padding: '14px',
            background: '#0066cc',
            color: '#ffffff',
            border: '2px outset #ffffff',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontFamily: 'Arial, sans-serif',
            marginBottom: '12px'
          }}
        >
          ✏️ Edit Vehicle Data
        </button>
      )}

      {importantSpecs.map(spec => {
        const value = vehicle[spec.key];
        if (!value) return null;

        return (
          <div 
            key={spec.key} 
            style={{
              ...styles.card,
              cursor: spec.researchable ? 'pointer' : 'default',
              background: spec.researchable ? '#ffffff' : '#e0e0e0'
            }}
            onClick={() => handleSpecClick(spec)}
          >
            <div style={styles.cardLabel}>
              {spec.label}
              {spec.researchable && <span style={{ marginLeft: '6px', fontSize: '10px' }}>🔍</span>}
            </div>
            <div style={styles.cardValue}>{String(value)}</div>
          </div>
        );
      })}

      {/* AI Research Modal */}
      {selectedSpec && (
        <SpecResearchModal 
          vehicle={vehicle}
          spec={selectedSpec}
          onClose={() => setSelectedSpec(null)}
        />
      )}

      {/* Data Editor Modal */}
      {showDataEditor && (
        <MobileVehicleDataEditor
          vehicleId={vehicleId}
          vehicle={vehicle}
          session={session}
          onClose={() => setShowDataEditor(false)}
          onSaved={() => {
            setShowDataEditor(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
};

// Windows 95 Mobile Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    // Use dynamic viewport height to prevent iOS/Android toolbar jumps
    height: '100dvh',
    // Fallbacks for older browsers
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#e0e0e0', // var(--grey-200)
    fontFamily: 'Arial, sans-serif'
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100dvh',
    minHeight: '100vh',
    fontSize: '10px', // Design system standard
    fontFamily: 'Arial, sans-serif'
  },
  header: {
    background: '#0066cc', // Primary blue (better contrast than navy)
    color: '#ffffff',
    padding: '12px',
    borderBottom: '2px solid #ffffff'
  },
  headerContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  title: {
    fontSize: '10px', // Design system standard
    fontWeight: 'bold',
    margin: 0
  },
  price: {
    fontSize: '12px', // Slightly larger for importance
    fontWeight: 'bold'
  },
  tabBar: {
    display: 'flex',
    background: '#e0e0e0', // var(--grey-200)
    borderBottom: '2px solid #bdbdbd', // var(--border-medium)
    padding: '2px'
  },
  tab: {
    flex: 1,
    padding: '8px 4px',
    background: '#e0e0e0', // var(--grey-200)
    border: '2px outset #ffffff',
    color: '#000000',
    fontSize: '10px', // Design system standard
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif'
  },
  activeTab: {
    background: '#ffffff',
    border: '2px inset #bdbdbd' // var(--border-medium)
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
    background: '#ffffff'
  },
  tabContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
    marginBottom: '8px'
  },
  statCard: {
    background: '#e0e0e0',
    border: '2px outset #ffffff',
    padding: '12px',
    textAlign: 'center'
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#0066cc',
    marginBottom: '4px'
  },
  statLabel: {
    fontSize: '10px',
    color: '#000000',
    textTransform: 'uppercase'
  },
  card: {
    background: '#e0e0e0',
    border: '1px solid #808080',
    padding: '8px',
    marginBottom: '4px'
  },
  cardLabel: {
    fontSize: '9px',
    color: '#000000',
    marginBottom: '2px',
    fontWeight: 'bold'
  },
  cardValue: {
    fontSize: '12px',
    color: '#000000'
  },
  commentsSection: {
    background: '#ffffff',
    border: '2px solid #808080',
    borderRadius: '4px',
    padding: '12px',
    marginBottom: '12px'
  },
  commentsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  commentsTitle: {
    fontSize: '12px',
    fontWeight: 'bold' as const,
    color: '#0066cc'
  },
  commentsCount: {
    fontSize: '10px',
    color: '#bdbdbd',
    cursor: 'pointer'
  },
  commentInput: {
    width: '100%'
  },
  input: {
    width: '100%',
    padding: '8px',
    border: '1px inset #808080',
    fontSize: '12px',
    fontFamily: 'Arial, sans-serif',
    boxSizing: 'border-box' as const
  },
  eventCard: {
    background: '#ffffff',
    border: '1px solid #808080',
    padding: '12px',
    marginBottom: '8px'
  },
  eventDate: {
    fontSize: '10px',
    color: '#bdbdbd',
    marginBottom: '4px'
  },
  eventTitle: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: '4px'
  },
  eventMeta: {
    fontSize: '11px',
    color: '#0066cc'
  },
  imageGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '4px'
  },
  imageCard: {
    aspectRatio: '1',
    overflow: 'hidden',
    border: '1px solid #808080',
    cursor: 'pointer'
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  fullscreenImage: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: '#000000',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  fullImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const
  },
  closeButton: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    width: '40px',
    height: '40px',
    background: '#e0e0e0',
    border: '2px outset #ffffff',
    color: '#000000',
    fontSize: '20px',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif'
  },
  imageCounter: {
    position: 'absolute',
    top: '12px',
    left: '12px',
    background: 'rgba(0, 0, 0, 0.7)',
    color: '#ffffff',
    padding: '4px 8px',
    fontSize: '12px',
    fontFamily: 'Arial, sans-serif',
    borderRadius: '2px'
  },
  floatingActions: {
    position: 'absolute',
    bottom: '80px',
    right: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    zIndex: 10001
  },
  actionButton: {
    width: '48px',
    height: '48px',
    border: '2px outset #ffffff',
    fontSize: '20px',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
    transition: 'all 0.1s ease'
  },
  gestureHints: {
    position: 'absolute',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0, 0, 0, 0.8)',
    padding: '8px 12px',
    borderRadius: '4px'
  },
  hintText: {
    color: '#ffffff',
    fontSize: '11px',
    fontFamily: 'Arial, sans-serif',
    textAlign: 'center'
  },
  viewModeBar: {
    display: 'flex',
    gap: '6px',
    marginBottom: '12px',
    borderBottom: '2px solid #808080',
    paddingBottom: '8px'
  },
  viewModeButton: {
    flex: 1,
    background: '#e0e0e0',
    border: '2px outset #ffffff',
    padding: '10px',
    fontSize: '12px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
    color: '#000000'
  },
  viewModeButtonActive: {
    background: '#0066cc',
    color: '#ffffff',
    border: '2px inset #ffffff'
  },
  feedContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px'
  },
  feedItem: {
    background: '#ffffff',
    border: '2px solid #808080',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  feedImage: {
    width: '100%',
    height: '400px',
    objectFit: 'cover' as const,
    display: 'block',
    cursor: 'pointer'
  },
  feedActions: {
    display: 'flex',
    gap: '12px',
    padding: '12px',
    borderTop: '1px solid #d0d0d0'
  },
  feedActionButton: {
    background: 'transparent',
    border: 'none',
    fontSize: '14px',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif'
  },
  discoverGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gridAutoRows: '80px',
    gap: '4px'
  },
  discoverItem: {
    overflow: 'hidden',
    cursor: 'pointer',
    border: '1px solid #808080'
  },
  discoverImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const
  },
  technicalGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px'
  },
  technicalItem: {
    position: 'relative' as const,
    aspectRatio: '1',
    overflow: 'hidden',
    cursor: 'pointer',
    border: '2px solid #808080'
  },
  technicalImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const
  },
  technicalOverlay: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
    padding: '6px 4px 4px 4px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px'
  },
  technicalStat: {
    fontSize: '9px',
    color: '#ffffff',
    fontFamily: 'Arial, sans-serif',
    textShadow: '1px 1px 2px #000000'
  },
  actionButtonsRow: {
    display: 'flex',
    gap: '12px',
    marginTop: '12px',
    marginBottom: '12px'
  },
  actionBtn: {
    flex: 1,
    padding: '14px',
    background: '#0066cc',
    color: '#ffffff',
    border: '2px outset #ffffff',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
    transition: 'transform 0.1s'
  }
};

export default MobileVehicleProfile;

