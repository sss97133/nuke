import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { extractImageMetadata } from '../utils/imageMetadata';
import { AIImageProcessingService } from '../services/aiImageProcessingService';
import '../design-system.css';

interface PhotoAlbumItem {
  id: string;
  image_url: string;
  thumbnail_url?: string;
  upload_date: Date;
  taken_date?: Date;
  assigned_vehicle_id?: string;
  assigned_vehicle_name?: string;
  category?: string;
  tags?: string[];
  metadata?: any;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  ai_suggestions?: {
    vehicleId?: string;
    vehicleName?: string;
    category?: string;
    confidence: number;
  };
}

interface UserPhotoAlbumProps {
  userId?: string;
  onPhotoSelect?: (photo: PhotoAlbumItem) => void;
  allowOrganization?: boolean;
}

export const UserPhotoAlbum: React.FC<UserPhotoAlbumProps> = ({
  userId,
  onPhotoSelect,
  allowOrganization = true
}) => {
  const { user } = useAuth();
  const targetUserId = userId || user?.id;
  
  const [photos, setPhotos] = useState<PhotoAlbumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unassigned' | 'pending'>('all');
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'upload' | 'taken' | 'vehicle'>('upload');

  // Load user's photo album
  useEffect(() => {
    if (targetUserId) {
      loadUserPhotos();
    }
  }, [targetUserId, filter, sortBy]);

  const loadUserPhotos = async () => {
    try {
      setLoading(true);
      
      // Query user's photos from multiple sources
      let query = supabase
        .from('user_photo_album')
        .select(`
          *,
          vehicle:vehicles(id, year, make, model)
        `)
        .eq('user_id', targetUserId);

      // Apply filters
      if (filter === 'unassigned') {
        query = query.is('assigned_vehicle_id', null);
      } else if (filter === 'pending') {
        query = query.eq('processing_status', 'pending');
      }

      // Apply sorting
      switch (sortBy) {
        case 'taken':
          query = query.order('taken_date', { ascending: false, nullsFirst: false });
          break;
        case 'vehicle':
          query = query.order('assigned_vehicle_name', { ascending: true });
          break;
        default:
          query = query.order('upload_date', { ascending: false });
      }

      const { data, error } = await query;
      
      if (error) throw error;
      
      setPhotos(data || []);
    } catch (error) {
      console.error('Error loading photos:', error);
    } finally {
      setLoading(false);
    }
  };

  // Process pending photos with AI
  const processPendingPhotos = async () => {
    const pendingPhotos = photos.filter(p => p.processing_status === 'pending');
    
    if (pendingPhotos.length === 0) return;
    
    setIsOrganizing(true);
    
    try {
      for (const photo of pendingPhotos) {
        // Update status to processing
        await updatePhotoStatus(photo.id, 'processing');
        
        // Get AI suggestions
        const suggestions = await getAISuggestions(photo);
        
        // Update photo with suggestions
        await supabase
          .from('user_photo_album')
          .update({
            ai_suggestions: suggestions,
            processing_status: 'completed'
          })
          .eq('id', photo.id);
        
        // Auto-assign if high confidence
        if (suggestions.confidence > 0.8 && suggestions.vehicleId) {
          await assignPhotoToVehicle(photo.id, suggestions.vehicleId);
        }
      }
      
      // Reload photos
      await loadUserPhotos();
    } catch (error) {
      console.error('Error processing photos:', error);
    } finally {
      setIsOrganizing(false);
    }
  };

  // Get AI suggestions for a photo
  const getAISuggestions = async (photo: PhotoAlbumItem) => {
    try {
      // Use existing AI service
      const context = {
        userId: targetUserId!,
        recentActivity: {
          lastVehicleId: localStorage.getItem(`lastVehicle_${targetUserId}`),
          lastCategory: localStorage.getItem(`lastCategory_${targetUserId}`)
        }
      };
      
      // Simulate AI processing (would use actual AI service)
      return {
        vehicleId: context.recentActivity.lastVehicleId,
        vehicleName: 'Suggested Vehicle',
        category: 'general',
        confidence: 0.75
      };
    } catch (error) {
      console.error('Error getting AI suggestions:', error);
      return { confidence: 0 };
    }
  };

  // Update photo status
  const updatePhotoStatus = async (photoId: string, status: PhotoAlbumItem['processing_status']) => {
    setPhotos(prev => prev.map(p => 
      p.id === photoId ? { ...p, processing_status: status } : p
    ));
  };

  // Assign photo to vehicle
  const assignPhotoToVehicle = async (photoId: string, vehicleId: string) => {
    try {
      // Get vehicle details
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('id, year, make, model')
        .eq('id', vehicleId)
        .single();
      
      if (!vehicle) return;
      
      // Update photo assignment
      const { error } = await supabase
        .from('user_photo_album')
        .update({
          assigned_vehicle_id: vehicleId,
          assigned_vehicle_name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`
        })
        .eq('id', photoId);
      
      if (error) throw error;
      
      // Move photo to vehicle images
      const photo = photos.find(p => p.id === photoId);
      if (photo) {
        await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: vehicleId,
            user_id: targetUserId,
            image_url: photo.image_url,
            category: photo.category || 'general',
            tags: photo.tags,
            taken_at: photo.taken_date,
            metadata: photo.metadata
          });
      }
      
      // Reload photos
      await loadUserPhotos();
    } catch (error) {
      console.error('Error assigning photo:', error);
    }
  };

  // Bulk assign selected photos
  const bulkAssignPhotos = async (vehicleId: string) => {
    if (selectedPhotos.size === 0) return;
    
    setIsOrganizing(true);
    
    try {
      for (const photoId of selectedPhotos) {
        await assignPhotoToVehicle(photoId, vehicleId);
      }
      
      setSelectedPhotos(new Set());
    } catch (error) {
      console.error('Error bulk assigning photos:', error);
    } finally {
      setIsOrganizing(false);
    }
  };

  // Toggle photo selection
  const togglePhotoSelection = (photoId: string) => {
    setSelectedPhotos(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  // Select all photos
  const selectAllPhotos = () => {
    if (selectedPhotos.size === photos.length) {
      setSelectedPhotos(new Set());
    } else {
      setSelectedPhotos(new Set(photos.map(p => p.id)));
    }
  };

  const isOwner = targetUserId === user?.id;

  return (
    <div className="window" style={{ width: '100%', minHeight: '400px' }}>
      <div className="title-bar">
        <div className="title-bar-text">
          📸 {isOwner ? 'My' : 'User'} Photo Album
        </div>
        <div className="title-bar-controls">
          <button aria-label="Close" onClick={() => window.history.back()}></button>
        </div>
      </div>
      
      <div className="window-body" style={{ padding: '8px' }}>
        {/* Toolbar */}
        <div style={{ 
          display: 'flex', 
          gap: '8px', 
          marginBottom: '8px',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}>
          {/* Filter buttons */}
          <div className="field-row">
            <button 
              className={filter === 'all' ? 'active' : ''}
              onClick={() => setFilter('all')}
            >
              All ({photos.length})
            </button>
            <button 
              className={filter === 'unassigned' ? 'active' : ''}
              onClick={() => setFilter('unassigned')}
            >
              Unassigned
            </button>
            <button 
              className={filter === 'pending' ? 'active' : ''}
              onClick={() => setFilter('pending')}
            >
              Pending AI
            </button>
          </div>

          {/* Sort dropdown */}
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value as any)}
            style={{ fontSize: '8pt' }}
          >
            <option value="upload">Sort by Upload Date</option>
            <option value="taken">Sort by Taken Date</option>
            <option value="vehicle">Sort by Vehicle</option>
          </select>

          {/* View mode toggle */}
          <div className="field-row">
            <button 
              className={viewMode === 'grid' ? 'active' : ''}
              onClick={() => setViewMode('grid')}
            >
              Grid
            </button>
            <button 
              className={viewMode === 'list' ? 'active' : ''}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>

          <div style={{ flex: 1 }} />

          {/* Action buttons */}
          {isOwner && allowOrganization && (
            <>
              {selectedPhotos.size > 0 && (
                <button onClick={() => selectAllPhotos()}>
                  {selectedPhotos.size === photos.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
              
              <button 
                onClick={processPendingPhotos}
                disabled={isOrganizing || photos.filter(p => p.processing_status === 'pending').length === 0}
              >
                {isOrganizing ? 'Processing...' : '🤖 Process with AI'}
              </button>
            </>
          )}
        </div>

        {/* Selected photos actions */}
        {selectedPhotos.size > 0 && isOwner && (
          <div className="status-bar" style={{ marginBottom: '8px' }}>
            <p className="status-bar-field">
              {selectedPhotos.size} photo{selectedPhotos.size !== 1 ? 's' : ''} selected
            </p>
            <button 
              onClick={() => {
                // Open vehicle selector modal
                const vehicleId = prompt('Enter vehicle ID to assign photos:');
                if (vehicleId) {
                  bulkAssignPhotos(vehicleId);
                }
              }}
              style={{ marginLeft: '8px' }}
            >
              Assign to Vehicle
            </button>
          </div>
        )}

        {/* Photo grid/list */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div className="progress-bar">
              <div className="progress-bar-filled" style={{ width: '50%' }}></div>
            </div>
            <p>Loading photos...</p>
          </div>
        ) : photos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ fontSize: '10pt', color: '#666' }}>
              {filter === 'all' 
                ? 'No photos in your album yet. Start capturing!' 
                : `No ${filter} photos found.`}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: '8px',
            maxHeight: '400px',
            overflowY: 'auto'
          }}>
            {photos.map(photo => (
              <div 
                key={photo.id}
                className={`photo-item ${selectedPhotos.has(photo.id) ? 'selected' : ''}`}
                style={{
                  position: 'relative',
                  border: '2px solid #c0c0c0',
                  padding: '4px',
                  cursor: 'pointer',
                  background: selectedPhotos.has(photo.id) ? '#e0e0e0' : 'white'
                }}
                onClick={() => onPhotoSelect ? onPhotoSelect(photo) : togglePhotoSelection(photo.id)}
              >
                <img 
                  src={photo.thumbnail_url || photo.image_url}
                  alt=""
                  style={{
                    width: '100%',
                    height: '120px',
                    objectFit: 'cover'
                  }}
                />
                
                {/* Status indicators */}
                <div style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  display: 'flex',
                  gap: '4px'
                }}>
                  {photo.processing_status === 'pending' && (
                    <span title="Pending AI processing">⏳</span>
                  )}
                  {photo.assigned_vehicle_id && (
                    <span title={photo.assigned_vehicle_name}>🚗</span>
                  )}
                  {photo.ai_suggestions && photo.ai_suggestions.confidence > 0.7 && (
                    <span title="AI suggestion available">💡</span>
                  )}
                </div>

                {/* Photo info */}
                <div style={{ 
                  fontSize: '7pt', 
                  marginTop: '4px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {photo.assigned_vehicle_name || 'Unassigned'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Preview</th>
                  <th>Vehicle</th>
                  <th>Category</th>
                  <th>Uploaded</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {photos.map(photo => (
                  <tr key={photo.id}>
                    <td>
                      <img 
                        src={photo.thumbnail_url || photo.image_url}
                        alt=""
                        style={{ width: '40px', height: '40px', objectFit: 'cover' }}
                      />
                    </td>
                    <td>{photo.assigned_vehicle_name || 'Unassigned'}</td>
                    <td>{photo.category || '-'}</td>
                    <td>{new Date(photo.upload_date).toLocaleDateString()}</td>
                    <td>
                      {photo.processing_status === 'pending' && '⏳ Pending'}
                      {photo.processing_status === 'processing' && '⚙️ Processing'}
                      {photo.processing_status === 'completed' && '✅ Ready'}
                      {photo.processing_status === 'failed' && '❌ Failed'}
                    </td>
                    <td>
                      <button 
                        onClick={() => onPhotoSelect ? onPhotoSelect(photo) : togglePhotoSelection(photo.id)}
                        style={{ fontSize: '7pt' }}
                      >
                        {selectedPhotos.has(photo.id) ? 'Deselect' : 'Select'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* AI Suggestions Panel */}
        {isOwner && photos.some(p => p.ai_suggestions && !p.assigned_vehicle_id) && (
          <div className="status-bar" style={{ marginTop: '8px' }}>
            <p className="status-bar-field">
              💡 AI has suggestions for {photos.filter(p => p.ai_suggestions && !p.assigned_vehicle_id).length} photos
            </p>
            <button 
              onClick={() => {
                // Apply all high-confidence suggestions
                photos.forEach(photo => {
                  if (photo.ai_suggestions && 
                      photo.ai_suggestions.confidence > 0.8 && 
                      photo.ai_suggestions.vehicleId &&
                      !photo.assigned_vehicle_id) {
                    assignPhotoToVehicle(photo.id, photo.ai_suggestions.vehicleId);
                  }
                });
              }}
              style={{ marginLeft: 'auto' }}
            >
              Apply Suggestions
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserPhotoAlbum;