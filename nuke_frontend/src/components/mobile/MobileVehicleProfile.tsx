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
import SpecResearchModal from './SpecResearchModal';
import { EnhancedMobileImageViewer } from './EnhancedMobileImageViewer';
import VehicleTimeline from '../VehicleTimeline';
import { MobileDocumentUploader } from './MobileDocumentUploader';
import { MobilePriceEditor } from './MobilePriceEditor';
import { MobileCommentBox } from './MobileCommentBox';
import { MobileVehicleDataEditor } from './MobileVehicleDataEditor';
import { useImageUpload } from '../../hooks/useImageUpload';
import { useVehiclePermissions } from '../../hooks/useVehiclePermissions';
import { MobileTradingPanel } from './MobileTradingPanel';
import InlineVINEditor from '../vehicle/InlineVINEditor';
import BaTURLDrop from '../vehicle/BaTURLDrop';
import ComprehensiveVehicleEditor from '../vehicle/ComprehensiveVehicleEditor';
import MobileBottomToolbar from './MobileBottomToolbar';

const FONT_BASE = '8pt';
const FONT_SMALL = '7pt';
const FONT_TINY = '6pt';

type VehicleTab = 'overview' | 'timeline' | 'images' | 'specs';

interface MobileVehicleProfileProps {
  vehicleId: string;
  isMobile: boolean;
}

export const MobileVehicleProfile: React.FC<MobileVehicleProfileProps> = ({ vehicleId, isMobile }) => {
  const [activeTab, setActiveTab] = useState<VehicleTab>('overview');
  const [vehicle, setVehicle] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [showDocUploader, setShowDocUploader] = useState(false);
  const [showPriceEditor, setShowPriceEditor] = useState(false);

  // Use consolidated permissions hook
  const { isOwner, hasContributorAccess, canEdit, canUpload } = useVehiclePermissions(vehicleId, session, vehicle);
  
  // Use consolidated image upload hook
  const { uploading, upload } = useImageUpload(session, isOwner, hasContributorAccess);

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
    await upload(vehicleId, files, 'general');
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
              fontSize: FONT_BASE,
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
          <MobileOverviewTab
            vehicleId={vehicleId}
            vehicle={vehicle}
            onTabChange={setActiveTab}
            session={session}
            onVehicleUpdated={loadVehicle}
          />
        )}
        {activeTab === 'timeline' && (
          <div style={{ background: '#ffffff' }}>
            {/* Horizontally scrollable timeline */}
            <div style={{
              overflowX: 'auto',
              overflowY: 'hidden',
              WebkitOverflowScrolling: 'touch',
              padding: '12px',
              scrollbarWidth: 'thin'
            }}>
              <div style={{ minWidth: '700px' }}>
                <VehicleTimeline vehicleId={vehicleId} isOwner={isOwner} />
              </div>
            </div>
            <div style={{ padding: '12px', paddingTop: 0 }}>
              <MobileCommentBox vehicleId={vehicleId} session={session} targetType="vehicle" />
            </div>
          </div>
        )}
        {activeTab === 'images' && (
          <MobileImagesTab vehicleId={vehicleId} session={session} />
        )}
        {activeTab === 'specs' && (
          <MobileSpecsTab vehicle={vehicle} session={session} vehicleId={vehicleId} />
        )}
      </div>

      {/* Floating Action Button (FAB) for Camera - Only for owners/contributors */}
      {/* Bottom Toolbar with Camera, Comment, Tag tools */}
      <MobileBottomToolbar
        vehicleId={vehicleId}
        session={session}
        isOwner={isOwner}
        hasContributorAccess={hasContributorAccess}
        onToolSelect={(tool) => {
          if (tool === 'comment') {
            // Auto-scroll to comment box
          } else if (tool === 'tag') {
            // Enable pinpoint tagging mode on images
          }
        }}
      />

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

interface MobileOverviewTabProps {
  vehicleId: string;
  vehicle: any;
  onTabChange: (tab: VehicleTab) => void;
  session: any;
  onVehicleUpdated?: () => void;
}

