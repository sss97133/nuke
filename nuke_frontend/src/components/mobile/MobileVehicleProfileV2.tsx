/**
 * Mobile Vehicle Profile V2
 * Vertical scroll layout - Instagram meets technical documentation
 * NO TABS - Single smooth scroll experience
 * 
 * CRITICAL: Does NOT modify image processing or timeline date logic
 * Uses existing hooks/services - UI layer only
 */

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { SmoothImageCarousel } from './SmoothImageCarousel';
import { SmoothFullscreenViewer } from './SmoothFullscreenViewer';
import { MobilePhotoDump } from './MobilePhotoDump';
import { MobileCommentBox } from './MobileCommentBox';
import { useVehiclePermissions } from '../../hooks/useVehiclePermissions';
import { useImageUpload } from '../../hooks/useImageUpload';
import VehicleTimeline from '../VehicleTimeline';

interface MobileVehicleProfileV2Props {
  vehicleId: string;
  isMobile: boolean;
}

export const MobileVehicleProfileV2: React.FC<MobileVehicleProfileV2Props> = ({ vehicleId, isMobile }) => {
  const [vehicle, setVehicle] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [images, setImages] = useState<any[]>([]);
  const [heroImages, setHeroImages] = useState<string[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [showPhotoDump, setShowPhotoDump] = useState(false);
  
  const cameraInputRef = useRef<HTMLInputElement>(null);
  
  const { isOwner, hasContributorAccess, canUpload } = useVehiclePermissions(vehicleId, session, vehicle);
  const { uploading, upload } = useImageUpload(session, isOwner, hasContributorAccess);

  useEffect(() => {
    loadSession();
    loadVehicle();
  }, [vehicleId]);

  const loadSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
  };

  const loadVehicle = async () => {
    // Load vehicle data
    const { data: vehicleData } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();
    
    if (!vehicleData) return;
    setVehicle(vehicleData);

    // Load images (primary first, then by taken_at)
    const { data: imageData } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('is_primary', { ascending: false })
      .order('taken_at', { ascending: false });
    
    setImages(imageData || []);
    
    // Hero images: top 5 for carousel
    const heroUrls = (imageData || [])
      .slice(0, 5)
      .map(img => img.large_url || img.image_url);
    setHeroImages(heroUrls);

    // Load timeline events (limited to recent 10 for preview)
    const { data: eventsData } = await supabase
      .from('vehicle_timeline_events')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('event_date', { ascending: false })
      .limit(10);
    
    setTimelineEvents(eventsData || []);

    // Load stats
    const [imgCount, eventCount] = await Promise.all([
      supabase.from('vehicle_images').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
      supabase.from('vehicle_timeline_events').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
    ]);

    setStats({
      images: imgCount.count || 0,
      events: eventCount.count || 0,
    });
  };

  const handleCameraUpload = async (files: FileList | null) => {
    if (!files) return;
    
    // Uses existing upload hook - preserves EXIF dates, GPS, etc.
    const success = await upload(vehicleId, files, 'general');
    
    if (success) {
      // Refresh images and timeline
      loadVehicle();
      window.dispatchEvent(new Event('vehicle_images_updated'));
    }
  };

  const handlePhotoDumpClose = () => {
    setShowPhotoDump(false);
    loadVehicle(); // Refresh after bulk upload
  };

  if (!isMobile) {
    return null; // Use desktop version
  }

  if (!vehicle) {
    return (
      <div style={styles.loading}>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Sticky Header - Minimal */}
      <div style={styles.header}>
        <button onClick={() => window.history.back()} style={styles.backBtn}>
          ← Back
        </button>
        <h1 style={styles.vehicleTitle}>
          {vehicle.year} {vehicle.make} {vehicle.model}
        </h1>
      </div>

      {/* Main Content - Vertical Scroll */}
      <div style={styles.content}>
        
        {/* Hero Image Carousel - Full Width */}
        {heroImages.length > 0 && (
          <div style={styles.heroSection}>
            <SmoothImageCarousel 
              images={heroImages}
              onImageChange={(index) => {
                // Could track engagement
              }}
            />
          </div>
        )}

        {/* Price & Key Stats - Inline */}
        <div style={styles.priceSection}>
          <div style={styles.priceValue}>
            ${(vehicle.current_value || 0).toLocaleString()}
          </div>
          <div style={styles.stats}>
            {stats?.images || 0} photos • {stats?.events || 0} events
          </div>
        </div>

        {/* Primary Actions - Upload Controls */}
        {canUpload && (
          <div style={styles.actionButtons}>
            <button 
              onClick={() => setShowPhotoDump(true)}
              style={styles.primaryAction}
            >
              PHOTO DUMP
            </button>
            <button 
              onClick={() => cameraInputRef.current?.click()}
              disabled={uploading}
              style={styles.secondaryAction}
            >
              {uploading ? 'UPLOADING...' : 'UPLOAD'}
            </button>
          </div>
        )}

        {/* Hidden file input for camera */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => handleCameraUpload(e.target.files)}
        />

        {/* Key Specs - Collapsible */}
        <div style={styles.specsSection}>
          <div style={styles.sectionTitle}>SPECS</div>
          <div style={styles.specsGrid}>
            {vehicle.vin && (
              <div style={styles.specRow}>
                <span style={styles.specLabel}>VIN</span>
                <span style={styles.specValue}>{vehicle.vin}</span>
              </div>
            )}
            {vehicle.mileage && (
              <div style={styles.specRow}>
                <span style={styles.specLabel}>Mileage</span>
                <span style={styles.specValue}>{vehicle.mileage.toLocaleString()} mi</span>
              </div>
            )}
            {vehicle.engine && (
              <div style={styles.specRow}>
                <span style={styles.specLabel}>Engine</span>
                <span style={styles.specValue}>{vehicle.engine}</span>
              </div>
            )}
          </div>
        </div>

        {/* Timeline Preview - Horizontal Scroll */}
        <div style={styles.timelineSection}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionTitle}>TIMELINE</div>
            <button style={styles.viewAllBtn}>View All →</button>
          </div>
          <div style={styles.timelinePreview}>
            {timelineEvents.slice(0, 5).map((event) => (
              <div key={event.id} style={styles.timelineCard}>
                <div style={styles.eventDate}>
                  {new Date(event.event_date).toLocaleDateString()}
                </div>
                <div style={styles.eventTitle}>{event.title}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Photo Grid - Recent 9 */}
        <div style={styles.photosSection}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionTitle}>PHOTOS</div>
            <button style={styles.viewAllBtn}>
              View All {stats?.images || 0} →
            </button>
          </div>
          <div style={styles.photoGrid}>
            {images.slice(0, 9).map((img) => (
              <div
                key={img.id}
                onClick={() => setSelectedImage(img)}
                style={styles.photoTile}
              >
                <img
                  src={img.thumbnail_url || img.image_url}
                  alt=""
                  loading="lazy"
                  style={styles.photoImage}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Comments Section */}
        <div style={styles.commentsSection}>
          <div style={styles.sectionTitle}>COMMENTS</div>
          <MobileCommentBox 
            vehicleId={vehicleId}
            session={session}
            targetType="vehicle"
          />
        </div>

        {/* Trading - Way at bottom */}
        {vehicle.offering_id && (
          <div style={styles.tradingSection}>
            <div style={styles.sectionTitle}>TRADING</div>
            <div style={styles.tradingPlaceholder}>
              Trading panel here (collapsed by default)
            </div>
          </div>
        )}

        {/* Bottom padding for floating toolbar */}
        <div style={{ height: '80px' }} />
      </div>

      {/* Floating Action Toolbar - Always Visible */}
      {canUpload && (
        <div style={styles.floatingToolbar}>
          <button 
            onClick={() => cameraInputRef.current?.click()}
            style={styles.toolbarBtn}
            title="Camera"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>
          <button 
            onClick={() => setShowPhotoDump(true)}
            style={styles.toolbarBtn}
            title="Photo Dump"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>
          <button 
            style={styles.toolbarBtn}
            title="Comment"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>
      )}

      {/* Photo Dump Modal */}
      {showPhotoDump && (
        <MobilePhotoDump 
          onClose={handlePhotoDumpClose}
          session={session}
        />
      )}

      {/* Fullscreen Image Viewer */}
      {selectedImage && (
        <SmoothFullscreenViewer
          images={images}
          initialIndex={images.findIndex(img => img.id === selectedImage.id)}
          vehicleId={vehicleId}
          session={session}
          onClose={() => setSelectedImage(null)}
          onDelete={async (imageId) => {
            const image = images.find(i => i.id === imageId);
            if (!image || image.uploaded_by !== session?.user?.id) {
              alert('You can only delete your own images');
              return;
            }
            
            if (confirm('Delete this image? Cannot be undone.')) {
              await supabase.from('vehicle_images').delete().eq('id', imageId);
              setSelectedImage(null);
              loadVehicle();
            }
          }}
        />
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100dvh',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#c0c0c0',
    fontFamily: '"MS Sans Serif", Arial, sans-serif',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100dvh',
    minHeight: '100vh',
    fontSize: '14px',
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    background: '#c0c0c0',
    borderBottom: '2px solid #808080',
    padding: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  backBtn: {
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    color: '#000',
    padding: '6px 12px',
    fontSize: '14px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  vehicleTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    margin: 0,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
    background: '#ffffff',
  },
  heroSection: {
    width: '100%',
    background: '#000',
  },
  priceSection: {
    padding: '20px',
    textAlign: 'center',
    background: '#f5f5f5',
    borderBottom: '2px solid #e0e0e0',
  },
  priceValue: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#00ff00',
    fontFamily: 'monospace',
    marginBottom: '8px',
  },
  stats: {
    fontSize: '13px',
    color: '#666',
    fontFamily: 'monospace',
  },
  actionButtons: {
    display: 'flex',
    gap: '12px',
    padding: '16px',
    background: '#ffffff',
    borderBottom: '1px solid #e0e0e0',
  },
  primaryAction: {
    flex: 1,
    background: '#00ff00',
    color: '#000',
    border: '2px outset #ffffff',
    padding: '16px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'transform 0.1s ease',
  },
  secondaryAction: {
    flex: 1,
    background: '#c0c0c0',
    color: '#000',
    border: '2px outset #ffffff',
    padding: '16px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'transform 0.1s ease',
  },
  specsSection: {
    padding: '16px',
    background: '#ffffff',
    borderBottom: '1px solid #e0e0e0',
  },
  sectionTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#000',
    marginBottom: '12px',
    letterSpacing: '0.5px',
  },
  specsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  specRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px',
    background: '#f5f5f5',
    border: '1px solid #e0e0e0',
  },
  specLabel: {
    fontSize: '12px',
    color: '#666',
  },
  specValue: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#000',
    fontFamily: 'monospace',
  },
  timelineSection: {
    padding: '16px',
    background: '#ffffff',
    borderBottom: '1px solid #e0e0e0',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  viewAllBtn: {
    background: 'none',
    border: 'none',
    color: '#0066cc',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  timelinePreview: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  timelineCard: {
    padding: '12px',
    background: '#f9f9f9',
    border: '1px solid #e0e0e0',
    borderLeft: '3px solid #00ff00',
  },
  eventDate: {
    fontSize: '11px',
    color: '#666',
    marginBottom: '4px',
    fontFamily: 'monospace',
  },
  eventTitle: {
    fontSize: '13px',
    color: '#000',
    fontWeight: 'bold',
  },
  photosSection: {
    padding: '16px',
    background: '#ffffff',
    borderBottom: '1px solid #e0e0e0',
  },
  photoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '4px',
  },
  photoTile: {
    aspectRatio: '1',
    overflow: 'hidden',
    cursor: 'pointer',
    background: '#000',
    border: '1px solid #ccc',
  },
  photoImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  commentsSection: {
    padding: '16px',
    background: '#ffffff',
    borderBottom: '1px solid #e0e0e0',
  },
  tradingSection: {
    padding: '16px',
    background: '#f5f5f5',
    borderTop: '2px solid #e0e0e0',
  },
  tradingPlaceholder: {
    padding: '40px 20px',
    textAlign: 'center',
    color: '#999',
    fontSize: '13px',
    border: '1px dashed #ccc',
  },
  floatingToolbar: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: '#000',
    borderTop: '2px solid #00ff00',
    display: 'flex',
    justifyContent: 'space-around',
    padding: '12px',
    zIndex: 1000,
  },
  toolbarBtn: {
    background: 'none',
    border: 'none',
    color: '#00ff00',
    cursor: 'pointer',
    padding: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.1s ease',
    WebkitTapHighlightColor: 'transparent',
  },
};

export default MobileVehicleProfileV2;

