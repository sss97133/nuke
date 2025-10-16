/**
 * Mobile-Optimized Vehicle Profile
 * Responsive layout with swipe gestures and touch-friendly UI
 */

import React, { useState, useEffect } from 'react';
import { MobileImageControls } from '../image/MobileImageControls';
import { UserInteractionService } from '../../services/userInteractionService';
import { supabase } from '../../lib/supabase';

interface MobileVehicleProfileProps {
  vehicleId: string;
  isMobile: boolean;
}

export const MobileVehicleProfile: React.FC<MobileVehicleProfileProps> = ({ vehicleId, isMobile }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'images' | 'specs'>('overview');
  const [vehicle, setVehicle] = useState<any>(null);
  const [session, setSession] = useState<any>(null);

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
          <h1 style={styles.title}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </h1>
          <div style={styles.price}>
            ${vehicle.current_value?.toLocaleString() || 'N/A'}
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
          <MobileOverviewTab vehicleId={vehicleId} vehicle={vehicle} />
        )}
        {activeTab === 'timeline' && (
          <MobileTimelineTab vehicleId={vehicleId} />
        )}
        {activeTab === 'images' && (
          <MobileImagesTab vehicleId={vehicleId} session={session} />
        )}
        {activeTab === 'specs' && (
          <MobileSpecsTab vehicle={vehicle} />
        )}
      </div>
    </div>
  );
};

const MobileOverviewTab: React.FC<{ vehicleId: string; vehicle: any }> = ({ vehicleId, vehicle }) => {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    loadStats();
  }, [vehicleId]);

  const loadStats = async () => {
    const [images, events, tags] = await Promise.all([
      supabase.from('vehicle_images').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
      supabase.from('timeline_events').select('id, labor_hours', { count: 'exact' }).eq('vehicle_id', vehicleId),
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

  return (
    <div style={styles.tabContent}>
      {/* Quick Stats - Touch Friendly */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats?.images || 0}</div>
          <div style={styles.statLabel}>Photos</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats?.events || 0}</div>
          <div style={styles.statLabel}>Events</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats?.tags || 0}</div>
          <div style={styles.statLabel}>Tags</div>
        </div>
        <div style={styles.statCard}>
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

const MobileTimelineTab: React.FC<{ vehicleId: string }> = ({ vehicleId }) => {
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    loadTimeline();
  }, [vehicleId]);

  const loadTimeline = async () => {
    const { data } = await supabase
      .from('timeline_events')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('event_date', { ascending: false })
      .limit(20);

    setEvents(data || []);
  };

  return (
    <div style={styles.tabContent}>
      {events.map((event) => (
        <div key={event.id} style={styles.eventCard}>
          <div style={styles.eventDate}>
            {new Date(event.event_date).toLocaleDateString()}
          </div>
          <div style={styles.eventTitle}>{event.title}</div>
          {event.labor_hours && (
            <div style={styles.eventMeta}>
              {event.labor_hours} hours
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const MobileImagesTab: React.FC<{ vehicleId: string; session: any }> = ({ vehicleId, session }) => {
  const [images, setImages] = useState<any[]>([]);
  const [selectedImage, setSelectedImage] = useState<any>(null);

  useEffect(() => {
    loadImages();
  }, [vehicleId]);

  const loadImages = async () => {
    const { data } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('taken_at', { ascending: false });

    setImages(data || []);
  };

  const handleLike = async (imageId: string) => {
    if (session?.user) {
      await UserInteractionService.likeImage(session.user.id, imageId, vehicleId);
    }
  };

  const handleSave = async (imageId: string) => {
    if (session?.user) {
      await UserInteractionService.saveImage(session.user.id, imageId, vehicleId);
    }
  };

  const handleDislike = async (imageId: string) => {
    if (session?.user) {
      await UserInteractionService.dislikeImage(session.user.id, imageId, vehicleId);
    }
  };

  return (
    <div style={styles.tabContent}>
      {/* Grid of images - 2 columns on mobile */}
      <div style={styles.imageGrid}>
        {images.map((image) => (
          <div
            key={image.id}
            onClick={() => setSelectedImage(image)}
            style={styles.imageCard}
          >
            <img
              src={image.thumbnail_url || image.image_url}
              alt=""
              style={styles.thumbnail}
            />
          </div>
        ))}
      </div>

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
          onSwipeDown={() => setSelectedImage(null)}
          onDoubleTap={() => handleLike(selectedImage.id)}
        >
          <div style={styles.fullscreenImage}>
            <img
              src={selectedImage.large_url || selectedImage.image_url}
              alt=""
              style={styles.fullImage}
            />
            
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

const MobileSpecsTab: React.FC<{ vehicle: any }> = ({ vehicle }) => {
  return (
    <div style={styles.tabContent}>
      {Object.entries(vehicle)
        .filter(([key, value]) => value && !['id', 'created_at', 'updated_at'].includes(key))
        .map(([key, value]) => (
          <div key={key} style={styles.card}>
            <div style={styles.cardLabel}>{key.replace(/_/g, ' ').toUpperCase()}</div>
            <div style={styles.cardValue}>{String(value)}</div>
          </div>
        ))}
    </div>
  );
};

// Windows 95 Mobile Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#c0c0c0',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
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
  }
};

export default MobileVehicleProfile;

