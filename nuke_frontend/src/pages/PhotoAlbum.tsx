/**
 * Photo Album - User's Private Photo Collection
 * View and organize all photos before they're assigned to vehicles
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../design-system.css';

interface Photo {
  id: string;
  image_url: string;
  vehicle_id: string | null;
  vehicle_name?: string;
  taken_at: string | null;
  created_at: string;
  process_stage: string | null;
  is_primary: boolean;
  category?: string;
  metadata?: any;
}

interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  nickname?: string;
}

const PhotoAlbum: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unassigned' | 'assigned'>('all');
  const [sortBy, setSortBy] = useState<'date_taken' | 'date_uploaded'>('date_taken');
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'timeline'>('grid');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Get current user
  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
    };
    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (user) {
      loadPhotos();
      loadVehicles();
    }
  }, [user, filter, sortBy]);

  const loadPhotos = async () => {
    if (!user) return;

    try {
      setLoading(true);
      
      let query = supabase
        .from('vehicle_images')
        .select(`
          id,
          image_url,
          vehicle_id,
          taken_at,
          created_at,
          process_stage,
          is_primary,
          metadata,
          vehicles!vehicle_images_vehicle_id_fkey (
            id,
            year,
            make,
            model,
            nickname
          )
        `)
        .eq('uploaded_by', user.id);

      // Apply filters
      if (filter === 'unassigned') {
        query = query.is('vehicle_id', null);
      } else if (filter === 'assigned') {
        query = query.not('vehicle_id', 'is', null);
      }

      // Apply sorting
      if (sortBy === 'date_taken') {
        query = query.order('taken_at', { ascending: false, nullsFirst: false });
      } else {
        query = query.order('created_at', { ascending: false });
      }

      const { data, error } = await query;

      if (error) throw error;

      const photosWithVehicleNames = data.map((photo: any) => ({
        ...photo,
        vehicle_name: photo.vehicles 
          ? `${photo.vehicles.year} ${photo.vehicles.make} ${photo.vehicles.model}`
          : null
      }));

      setPhotos(photosWithVehicleNames);
    } catch (error) {
      console.error('Error loading photos:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadVehicles = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, year, make, model, nickname')
        .eq('uploaded_by', user.id)
        .order('year', { ascending: false });

      if (error) throw error;
      setVehicles(data || []);
    } catch (error) {
      console.error('Error loading vehicles:', error);
    }
  };

  const togglePhotoSelection = (photoId: string) => {
    const newSelection = new Set(selectedPhotos);
    if (newSelection.has(photoId)) {
      newSelection.delete(photoId);
    } else {
      newSelection.add(photoId);
    }
    setSelectedPhotos(newSelection);
  };

  const selectAll = () => {
    const visiblePhotoIds = photos.map(p => p.id);
    setSelectedPhotos(new Set(visiblePhotoIds));
  };

  const clearSelection = () => {
    setSelectedPhotos(new Set());
  };

  const handleAssignToVehicle = async () => {
    if (!selectedVehicleId || selectedPhotos.size === 0) return;

    try {
      const photoIds = Array.from(selectedPhotos);
      
      const { error } = await supabase
        .from('vehicle_images')
        .update({ vehicle_id: selectedVehicleId })
        .in('id', photoIds);

      if (error) throw error;

      // Reload photos
      await loadPhotos();
      setShowAssignModal(false);
      setSelectedPhotos(new Set());
      setSelectedVehicleId('');
    } catch (error) {
      console.error('Error assigning photos:', error);
      alert('Failed to assign photos to vehicle');
    }
  };

  const handleDeletePhotos = async () => {
    if (selectedPhotos.size === 0) return;
    if (!confirm(`Delete ${selectedPhotos.size} photo(s)? This cannot be undone.`)) return;

    try {
      const photoIds = Array.from(selectedPhotos);
      
      const { error } = await supabase
        .from('vehicle_images')
        .delete()
        .in('id', photoIds);

      if (error) throw error;

      await loadPhotos();
      setSelectedPhotos(new Set());
    } catch (error) {
      console.error('Error deleting photos:', error);
      alert('Failed to delete photos');
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Unknown date';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const groupPhotosByDate = () => {
    const groups: { [key: string]: Photo[] } = {};
    
    photos.forEach(photo => {
      const dateKey = photo.taken_at 
        ? new Date(photo.taken_at).toDateString()
        : 'No Date';
      
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(photo);
    });

    return Object.entries(groups).sort((a, b) => {
      if (a[0] === 'No Date') return 1;
      if (b[0] === 'No Date') return -1;
      return new Date(b[0]).getTime() - new Date(a[0]).getTime();
    });
  };

  if (!user) {
    return (
      <div style={styles.container}>
        <div style={styles.message}>Please log in to view your photo album</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.message}>Loading photos...</div>
      </div>
    );
  }

  const photoGroups = viewMode === 'timeline' ? groupPhotosByDate() : [];

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>📸 My Photo Album</h1>
        <p style={styles.subtitle}>
          {photos.length} photo{photos.length !== 1 ? 's' : ''}
          {selectedPhotos.size > 0 && ` • ${selectedPhotos.size} selected`}
        </p>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <div style={styles.controlRow}>
          {/* Filter */}
          <div style={styles.controlGroup}>
            <label style={styles.label}>Filter:</label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              style={styles.select}
            >
              <option value="all">All Photos</option>
              <option value="unassigned">Unassigned</option>
              <option value="assigned">Assigned to Vehicle</option>
            </select>
          </div>

          {/* Sort */}
          <div style={styles.controlGroup}>
            <label style={styles.label}>Sort:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              style={styles.select}
            >
              <option value="date_taken">Date Taken</option>
              <option value="date_uploaded">Date Uploaded</option>
            </select>
          </div>

          {/* View Mode */}
          <div style={styles.controlGroup}>
            <label style={styles.label}>View:</label>
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as any)}
              style={styles.select}
            >
              <option value="grid">Grid</option>
              <option value="timeline">Timeline</option>
            </select>
          </div>
        </div>

        {/* Selection Actions */}
        {photos.length > 0 && (
          <div style={styles.actionRow}>
            <button onClick={selectAll} style={styles.button}>
              Select All
            </button>
            <button onClick={clearSelection} style={styles.button}>
              Clear Selection
            </button>
            {selectedPhotos.size > 0 && (
              <>
                <button 
                  onClick={() => setShowAssignModal(true)} 
                  style={styles.buttonPrimary}
                >
                  Assign to Vehicle ({selectedPhotos.size})
                </button>
                <button 
                  onClick={handleDeletePhotos} 
                  style={styles.buttonDanger}
                >
                  Delete ({selectedPhotos.size})
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Photo Grid or Timeline */}
      {photos.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📷</div>
          <h2 style={styles.emptyTitle}>No photos yet</h2>
          <p style={styles.emptyText}>
            Use the camera button in the bottom right to start capturing photos.
            <br />
            They'll automatically appear here for you to organize.
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div style={isMobile ? styles.gridMobile : styles.grid}>
          {photos.map((photo) => (
            <div
              key={photo.id}
              style={{
                ...styles.photoCard,
                ...(selectedPhotos.has(photo.id) ? styles.photoCardSelected : {})
              }}
              onClick={() => togglePhotoSelection(photo.id)}
            >
              <div style={styles.photoWrapper}>
                <img
                  src={photo.image_url}
                  alt="Photo"
                  style={styles.photo}
                  loading="lazy"
                />
                {selectedPhotos.has(photo.id) && (
                  <div style={styles.checkmark}>✓</div>
                )}
              </div>
              <div style={styles.photoInfo}>
                <div style={styles.photoDate}>
                  {formatDate(photo.taken_at || photo.created_at)}
                </div>
                {photo.vehicle_name && (
                  <div style={styles.vehicleName}>{photo.vehicle_name}</div>
                )}
                {!photo.vehicle_id && (
                  <div style={styles.unassignedBadge}>Unassigned</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={styles.timeline}>
          {photoGroups.map(([date, groupPhotos]) => (
            <div key={date} style={styles.timelineGroup}>
              <h3 style={styles.timelineDate}>{date}</h3>
              <div style={isMobile ? styles.gridMobile : styles.grid}>
                {groupPhotos.map((photo) => (
                  <div
                    key={photo.id}
                    style={{
                      ...styles.photoCard,
                      ...(selectedPhotos.has(photo.id) ? styles.photoCardSelected : {})
                    }}
                    onClick={() => togglePhotoSelection(photo.id)}
                  >
                    <div style={styles.photoWrapper}>
                      <img
                        src={photo.image_url}
                        alt="Photo"
                        style={styles.photo}
                        loading="lazy"
                      />
                      {selectedPhotos.has(photo.id) && (
                        <div style={styles.checkmark}>✓</div>
                      )}
                    </div>
                    <div style={styles.photoInfo}>
                      {photo.vehicle_name && (
                        <div style={styles.vehicleName}>{photo.vehicle_name}</div>
                      )}
                      {!photo.vehicle_id && (
                        <div style={styles.unassignedBadge}>Unassigned</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Assign to Vehicle Modal */}
      {showAssignModal && (
        <div style={styles.modalOverlay} onClick={() => setShowAssignModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>
              Assign {selectedPhotos.size} Photo{selectedPhotos.size !== 1 ? 's' : ''} to Vehicle
            </h2>
            
            <div style={styles.modalContent}>
              <label style={styles.label}>Select Vehicle:</label>
              <select
                value={selectedVehicleId}
                onChange={(e) => setSelectedVehicleId(e.target.value)}
                style={styles.selectLarge}
                autoFocus
              >
                <option value="">Choose a vehicle...</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.year} {vehicle.make} {vehicle.model}
                    {vehicle.nickname && ` "${vehicle.nickname}"`}
                  </option>
                ))}
              </select>

              {vehicles.length === 0 && (
                <p style={styles.modalNote}>
                  You don't have any vehicles yet.{' '}
                  <button
                    onClick={() => navigate('/add-vehicle')}
                    style={styles.linkButton}
                  >
                    Add a vehicle first
                  </button>
                </p>
              )}
            </div>

            <div style={styles.modalActions}>
              <button
                onClick={() => setShowAssignModal(false)}
                style={styles.button}
              >
                Cancel
              </button>
              <button
                onClick={handleAssignToVehicle}
                disabled={!selectedVehicleId}
                style={selectedVehicleId ? styles.buttonPrimary : styles.buttonDisabled}
              >
                Assign Photos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '20px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  header: {
    marginBottom: '20px',
    borderBottom: '2px solid #c0c0c0',
    paddingBottom: '10px'
  },
  title: {
    fontSize: '16pt',
    fontWeight: 'bold',
    margin: '0 0 8px 0',
    color: '#000080'
  },
  subtitle: {
    fontSize: '10pt',
    color: '#666',
    margin: 0
  },
  controls: {
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    padding: '12px',
    marginBottom: '20px'
  },
  controlRow: {
    display: 'flex',
    gap: '20px',
    marginBottom: '12px',
    flexWrap: 'wrap' as const
  },
  controlGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  label: {
    fontSize: '8pt',
    fontWeight: 'bold'
  },
  select: {
    fontSize: '8pt',
    padding: '4px',
    border: '2px inset #ffffff',
    background: 'white',
    minWidth: '120px'
  },
  selectLarge: {
    fontSize: '8pt',
    padding: '8px',
    border: '2px inset #ffffff',
    background: 'white',
    width: '100%'
  },
  actionRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const
  },
  button: {
    fontSize: '8pt',
    padding: '6px 12px',
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  buttonPrimary: {
    fontSize: '8pt',
    padding: '6px 12px',
    background: '#000080',
    color: 'white',
    border: '2px outset #ffffff',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  buttonDanger: {
    fontSize: '8pt',
    padding: '6px 12px',
    background: '#c00000',
    color: 'white',
    border: '2px outset #ffffff',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  buttonDisabled: {
    fontSize: '8pt',
    padding: '6px 12px',
    background: '#a0a0a0',
    color: '#666',
    border: '2px inset #ffffff',
    cursor: 'not-allowed',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px'
  },
  gridMobile: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: '12px'
  },
  photoCard: {
    background: 'white',
    border: '2px solid #c0c0c0',
    cursor: 'pointer',
    transition: 'all 0.2s',
    position: 'relative' as const
  },
  photoCardSelected: {
    border: '3px solid #000080',
    boxShadow: '0 0 8px rgba(0, 0, 128, 0.3)'
  },
  photoWrapper: {
    position: 'relative' as const,
    paddingTop: '100%',
    overflow: 'hidden',
    background: '#f0f0f0'
  },
  photo: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const
  },
  checkmark: {
    position: 'absolute' as const,
    top: '8px',
    right: '8px',
    background: '#000080',
    color: 'white',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    fontWeight: 'bold'
  },
  photoInfo: {
    padding: '8px',
    fontSize: '8pt'
  },
  photoDate: {
    color: '#666',
    marginBottom: '4px'
  },
  vehicleName: {
    fontWeight: 'bold',
    color: '#000080',
    marginBottom: '4px'
  },
  unassignedBadge: {
    background: '#ffeb3b',
    color: '#000',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '7pt',
    fontWeight: 'bold',
    display: 'inline-block'
  },
  timeline: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '32px'
  },
  timelineGroup: {
    
  },
  timelineDate: {
    fontSize: '12pt',
    fontWeight: 'bold',
    marginBottom: '12px',
    color: '#000080',
    borderBottom: '1px solid #c0c0c0',
    paddingBottom: '4px'
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '60px 20px',
    background: 'white',
    border: '2px solid #c0c0c0'
  },
  emptyIcon: {
    fontSize: '64px',
    marginBottom: '16px'
  },
  emptyTitle: {
    fontSize: '14pt',
    fontWeight: 'bold',
    marginBottom: '8px',
    color: '#000080'
  },
  emptyText: {
    fontSize: '10pt',
    color: '#666',
    lineHeight: 1.5
  },
  message: {
    textAlign: 'center' as const,
    padding: '40px',
    fontSize: '10pt',
    color: '#666'
  },
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000
  },
  modal: {
    background: '#c0c0c0',
    border: '3px outset #ffffff',
    padding: '16px',
    maxWidth: '500px',
    width: '90%',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  modalTitle: {
    fontSize: '10pt',
    fontWeight: 'bold',
    marginBottom: '16px',
    color: '#000080'
  },
  modalContent: {
    marginBottom: '16px'
  },
  modalNote: {
    fontSize: '8pt',
    color: '#666',
    marginTop: '12px',
    lineHeight: 1.5
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#000080',
    textDecoration: 'underline',
    cursor: 'pointer',
    fontSize: '8pt',
    padding: 0,
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px'
  }
};

export default PhotoAlbum;