const MobileOverviewTab: React.FC<MobileOverviewTabProps> = ({ vehicleId, vehicle, onTabChange, session, onVehicleUpdated }) => {
  const [stats, setStats] = useState<any>(null);
  const [vehicleImages, setVehicleImages] = useState<string[]>([]);
  const [showPriceEditor, setShowPriceEditor] = useState(false);
  const [showDocUploader, setShowDocUploader] = useState(false);
  const expertAnalysisRunningRef = React.useRef(false);

  // Use consolidated permissions hook
  const { isOwner, hasContributorAccess } = useVehiclePermissions(vehicleId, session, vehicle);

  useEffect(() => {
    loadStats();
    loadImages();
    checkAndRunExpertValuation();
    
    // Listen for document uploads to trigger revaluation
    const handleDocUpdate = () => {
      loadStats();
      checkAndRunExpertValuation();
    };
    window.addEventListener('vehicle_documents_updated', handleDocUpdate);
    window.addEventListener('vehicle_images_updated', handleDocUpdate);
    
    return () => {
      window.removeEventListener('vehicle_documents_updated', handleDocUpdate);
      window.removeEventListener('vehicle_images_updated', handleDocUpdate);
    };
  }, [vehicleId, session, isOwner, hasContributorAccess]);

  const checkAndRunExpertValuation = async () => {
    if (!session?.user || !vehicleId || !(isOwner || hasContributorAccess)) {
      return;
    }

    try {
      // Check if we need to run expert valuation
      const { data: latestValuation } = await supabase
        .from('vehicle_valuations')
        .select('valuation_date')
        .eq('vehicle_id', vehicleId)
        .order('valuation_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      // RE-ENABLED: Expert agent runs analysis but does NOT auto-update sale prices
      // Run if no valuation exists or if older than 24 hours
      const shouldRun = !latestValuation || 
        (Date.now() - new Date(latestValuation.valuation_date).getTime()) > (24 * 60 * 60 * 1000);

      if (shouldRun) {
        await runExpertAgent();
      }
    } catch (err) {
      console.error('Error checking expert valuation:', err);
    }
  };

  const runExpertAgent = async () => {
    if (expertAnalysisRunningRef.current) return;
    expertAnalysisRunningRef.current = true;

    try {
      console.log('[MobileOverviewTab] Triggering vehicle-expert-agent for', vehicleId);
      const { error } = await supabase.functions.invoke('vehicle-expert-agent', {
        body: { vehicleId }
      });

      if (error) {
        console.error('Expert agent error:', error);
      } else {
        console.log('[MobileOverviewTab] Expert agent completed successfully');
        // Dispatch event to refresh UI
        window.dispatchEvent(new Event('vehicle_valuation_updated'));
      }
    } catch (err) {
      console.error('Expert agent failed:', err);
    } finally {
      expertAnalysisRunningRef.current = false;
    }
  };

  const loadStats = async () => {
    const [images, events, tags, workSessions] = await Promise.all([
      supabase.from('vehicle_images').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
      supabase.from('timeline_events').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
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

      {/* Price Carousel */}
      <PriceCarousel vehicle={vehicle} stats={stats} session={session} />

      {/* Professional Trading Panel - COMING SOON */}
      <div style={styles.tradingPanel}>
        {/* Trading Panel - LIVE SYSTEM */}
        <MobileTradingPanel
          vehicleId={vehicle.id}
          offeringId={vehicle.offering_id || vehicle.id}
          currentSharePrice={vehicle.current_value ? vehicle.current_value / 1000 : 50}
          vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
          session={session}
        />
      </div>

      {/* Owner Management Actions - SEPARATE from trading */}
      {(session?.user && (isOwner || hasContributorAccess)) && (
        <div style={styles.ownerControls}>
          <button onClick={() => setShowPriceEditor(true)} style={styles.ownerControlBtn}>
            Edit Price
          </button>
          <button onClick={() => setShowDocUploader(true)} style={styles.ownerControlBtn}>
            Upload Doc
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
            // Refresh data without full page reload
            onVehicleUpdated?.();
            loadStats();
            window.dispatchEvent(new Event('vehicle_valuation_updated'));
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
            onVehicleUpdated?.();
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
  const [vehicle, setVehicle] = useState<any>(null);

  // Use consolidated permissions hook
  const { isOwner, hasContributorAccess } = useVehiclePermissions(vehicleId, session, vehicle);
  
  // Use consolidated image upload hook
  const { uploading, upload } = useImageUpload(session, isOwner, hasContributorAccess);

  useEffect(() => {
    loadVehicle();
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

  const loadVehicle = async () => {
    const { data } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();
    setVehicle(data);
  };

  const loadImages = async () => {
    const { data } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('taken_at', { ascending: false });

    setImages(data || []);
  };

  const handleFileUpload = async (files: FileList | null) => {
    const success = await upload(vehicleId, files, 'general');
    if (success) {
      await loadImages();
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

  const [imageFilter, setImageFilter] = React.useState<string>('all');
  const [imageSortBy, setImageSortBy] = React.useState<string>('date_desc');

  // Filter and sort images
  const getFilteredImages = () => {
    let filtered = [...images];
    
    // Apply filters
    if (imageFilter === 'primary') {
      filtered = filtered.filter(img => img.is_primary);
    } else if (imageFilter === 'recent') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      filtered = filtered.filter(img => img.taken_at && new Date(img.taken_at) > weekAgo);
    }
    
    // Apply sorting
    if (imageSortBy === 'date_desc') {
      filtered.sort((a, b) => new Date(b.taken_at || b.created_at).getTime() - new Date(a.taken_at || a.created_at).getTime());
    } else if (imageSortBy === 'date_asc') {
      filtered.sort((a, b) => new Date(a.taken_at || a.created_at).getTime() - new Date(b.taken_at || b.created_at).getTime());
    }
    
    return filtered;
  };

  const filteredImages = getFilteredImages();

  return (
    <div style={styles.tabContent}>
      {/* Filter & Sort Bar */}
      <div style={{
        display: 'flex',
        gap: '8px',
        padding: '8px',
        background: 'rgba(255, 255, 255, 0.9)',
        borderBottom: '1px solid #ddd',
        position: 'sticky',
        top: 0,
        zIndex: 5
      }}>
        <select
          value={imageFilter}
          onChange={(e) => setImageFilter(e.target.value)}
          style={{
            flex: 1,
            padding: '6px',
            fontSize: '8pt',
            border: '1px solid #ccc',
            borderRadius: '4px',
            background: 'white'
          }}
        >
          <option value="all">All Images ({images.length})</option>
          <option value="primary">Primary Only</option>
          <option value="recent">Recent (7 days)</option>
        </select>
        <select
          value={imageSortBy}
          onChange={(e) => setImageSortBy(e.target.value)}
          style={{
            flex: 1,
            padding: '6px',
            fontSize: '8pt',
            border: '1px solid #ccc',
            borderRadius: '4px',
            background: 'white'
          }}
        >
          <option value="date_desc">Newest First</option>
          <option value="date_asc">Oldest First</option>
        </select>
      </div>

      {/* Optimized 3-column image grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2px' }}>
        {filteredImages.map((image: any) => (
          <div
            key={image.id}
            onClick={() => setSelectedImage(image)}
            style={{
              position: 'relative',
              paddingBottom: '100%',
              cursor: 'pointer',
              border: '1px solid #bdbdbd',
              background: '#000'
            }}
          >
            <img
              src={image.thumbnail_url || image.image_url}
              alt=""
              loading="lazy"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />
            {image.is_primary && (
              <div style={{
                position: 'absolute',
                top: '4px',
                left: '4px',
                background: '#c0c0c0',
                color: '#000',
                padding: '2px 4px',
                fontSize: '6pt',
                fontWeight: 'bold',
                border: '1px solid #000'
              }}>
                PRIMARY
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Enhanced fullscreen image viewer with gestures and context */}
      {selectedImage && (
        <EnhancedMobileImageViewer
          images={images}
          initialIndex={images.findIndex(img => img.id === selectedImage.id)}
          vehicleId={vehicleId}
          session={session}
          vehicle={vehicle}
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
                  background: savedImages.has(selectedImage.id) ? '#008000' : '#c0c0c0',
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
          <button style={styles.feedActionButton}>Like</button>
          <button style={styles.feedActionButton}>Comment</button>
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
  const [isOwner, setIsOwner] = useState(false);
  const [hasContributorAccess, setHasContributorAccess] = useState(false);

  useEffect(() => {
    checkOwnership();
  }, [session, vehicle]);

  const checkOwnership = async () => {
    if (!session?.user || !vehicle) {
      setIsOwner(false);
      setHasContributorAccess(false);
      return;
    }

    const isVehicleOwner = vehicle.uploaded_by === session.user.id || vehicle.user_id === session.user.id;
    setIsOwner(isVehicleOwner);

    // Check for contributor access
    try {
      const { data, error } = await supabase
        .from('vehicle_contributors')
        .select('role')
        .eq('vehicle_id', vehicleId)
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (!error && data) {
        const allowedRoles = ['owner', 'co_owner', 'restorer', 'moderator', 'consigner'];
        setHasContributorAccess(allowedRoles.includes(data.role));
      }
    } catch (err) {
      console.error('Error checking contributor access:', err);
    }
  };

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
      {/* Edit Button - Only for owners/contributors */}
      {(session?.user && (isOwner || hasContributorAccess)) && (
        <button
          onClick={() => setShowDataEditor(true)}
          style={{
            width: '100%',
            padding: '14px',
            background: '#008000',
            color: '#ffffff',
            border: '2px outset #ffffff',
            borderRadius: '4px',
            fontSize: FONT_BASE,
            fontWeight: 'bold',
            cursor: 'pointer',
            fontFamily: 'Arial, sans-serif',
            marginBottom: '12px'
          }}
        >
          Edit Vehicle Data
        </button>
      )}

      {/* Comprehensive Vehicle Editor - ALL fields editable */}
      {(session?.user && (isOwner || hasContributorAccess)) && (
        <ComprehensiveVehicleEditor
          vehicleId={vehicleId}
          vehicle={vehicle}
          canEdit={true}
          onDataUpdated={() => window.location.reload()}
        />
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
    background: '#f5f5f5',
    fontFamily: '"MS Sans Serif", Arial, sans-serif',
    fontSize: FONT_BASE
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100dvh',
    minHeight: '100vh',
    fontSize: FONT_BASE,
    fontFamily: '"MS Sans Serif", Arial, sans-serif',
    background: '#f5f5f5'
  },
  header: {
    background: '#c0c0c0',
    color: '#000000',
    padding: '12px',
    borderBottom: '2px solid #bdbdbd'
  },
  headerContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  title: {
    fontSize: FONT_BASE,
    fontWeight: 'bold',
    margin: 0
  },
  price: {
    fontSize: FONT_BASE,
    fontWeight: 'bold'
  },
  tabBar: {
    display: 'flex',
    background: '#c0c0c0',
    borderBottom: '2px solid #bdbdbd',
    padding: '2px'
  },
  tab: {
    flex: 1,
    padding: '8px 4px',
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    color: '#000000',
    fontSize: FONT_BASE,
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
    fontSize: FONT_BASE,
    fontWeight: 'bold',
    color: '#0066cc',
    marginBottom: '4px'
  },
  statLabel: {
    fontSize: FONT_SMALL,
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
    fontSize: FONT_SMALL,
    color: '#000000',
    marginBottom: '2px',
    fontWeight: 'bold'
  },
  cardValue: {
    fontSize: FONT_BASE,
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
    fontSize: FONT_BASE,
    fontWeight: 'bold' as const,
    color: '#0066cc'
  },
  commentsCount: {
    fontSize: FONT_SMALL,
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
    fontSize: FONT_BASE,
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
    fontSize: FONT_SMALL,
    color: '#bdbdbd',
    marginBottom: '4px'
  },
  eventTitle: {
    fontSize: FONT_BASE,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: '4px'
  },
  eventMeta: {
    fontSize: FONT_SMALL,
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
    fontSize: FONT_BASE,
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
    fontSize: FONT_BASE,
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
    fontSize: FONT_BASE,
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
    fontSize: FONT_SMALL,
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
    fontSize: FONT_BASE,
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
    fontSize: FONT_BASE,
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
    fontSize: FONT_SMALL,
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
    fontSize: FONT_BASE,
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
    transition: 'transform 0.1s'
  },
  // Professional Trading Panel (Robinhood Futures-style)
  tradingPanel: {
    background: '#1e1e1e',
    borderRadius: '12px',
    marginTop: '12px',
    overflow: 'hidden'
  },
  tradingTabs: {
    display: 'flex',
    borderBottom: '1px solid #333'
  },
  tradingTab: {
    flex: 1,
    padding: '14px',
    background: 'transparent',
    color: '#999',
    border: 'none',
    fontSize: FONT_BASE,
    fontWeight: '600' as const,
    cursor: 'pointer',
    borderBottom: '2px solid transparent'
  },
  tradingTabActive: {
    color: '#00c853',
    borderBottom: '2px solid #00c853'
  },
  orderForm: {
    padding: '16px'
  },
  formRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px'
  },
  formLabel: {
    color: '#fff',
    fontSize: FONT_BASE,
    fontWeight: '500' as const
  },
  formSubLabel: {
    color: '#666',
    fontSize: FONT_SMALL,
    marginTop: '2px'
  },
  formSelect: {
    background: '#2a2a2a',
    color: '#fff',
    border: '1px solid #444',
    borderRadius: '6px',
    padding: '10px 12px',
    fontSize: FONT_BASE,
    minWidth: '140px',
    cursor: 'pointer'
  },
  inputGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  formInput: {
    background: '#2a2a2a',
    color: '#fff',
    border: '1px solid #444',
    borderRadius: '6px',
    padding: '10px 12px',
    fontSize: FONT_BASE,
    fontWeight: '600' as const,
    width: '120px',
    textAlign: 'right' as const
  },
  inputButtons: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px'
  },
  inputBtn: {
    background: '#2a2a2a',
    color: '#fff',
    border: '1px solid #444',
    borderRadius: '4px',
    width: '32px',
    height: '20px',
    fontSize: FONT_BASE,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  formDivider: {
    height: '1px',
    background: '#333',
    margin: '16px 0'
  },
  costBreakdown: {
    marginBottom: '16px'
  },
  costRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  costLabel: {
    color: '#999',
    fontSize: FONT_BASE
  },
  costValue: {
    color: '#fff',
    fontSize: FONT_BASE,
    fontWeight: '600' as const
  },
  reviewOrderBtn: {
    width: '100%',
    background: '#00c853',
    color: '#000',
    border: 'none',
    borderRadius: '24px',
    padding: '14px',
    fontSize: FONT_BASE,
    fontWeight: '700' as const,
    cursor: 'pointer',
    marginBottom: '16px'
  },
  availableCash: {
    textAlign: 'center' as const,
    color: '#999',
    fontSize: FONT_BASE,
    marginBottom: '8px'
  },
  accountType: {
    textAlign: 'center' as const,
    color: '#fff',
    fontSize: FONT_BASE,
    marginBottom: '16px'
  },
  quickActions: {
    display: 'flex',
    gap: '8px',
    borderTop: '1px solid #333',
    paddingTop: '16px'
  },
  quickActionBtn: {
    flex: 1,
    background: '#2a2a2a',
    color: '#00c853',
    border: '1px solid #444',
    borderRadius: '8px',
    padding: '10px',
    fontSize: FONT_BASE,
    fontWeight: '600' as const,
    cursor: 'pointer'
  },
  // Professional About & Disclosure Section
  aboutSection: {
    borderTop: '1px solid #d0d0d0',
    marginTop: '16px',
    paddingTop: '16px'
  },
  aboutHeader: {
    fontSize: FONT_BASE,
    fontWeight: 'bold' as const,
    marginBottom: '8px',
    color: '#000'
  },
  aboutText: {
    fontSize: FONT_SMALL,
    lineHeight: '1.5',
    marginBottom: '8px',
    color: '#666'
  },
  riskDisclosure: {
    fontSize: FONT_SMALL,
    lineHeight: '1.4',
    marginBottom: '8px',
    color: '#666',
    marginTop: '12px'
  },
  disclosureLink: {
    color: '#0066cc',
    textDecoration: 'underline',
    cursor: 'pointer'
  },
  legalFooter: {
    fontSize: FONT_TINY,
    lineHeight: '1.4',
    color: '#999',
    marginTop: '8px'
  },
  // Owner Controls - Separate from trading
  ownerControls: {
    display: 'flex',
    gap: '12px',
    marginTop: '12px',
    marginBottom: '12px'
  },
  ownerControlBtn: {
    flex: 1,
    padding: '12px',
    background: '#c0c0c0',
    color: '#000',
    border: '2px outset #ffffff',
    borderRadius: '4px',
    fontSize: FONT_BASE,
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif'
  }
};

export default MobileVehicleProfile;

