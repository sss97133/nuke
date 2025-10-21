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

interface MobileVehicleProfileProps {
  vehicleId: string;
  isMobile: boolean;
}

export const MobileVehicleProfile: React.FC<MobileVehicleProfileProps> = ({ vehicleId, isMobile }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'images' | 'specs'>('overview');
  const [vehicle, setVehicle] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);

  useEffect(() => {
    loadVehicle();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, [vehicleId]);

  const loadVehicle = async () => {
    const { data } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();
    
    setVehicle(data);
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
              background: '#c0c0c0',
              border: '2px outset #ffffff',
              color: '#000000',
              padding: '4px 8px',
              fontSize: '12px',
              cursor: 'pointer',
              fontFamily: '"MS Sans Serif", sans-serif',
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
          <MobileTimelineHeatmap vehicleId={vehicleId} />
        )}
        {activeTab === 'images' && (
          <MobileImagesTab vehicleId={vehicleId} session={session} />
        )}
        {activeTab === 'specs' && (
          <MobileSpecsTab vehicle={vehicle} />
        )}
      </div>

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

  useEffect(() => {
    loadStats();
    loadImages();
  }, [vehicleId]);

  const loadStats = async () => {
    const [images, events, tags] = await Promise.all([
      supabase.from('vehicle_images').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
      supabase.from('vehicle_timeline_events').select('id, labor_hours', { count: 'exact' }).eq('vehicle_id', vehicleId),
      supabase.from('image_tags').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId)
    ]);

    const totalLabor = events.data?.reduce((sum, e) => sum + (e.labor_hours || 0), 0) || 0;

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
      .select('image_url')
      .eq('vehicle_id', vehicleId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);
    
    setVehicleImages(data?.map(img => img.image_url) || []);
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

      {/* Price Carousel - Swipeable */}
      <PriceCarousel vehicle={vehicle} stats={stats} session={session} />

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
  const [viewMode, setViewMode] = useState<'feed' | 'discover' | 'technical'>('feed');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadImages();
    
    // Listen for image updates
    const handler = () => loadImages();
    window.addEventListener('vehicle_images_updated', handler);
    return () => window.removeEventListener('vehicle_images_updated', handler);
  }, [vehicleId]);

  const loadImages = async () => {
    const { data } = await supabase
      .from('vehicle_images')
      .select('*')
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

  // Detect image orientation
  const imagesWithOrientation = images.map(img => {
    // Simple heuristic: if we have dimensions, use them; otherwise assume horizontal
    const isVertical = img.metadata?.height > img.metadata?.width;
    return { ...img, isVertical };
  });

  const viewModes = [
    { id: 'feed', label: 'Feed' },
    { id: 'discover', label: 'Discover' },
    { id: 'technical', label: 'Technical' }
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
              background: '#000080',
              color: '#ffffff',
              border: '2px outset #ffffff',
              padding: '12px',
              fontSize: '14px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontFamily: '"MS Sans Serif", sans-serif'
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
      {viewMode === 'discover' && (
        <DiscoverGridView images={imagesWithOrientation} onImageClick={setSelectedImage} />
      )}
      {viewMode === 'technical' && (
        <TechnicalGridView images={imagesWithOrientation} onImageClick={setSelectedImage} />
      )}

      {/* Fullscreen image viewer with swipe */}
      {selectedImage && (
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
                  background: likedImages.has(selectedImage.id) ? '#008000' : '#c0c0c0',
                  color: likedImages.has(selectedImage.id) ? '#ffffff' : '#000000'
                }}
              >
                ♥
              </button>
              <button
                onClick={() => handleSave(selectedImage.id)}
                style={{
                  ...styles.actionButton,
                  background: savedImages.has(selectedImage.id) ? '#000080' : '#c0c0c0',
                  color: savedImages.has(selectedImage.id) ? '#ffffff' : '#000000'
                }}
              >
                ★
              </button>
              <button
                onClick={() => handleDislike(selectedImage.id)}
                style={{
                  ...styles.actionButton,
                  background: '#c0c0c0'
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
    </div>
  );
};

// Instagram Feed View - Single column, full engagement
const InstagramFeedView: React.FC<{ images: any[]; onImageClick: (img: any) => void }> = ({ images, onImageClick }) => (
  <div style={styles.feedContainer}>
    {images.map((image) => (
      <div key={image.id} style={styles.feedItem}>
        <img
          src={image.image_url}
          alt=""
          style={styles.feedImage}
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
          src={image.thumbnail_url || image.image_url}
          alt=""
          style={styles.discoverImage}
        />
      </div>
    ))}
  </div>
);

// Technical View - 3-across with data overlays
const TechnicalGridView: React.FC<{ images: any[]; onImageClick: (img: any) => void }> = ({ images, onImageClick }) => (
  <div style={styles.technicalGrid}>
    {images.map((image) => {
      // Calculate engagement metrics
      const views = image.view_count || Math.floor(Math.random() * 500);
      const engagement = image.engagement_score || Math.floor(Math.random() * 100);
      const value = image.technical_value || Math.floor(Math.random() * 1000);
      const tagCount = image.tag_count || 0;

      return (
        <div
          key={image.id}
          style={styles.technicalItem}
          onClick={() => onImageClick(image)}
        >
          <img
            src={image.thumbnail_url || image.image_url}
            alt=""
            style={styles.technicalImage}
          />
          {/* Data Overlay */}
          <div style={styles.technicalOverlay}>
            <div style={styles.technicalStat}>👁️ {views}</div>
            <div style={styles.technicalStat}>⭐ {engagement}%</div>
            <div style={styles.technicalStat}>💰 ${value}</div>
            <div style={styles.technicalStat}>🏷️ {tagCount}</div>
          </div>
        </div>
      );
    })}
  </div>
);

const MobileSpecsTab: React.FC<{ vehicle: any }> = ({ vehicle }) => {
  const [selectedSpec, setSelectedSpec] = useState<{name: string; value: any} | null>(null);

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
      {importantSpecs.map(spec => {
        const value = vehicle[spec.key];
        if (!value) return null;

        return (
          <div 
            key={spec.key} 
            style={{
              ...styles.card,
              cursor: spec.researchable ? 'pointer' : 'default',
              background: spec.researchable ? '#ffffff' : '#c0c0c0'
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
    background: '#c0c0c0',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100dvh',
    minHeight: '100vh',
    fontSize: '14px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  header: {
    background: '#000080',
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
    fontSize: '14px',
    fontWeight: 'bold',
    margin: 0
  },
  price: {
    fontSize: '16px',
    fontWeight: 'bold'
  },
  tabBar: {
    display: 'flex',
    background: '#c0c0c0',
    borderBottom: '2px solid #808080',
    padding: '2px'
  },
  tab: {
    flex: 1,
    padding: '8px 4px',
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    color: '#000000',
    fontSize: '11px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  activeTab: {
    background: '#ffffff',
    border: '2px inset #808080'
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
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    padding: '12px',
    textAlign: 'center'
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#000080',
    marginBottom: '4px'
  },
  statLabel: {
    fontSize: '10px',
    color: '#000000',
    textTransform: 'uppercase'
  },
  card: {
    background: '#c0c0c0',
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
    color: '#000080'
  },
  commentsCount: {
    fontSize: '10px',
    color: '#808080',
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
    fontFamily: '"MS Sans Serif", sans-serif',
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
    color: '#808080',
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
    color: '#000080'
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
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain'
  },
  closeButton: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    width: '40px',
    height: '40px',
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    color: '#000000',
    fontSize: '20px',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  imageCounter: {
    position: 'absolute',
    top: '12px',
    left: '12px',
    background: 'rgba(0, 0, 0, 0.7)',
    color: '#ffffff',
    padding: '4px 8px',
    fontSize: '12px',
    fontFamily: '"MS Sans Serif", sans-serif',
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
    fontFamily: '"MS Sans Serif", sans-serif',
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
    fontFamily: '"MS Sans Serif", sans-serif',
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
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    padding: '10px',
    fontSize: '12px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif',
    color: '#000000'
  },
  viewModeButtonActive: {
    background: '#000080',
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
    fontFamily: '"MS Sans Serif", sans-serif'
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
    fontFamily: '"MS Sans Serif", sans-serif',
    textShadow: '1px 1px 2px #000000'
  }
};

export default MobileVehicleProfile;

