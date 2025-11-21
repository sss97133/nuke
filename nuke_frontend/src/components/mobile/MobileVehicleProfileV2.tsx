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
import { UniversalImageUpload } from '../UniversalImageUpload';
import { MobileCommentBox } from './MobileCommentBox';
import { useVehiclePermissions } from '../../hooks/useVehiclePermissions';
import { useImageUpload } from '../../hooks/useImageUpload';
import VehicleTimeline from '../VehicleTimeline';
import CursorButton from '../CursorButton';

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

    // Load timeline events for 365 viewer
    const { data: eventsData } = await supabase
      .from('vehicle_timeline_events')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('event_date', { ascending: false });
    
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

  // Get correct price - prefer asking_price, then purchase_price, then current_value
  const getDisplayPrice = () => {
    if (vehicle?.asking_price && vehicle.asking_price > 0) return vehicle.asking_price;
    if (vehicle?.purchase_price && vehicle.purchase_price > 0) return vehicle.purchase_price;
    if (vehicle?.current_value && vehicle.current_value > 0) return vehicle.current_value;
    return null;
  };

  // Create mini 365 viewer with 4 quarters (90 day sections)
  const createQuarterlyView = () => {
    const now = new Date();
    const quarters = [
      { label: 'Q1', start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 2, 31) },
      { label: 'Q2', start: new Date(now.getFullYear(), 3, 1), end: new Date(now.getFullYear(), 5, 30) },
      { label: 'Q3', start: new Date(now.getFullYear(), 6, 1), end: new Date(now.getFullYear(), 8, 30) },
      { label: 'Q4', start: new Date(now.getFullYear(), 9, 1), end: new Date(now.getFullYear(), 11, 31) },
    ];

    return quarters.map((quarter, idx) => {
      const eventsInQuarter = timelineEvents.filter(event => {
        const eventDate = new Date(event.event_date);
        return eventDate >= quarter.start && eventDate <= quarter.end;
      });

      const intensity = Math.min(eventsInQuarter.length / 10, 1); // Max 10 events = full intensity
      const colorIntensity = Math.floor(intensity * 255);

      return (
        <div
          key={idx}
          style={{
            ...styles.quarterCell,
            background: `rgba(22, 130, 93, ${intensity * 0.3 + 0.1})`,
            borderColor: `rgba(22, 130, 93, ${intensity * 0.5 + 0.3})`,
          }}
        >
          <div style={styles.quarterLabel}>{quarter.label}</div>
          <div style={styles.quarterCount}>{eventsInQuarter.length}</div>
        </div>
      );
    });
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

  const displayPrice = getDisplayPrice();

  return (
    <div style={styles.container}>
      {/* Sticky Header - Minimal */}
      <div style={styles.header}>
        <CursorButton 
          onClick={() => window.history.back()} 
          variant="secondary"
          size="sm"
        >
          ← Back
        </CursorButton>
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
        {displayPrice && (
          <div style={styles.priceSection}>
            <div style={styles.priceValue}>
              ${displayPrice.toLocaleString()}
            </div>
            <div style={styles.stats}>
              {stats?.images || 0} photos • {stats?.events || 0} events
            </div>
          </div>
        )}

        {/* Primary Actions - Upload Controls */}
        {canUpload && (
          <div style={styles.actionButtons}>
            <CursorButton 
              onClick={() => setShowPhotoDump(true)}
              variant="primary"
              fullWidth
              size="md"
            >
              Upload Images
            </CursorButton>
            <CursorButton 
              onClick={() => cameraInputRef.current?.click()}
              disabled={uploading}
              variant="secondary"
              fullWidth
              size="md"
            >
              {uploading ? 'UPLOADING...' : 'UPLOAD'}
            </CursorButton>
          </div>
        )}

        {/* Hidden file input for camera and photo library */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => handleCameraUpload(e.target.files)}
        />

        {/* Key Specs - Enhanced like desktop */}
        <div style={styles.specsSection}>
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
            {vehicle.transmission && (
              <div style={styles.specRow}>
                <span style={styles.specLabel}>Transmission</span>
                <span style={styles.specValue}>{vehicle.transmission}</span>
              </div>
            )}
            {vehicle.fuel_type && (
              <div style={styles.specRow}>
                <span style={styles.specLabel}>Fuel</span>
                <span style={styles.specValue}>{vehicle.fuel_type}</span>
              </div>
            )}
            {vehicle.drivetrain && (
              <div style={styles.specRow}>
                <span style={styles.specLabel}>Drivetrain</span>
                <span style={styles.specValue}>{vehicle.drivetrain}</span>
              </div>
            )}
            {vehicle.body_style && (
              <div style={styles.specRow}>
                <span style={styles.specLabel}>Body</span>
                <span style={styles.specValue}>{vehicle.body_style}</span>
              </div>
            )}
            {vehicle.color && (
              <div style={styles.specRow}>
                <span style={styles.specLabel}>Color</span>
                <span style={styles.specValue}>{vehicle.color}</span>
              </div>
            )}
          </div>
        </div>

        {/* Timeline - Mini 365 Viewer (4 Quarters) */}
        <div style={styles.timelineSection}>
          <div style={styles.sectionTitle}>TIMELINE</div>
          <div style={styles.quarterlyViewer}>
            {createQuarterlyView()}
          </div>
        </div>

        {/* Photo Grid - No label, just grid */}
        <div style={styles.photosSection}>
          <div style={styles.photoGrid}>
            {images.slice(0, 9).map((img) => (
              <div
                key={img.id}
                onClick={() => setSelectedImage(img)}
                style={styles.photoTile}
              >
                <div 
                  style={{ 
                    ...styles.photoBlur, 
                    backgroundImage: `url(${img.thumbnail_url || img.image_url})` 
                  }} 
                />
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
          <CursorButton 
            onClick={() => cameraInputRef.current?.click()}
            variant="secondary"
            size="md"
            title="Camera"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </CursorButton>
          <CursorButton 
            onClick={() => setShowPhotoDump(true)}
            variant="secondary"
            size="md"
            title="Photo Dump"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </CursorButton>
          <CursorButton 
            variant="secondary"
            size="md"
            title="Comment"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </CursorButton>
        </div>
      )}

      {/* Photo Dump Modal */}
      {showPhotoDump && (
        <UniversalImageUpload 
          onClose={handlePhotoDumpClose}
          session={session}
          vehicleId={vehicleId}
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
    width: '100vw',
    position: 'fixed',
    top: 0,
    left: 0,
    zIndex: 9999, // Overlay AppLayout
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
    fontFamily: 'var(--font-family)',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100dvh',
    minHeight: '100vh',
    fontSize: '8pt',
    color: 'var(--text)',
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    background: 'var(--surface)',
    borderBottom: '2px solid var(--border)',
    padding: 'var(--space-3)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
  },
  vehicleTitle: {
    fontSize: '8pt',
    fontWeight: 700,
    margin: 0,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text)',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
    background: 'var(--bg)',
  },
  heroSection: {
    width: '100%',
    position: 'relative',
  },
  priceSection: {
    padding: 'var(--space-5)',
    textAlign: 'center',
    background: 'var(--surface)',
    borderBottom: '2px solid var(--border)',
  },
  priceValue: {
    fontSize: '8pt',
    fontWeight: 700,
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    marginBottom: 'var(--space-2)',
  },
  stats: {
    fontSize: '8pt',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
  },
  actionButtons: {
    display: 'flex',
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    background: 'var(--bg)',
    borderBottom: '2px solid var(--border)',
  },
  specsSection: {
    padding: 'var(--space-4)',
    background: 'var(--bg)',
    borderBottom: '2px solid var(--border)',
  },
  sectionTitle: {
    fontSize: '8pt',
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: 'var(--space-3)',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
  },
  specsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  },
  specRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: 'var(--space-2)',
    background: 'var(--surface)',
    border: '2px solid var(--border)',
    borderRadius: 'var(--radius)',
  },
  specLabel: {
    fontSize: '8pt',
    color: 'var(--text-secondary)',
  },
  specValue: {
    fontSize: '8pt',
    fontWeight: 600,
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
  },
  timelineSection: {
    padding: 'var(--space-4)',
    background: 'var(--bg)',
    borderBottom: '2px solid var(--border)',
  },
  quarterlyViewer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 'var(--space-2)',
  },
  quarterCell: {
    aspectRatio: '1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid var(--success)',
    borderRadius: 'var(--radius)',
    padding: 'var(--space-2)',
  },
  quarterLabel: {
    fontSize: '8pt',
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: 'var(--space-1)',
  },
  quarterCount: {
    fontSize: '8pt',
    fontFamily: 'var(--font-mono)',
    color: 'var(--text)',
  },
  photosSection: {
    padding: 'var(--space-4)',
    background: 'var(--bg)',
    borderBottom: '2px solid var(--border)',
  },
  photoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 'var(--space-1)',
  },
  photoTile: {
    aspectRatio: '1',
    overflow: 'hidden',
    cursor: 'pointer',
    position: 'relative',
    border: '2px solid var(--border)',
    borderRadius: 'var(--radius)',
    transition: 'var(--transition)',
  },
  photoImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center',
    position: 'relative',
    zIndex: 1,
  },
  photoBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(20px)',
    opacity: 0.4,
    zIndex: 0,
  },
  commentsSection: {
    padding: 'var(--space-4)',
    background: 'var(--bg)',
    borderBottom: '2px solid var(--border)',
  },
  tradingSection: {
    padding: 'var(--space-4)',
    background: 'var(--surface)',
    borderTop: '2px solid var(--border)',
  },
  tradingPlaceholder: {
    padding: 'var(--space-6) var(--space-5)',
    textAlign: 'center',
    color: 'var(--text-disabled)',
    fontSize: '8pt',
    border: '2px dashed var(--border)',
    borderRadius: 'var(--radius)',
  },
  floatingToolbar: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'var(--surface)',
    borderTop: '2px solid var(--border)',
    display: 'flex',
    justifyContent: 'space-around',
    padding: 'var(--space-3)',
    zIndex: 1000,
    gap: 'var(--space-2)',
  },
};

export default MobileVehicleProfileV2;
