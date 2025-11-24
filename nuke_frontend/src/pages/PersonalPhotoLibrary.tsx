/**
 * Personal Photo Library - Professional Photo Management Tool
 * 
 * Designed like Apple Photos / Adobe Bridge for efficient organization:
 * - Left sidebar: Filters, albums, smart collections
 * - Center: Full-screen photo grid (zero gap)
 * - Right panel: Photo info (when selected)
 * - Bottom toolbar: Bulk actions (always visible)
 * - Keyboard shortcuts: Cmd+A, Space, Delete, Arrow keys
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PersonalPhotoLibraryService, PersonalPhoto, VehicleSuggestion } from '../services/personalPhotoLibraryService';
import { ImageUploadService } from '../services/imageUploadService';
import { supabase } from '../lib/supabase';

type GridDensity = 'small' | 'medium' | 'large';
type SortMode = 'date_new' | 'date_old' | 'filename' | 'size' | 'ai_confidence';

interface FilterState {
  hideOrganized: boolean;
  aiStatus: ('pending' | 'processing' | 'complete' | 'failed')[];
  vehicleDetected: 'all' | 'detected' | 'none' | 'uncertain';
  angles: string[];
  dateRange: { start: string | null; end: string | null };
}

export const PersonalPhotoLibrary: React.FC = () => {
  const navigate = useNavigate();
  
  // Core state
  const [photos, setPhotos] = useState<PersonalPhoto[]>([]);
  const [filteredPhotos, setFilteredPhotos] = useState<PersonalPhoto[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [currentPhotoId, setCurrentPhotoId] = useState<string | null>(null);
  
  // UI state
  const [gridDensity, setGridDensity] = useState<GridDensity>('medium');
  const [sortMode, setSortMode] = useState<SortMode>('date_new');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  
  // Filters
  const [filters, setFilters] = useState<FilterState>({
    hideOrganized: true, // Default ON - most important filter
    aiStatus: [],
    vehicleDetected: 'all',
    angles: [],
    dateRange: { start: null, end: null }
  });
  
  // Vehicles list for quick linking
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<VehicleSuggestion[]>([]);

  // Load data
  useEffect(() => {
    loadPhotos();
    loadVehicles();
    loadSuggestions();
  }, []);

  // Apply filters whenever photos or filters change
  useEffect(() => {
    applyFilters();
  }, [photos, filters, sortMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+A / Ctrl+A - Select all
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        selectAll();
      }
      // Delete - Delete selected
      if (e.key === 'Delete' && selectedPhotos.size > 0) {
        handleDelete();
      }
      // I - Toggle info panel
      if (e.key === 'i' || e.key === 'I') {
        setShowInfoPanel(prev => !prev);
      }
      // Escape - Clear selection
      if (e.key === 'Escape') {
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPhotos]);

  const loadPhotos = async () => {
    setLoading(true);
    try {
      const data = await PersonalPhotoLibraryService.getUnorganizedPhotos(5000);
      setPhotos(data);
    } catch (error) {
      console.error('Error loading photos:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadVehicles = async () => {
    const { data } = await supabase
      .from('vehicles')
      .select('id, year, make, model, trim')
      .order('year', { ascending: false });
    setVehicles(data || []);
  };

  const loadSuggestions = async () => {
    const data = await PersonalPhotoLibraryService.getVehicleSuggestions();
    setSuggestions(data);
  };

  const applyFilters = () => {
    let filtered = [...photos];

    // Hide organized
    if (filters.hideOrganized) {
      filtered = filtered.filter(p => p.organization_status === 'unorganized');
    }

    // AI status
    if (filters.aiStatus.length > 0) {
      filtered = filtered.filter(p => filters.aiStatus.includes(p.ai_processing_status));
    }

    // Vehicle detected
    if (filters.vehicleDetected === 'detected') {
      filtered = filtered.filter(p => p.ai_detected_vehicle);
    } else if (filters.vehicleDetected === 'none') {
      filtered = filtered.filter(p => !p.ai_detected_vehicle);
    } else if (filters.vehicleDetected === 'uncertain') {
      filtered = filtered.filter(p => p.ai_detected_vehicle && (p.ai_detected_vehicle.confidence || 0) < 0.7);
    }

    // Angle
    if (filters.angles.length > 0) {
      filtered = filtered.filter(p => p.ai_detected_angle && filters.angles.includes(p.ai_detected_angle));
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortMode) {
        case 'date_new':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'date_old':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'filename':
          return a.file_name.localeCompare(b.file_name);
        case 'size':
          return b.file_size - a.file_size;
        case 'ai_confidence':
          return (b.ai_detected_vehicle?.confidence || 0) - (a.ai_detected_vehicle?.confidence || 0);
        default:
          return 0;
      }
    });

    setFilteredPhotos(filtered);
  };

  // Selection
  const togglePhoto = (photoId: string) => {
    const newSelection = new Set(selectedPhotos);
    if (newSelection.has(photoId)) {
      newSelection.delete(photoId);
    } else {
      newSelection.add(photoId);
    }
    setSelectedPhotos(newSelection);
    
    // If only one selected, show info panel
    if (newSelection.size === 1) {
      setCurrentPhotoId(photoId);
      setShowInfoPanel(true);
    }
  };

  const selectAll = () => {
    if (selectedPhotos.size === filteredPhotos.length) {
      clearSelection();
    } else {
      setSelectedPhotos(new Set(filteredPhotos.map(p => p.id)));
    }
  };

  const clearSelection = () => {
    setSelectedPhotos(new Set());
    setCurrentPhotoId(null);
  };

  // Bulk actions
  const handleLinkToVehicle = async (vehicleId: string) => {
    try {
      await PersonalPhotoLibraryService.bulkLinkToVehicle(Array.from(selectedPhotos), vehicleId);
      clearSelection();
      loadPhotos();
    } catch (error) {
      alert('Failed to link photos');
    }
  };

  const handleMarkOrganized = async () => {
    try {
      await PersonalPhotoLibraryService.markAsOrganized(Array.from(selectedPhotos));
      clearSelection();
      loadPhotos();
    } catch (error) {
      alert('Failed to mark as organized');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete ${selectedPhotos.size} photos permanently?`)) return;
    
    try {
      await PersonalPhotoLibraryService.deletePhotos(Array.from(selectedPhotos));
      clearSelection();
      loadPhotos();
    } catch (error) {
      alert('Failed to delete photos');
    }
  };

  const handleBulkUpload = async (files: File[]) => {
    setUploading(true);
    setUploadProgress({ current: 0, total: files.length });

    for (let i = 0; i < files.length; i++) {
      try {
        await ImageUploadService.uploadImage(undefined, files[i], 'general');
        setUploadProgress({ current: i + 1, total: files.length });
      } catch (error) {
        console.error(`Failed to upload ${files[i].name}:`, error);
      }
    }

    setUploading(false);
    loadPhotos();
  };

  // Grid columns based on density
  const getGridColumns = () => {
    switch (gridDensity) {
      case 'small': return 8;
      case 'medium': return 5;
      case 'large': return 3;
    }
  };

  const currentPhoto = currentPhotoId ? photos.find(p => p.id === currentPhotoId) : null;

  if (loading) {
    return <div className="container" style={{ padding: '40px', textAlign: 'center' }}>
      <div className="text text-muted">Loading...</div>
    </div>;
  }

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100vh',
      overflow: 'hidden',
      background: 'var(--grey-50)'
    }}>
      {/* Top Toolbar */}
      <div style={{
        background: 'var(--white)',
        borderBottom: '1px solid var(--border-light)',
        padding: '8px 12px',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        flexShrink: 0
      }}>
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="button button-secondary"
          style={{ padding: '6px 12px', fontSize: '10pt' }}
        >
          {showSidebar ? '◀' : '▶'} Filters
        </button>

        <input
          type="text"
          placeholder="Search photos..."
          className="form-input"
          style={{ 
            flex: 1, 
            maxWidth: '300px',
            fontSize: '10pt',
            padding: '6px 10px'
          }}
        />

        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="form-select"
          style={{ fontSize: '10pt', padding: '6px 10px' }}
        >
          <option value="date_new">Newest First</option>
          <option value="date_old">Oldest First</option>
          <option value="filename">Filename</option>
          <option value="size">File Size</option>
          <option value="ai_confidence">AI Confidence</option>
        </select>

        <div style={{ display: 'flex', gap: '0', alignItems: 'center' }}>
          <span className="text text-small text-muted" style={{ marginRight: '8px' }}>View:</span>
          {(['small', 'medium', 'large'] as GridDensity[]).map((size, idx) => (
            <button
              key={size}
              onClick={() => setGridDensity(size)}
              className={`button ${gridDensity === size ? 'button-primary' : 'button-secondary'}`}
              style={{
                padding: '6px 12px',
                fontSize: '9pt',
                marginLeft: idx > 0 ? '-1px' : '0',
                textTransform: 'capitalize'
              }}
            >
              {size[0].toUpperCase()}
            </button>
          ))}
        </div>

        <input
          type="file"
          id="bulk-upload"
          multiple
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) handleBulkUpload(files);
          }}
        />
        <button
          onClick={() => document.getElementById('bulk-upload')?.click()}
          className="button button-primary"
          style={{ padding: '6px 16px', fontSize: '10pt' }}
        >
          Upload
        </button>
      </div>

      {/* Main Content Area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Sidebar - Filters */}
        {showSidebar && (
          <div style={{
            width: '220px',
            borderRight: '1px solid var(--border-light)',
            background: 'var(--white)',
            overflowY: 'auto',
            padding: '12px',
            flexShrink: 0
          }}>
            {/* Most Important Filter */}
            <div style={{ marginBottom: '16px' }}>
              <label className="text text-small" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={filters.hideOrganized}
                  onChange={(e) => setFilters(prev => ({ ...prev, hideOrganized: e.target.checked }))}
                  style={{ marginRight: '6px' }}
                />
                <strong>Hide Organized</strong>
              </label>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)', margin: '12px 0' }} />

            {/* AI Processing Status */}
            <div style={{ marginBottom: '16px' }}>
              <div className="text text-small font-bold" style={{ marginBottom: '6px', letterSpacing: '0.5px' }}>
                AI STATUS
              </div>
              {['pending', 'processing', 'complete', 'failed'].map(status => (
                <label key={status} className="text text-small" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={filters.aiStatus.includes(status as any)}
                    onChange={(e) => {
                      setFilters(prev => ({
                        ...prev,
                        aiStatus: e.target.checked
                          ? [...prev.aiStatus, status as any]
                          : prev.aiStatus.filter(s => s !== status)
                      }));
                    }}
                    style={{ marginRight: '6px' }}
                  />
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </label>
              ))}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)', margin: '12px 0' }} />

            {/* Vehicle Detection */}
            <div style={{ marginBottom: '16px' }}>
              <div className="text text-small font-bold" style={{ marginBottom: '6px', letterSpacing: '0.5px' }}>
                VEHICLE DETECTED
              </div>
              {[
                { value: 'all', label: 'All Photos' },
                { value: 'detected', label: 'Vehicle Found' },
                { value: 'none', label: 'No Vehicle' },
                { value: 'uncertain', label: 'Low Confidence' }
              ].map(opt => (
                <label key={opt.value} className="text text-small" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="vehicle-detected"
                    value={opt.value}
                    checked={filters.vehicleDetected === opt.value}
                    onChange={(e) => setFilters(prev => ({ ...prev, vehicleDetected: e.target.value as any }))}
                    style={{ marginRight: '6px' }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)', margin: '12px 0' }} />

            {/* Angle Filters */}
            <div style={{ marginBottom: '16px' }}>
              <div className="text text-small font-bold" style={{ marginBottom: '6px', letterSpacing: '0.5px' }}>
                ANGLE
              </div>
              {['front', 'rear', 'side', 'interior', 'engine_bay', 'undercarriage', 'detail'].map(angle => (
                <label key={angle} className="text text-small" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={filters.angles.includes(angle)}
                    onChange={(e) => {
                      setFilters(prev => ({
                        ...prev,
                        angles: e.target.checked
                          ? [...prev.angles, angle]
                          : prev.angles.filter(a => a !== angle)
                      }));
                    }}
                    style={{ marginRight: '6px' }}
                  />
                  {angle.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </label>
              ))}
            </div>

            {/* AI Suggestions */}
            {suggestions.length > 0 && (
              <>
                <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)', margin: '12px 0' }} />
                <div style={{ marginBottom: '16px' }}>
                  <div className="text text-small font-bold" style={{ marginBottom: '6px', letterSpacing: '0.5px' }}>
                    AI SUGGESTIONS ({suggestions.length})
                  </div>
                  {suggestions.slice(0, 5).map(s => (
                    <div
                      key={s.id}
                      className="text text-small"
                      style={{
                        padding: '6px',
                        background: 'var(--grey-100)',
                        border: '1px solid var(--border-light)',
                        marginBottom: '4px',
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        // Filter to show only photos in this suggestion
                        const suggestionPhotoIds = new Set(s.sample_image_ids);
                        setFilteredPhotos(photos.filter(p => suggestionPhotoIds.has(p.id)));
                      }}
                    >
                      <div className="font-bold">{s.suggested_year} {s.suggested_make}</div>
                      <div className="text-muted">{s.image_count} photos</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Center - Photo Grid */}
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--grey-100)' }}>
          {uploading ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <div className="text font-bold" style={{ marginBottom: '12px' }}>
                Uploading {uploadProgress.current} / {uploadProgress.total}
              </div>
              <div style={{
                width: '100%',
                maxWidth: '400px',
                margin: '0 auto',
                height: '20px',
                background: 'var(--grey-200)',
                border: '1px inset var(--border-medium)'
              }}>
                <div style={{
                  width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                  height: '100%',
                  background: 'var(--primary)',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          ) : filteredPhotos.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center' }}>
              <div className="text font-bold" style={{ fontSize: '12pt', marginBottom: '8px' }}>
                No Photos
              </div>
              <div className="text text-small text-muted">
                {filters.hideOrganized ? 'All photos are organized!' : 'Upload photos to get started'}
              </div>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${getGridColumns()}, 1fr)`,
              gap: '0'
            }}>
              {filteredPhotos.map(photo => {
                const isSelected = selectedPhotos.has(photo.id);
                const thumbnailUrl = photo.variants?.thumbnail || photo.variants?.small || photo.image_url;

                return (
                  <div
                    key={photo.id}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey) {
                        togglePhoto(photo.id);
                      } else if (e.shiftKey && selectedPhotos.size > 0) {
                        // Range select - simplified
                        togglePhoto(photo.id);
                      } else {
                        setSelectedPhotos(new Set([photo.id]));
                        setCurrentPhotoId(photo.id);
                        setShowInfoPanel(true);
                      }
                    }}
                    style={{
                      position: 'relative',
                      paddingBottom: '100%',
                      background: 'var(--grey-200)',
                      border: isSelected ? '3px solid var(--primary)' : '1px solid var(--border-light)',
                      cursor: 'pointer',
                      boxSizing: 'border-box'
                    }}
                  >
                    <img
                      src={thumbnailUrl}
                      alt={photo.file_name}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                      loading="lazy"
                    />

                    {/* Selection indicator */}
                    {isSelected && (
                      <div style={{
                        position: 'absolute',
                        top: '6px',
                        left: '6px',
                        width: '20px',
                        height: '20px',
                        background: 'var(--primary)',
                        border: '2px solid white',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 'bold'
                      }}>
                        ✓
                      </div>
                    )}

                    {/* AI Status badge */}
                    {photo.ai_processing_status !== 'complete' && gridDensity !== 'small' && (
                      <div style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        padding: '3px 6px',
                        background: photo.ai_processing_status === 'processing' ? '#ff9d00' : 'var(--grey-400)',
                        color: 'white',
                        fontSize: '7pt',
                        fontWeight: 'bold',
                        letterSpacing: '0.5px',
                        textTransform: 'uppercase'
                      }}>
                        {photo.ai_processing_status === 'processing' ? 'AI...' : 'PEND'}
                      </div>
                    )}

                    {/* Vehicle info (large grid only) */}
                    {gridDensity === 'large' && photo.ai_detected_vehicle && (
                      <div style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: 'rgba(255, 255, 255, 0.95)',
                        borderTop: '1px solid var(--border-light)',
                        padding: '6px',
                        fontSize: '8pt'
                      }}>
                        <div className="font-bold">
                          {photo.ai_detected_vehicle.year} {photo.ai_detected_vehicle.make}
                        </div>
                        {photo.ai_detected_angle && (
                          <div className="text-muted" style={{ fontSize: '7pt', textTransform: 'uppercase' }}>
                            {photo.ai_detected_angle.replace('_', ' ')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Panel - Photo Info */}
        {showInfoPanel && currentPhoto && (
          <div style={{
            width: '280px',
            borderLeft: '1px solid var(--border-light)',
            background: 'var(--white)',
            overflowY: 'auto',
            padding: '12px',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div className="text font-bold" style={{ fontSize: '10pt' }}>INFO</div>
              <button
                onClick={() => setShowInfoPanel(false)}
                className="button button-secondary"
                style={{ padding: '4px 8px', fontSize: '9pt' }}
              >
                ✕
              </button>
            </div>

            {/* Preview */}
            <img
              src={currentPhoto.variants?.medium || currentPhoto.image_url}
              alt={currentPhoto.file_name}
              style={{
                width: '100%',
                marginBottom: '12px',
                border: '1px solid var(--border-light)'
              }}
            />

            {/* File Info */}
            <div style={{ marginBottom: '12px' }}>
              <div className="text text-small text-muted" style={{ marginBottom: '2px' }}>FILENAME</div>
              <div className="text text-small" style={{ wordBreak: 'break-all' }}>{currentPhoto.file_name}</div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div className="text text-small text-muted" style={{ marginBottom: '2px' }}>SIZE</div>
              <div className="text text-small">{(currentPhoto.file_size / 1024 / 1024).toFixed(2)} MB</div>
            </div>

            {currentPhoto.taken_at && (
              <div style={{ marginBottom: '12px' }}>
                <div className="text text-small text-muted" style={{ marginBottom: '2px' }}>DATE TAKEN</div>
                <div className="text text-small">{new Date(currentPhoto.taken_at).toLocaleString()}</div>
              </div>
            )}

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)', margin: '12px 0' }} />

            {/* AI Analysis */}
            <div style={{ marginBottom: '12px' }}>
              <div className="text text-small text-muted" style={{ marginBottom: '4px' }}>AI ANALYSIS</div>
              <div className="text text-small">
                Status: <strong>{currentPhoto.ai_processing_status.toUpperCase()}</strong>
              </div>
            </div>

            {currentPhoto.ai_detected_vehicle && (
              <div style={{ marginBottom: '12px' }}>
                <div className="text text-small text-muted" style={{ marginBottom: '2px' }}>VEHICLE DETECTED</div>
                <div className="text text-small font-bold">
                  {currentPhoto.ai_detected_vehicle.year} {currentPhoto.ai_detected_vehicle.make} {currentPhoto.ai_detected_vehicle.model}
                </div>
                <div className="text text-small text-muted">
                  Confidence: {Math.round((currentPhoto.ai_detected_vehicle.confidence || 0) * 100)}%
                </div>
              </div>
            )}

            {currentPhoto.ai_detected_angle && (
              <div style={{ marginBottom: '12px' }}>
                <div className="text text-small text-muted" style={{ marginBottom: '2px' }}>ANGLE</div>
                <div className="text text-small">{currentPhoto.ai_detected_angle.replace('_', ' ').toUpperCase()}</div>
                <div className="text text-small text-muted">
                  Confidence: {Math.round((currentPhoto.ai_detected_angle_confidence || 0) * 100)}%
                </div>
              </div>
            )}

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)', margin: '12px 0' }} />

            {/* Quick Actions */}
            <div className="text text-small text-muted" style={{ marginBottom: '6px' }}>QUICK ACTIONS</div>
            <button
              onClick={() => {/* Open link to vehicle modal */}}
              className="button button-secondary"
              style={{ width: '100%', marginBottom: '6px', fontSize: '9pt', padding: '8px' }}
            >
              Link to Vehicle
            </button>
            <button
              onClick={async () => {
                await PersonalPhotoLibraryService.markAsOrganized([currentPhoto.id]);
                loadPhotos();
              }}
              className="button button-secondary"
              style={{ width: '100%', marginBottom: '6px', fontSize: '9pt', padding: '8px' }}
            >
              Mark as Organized
            </button>
            <button
              onClick={async () => {
                if (confirm('Delete this photo?')) {
                  await PersonalPhotoLibraryService.deletePhotos([currentPhoto.id]);
                  setShowInfoPanel(false);
                  loadPhotos();
                }
              }}
              className="button button-secondary"
              style={{ width: '100%', fontSize: '9pt', padding: '8px' }}
            >
              Delete Photo
            </button>
          </div>
        )}
      </div>

      {/* Bottom Toolbar - Bulk Actions */}
      <div style={{
        background: 'var(--white)',
        borderTop: '1px solid var(--border-light)',
        padding: '8px 12px',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        flexShrink: 0
      }}>
        <div className="text text-small" style={{ marginRight: '8px' }}>
          {selectedPhotos.size > 0 
            ? `${selectedPhotos.size} selected`
            : `${filteredPhotos.length} photos`
          }
        </div>

        {selectedPhotos.size > 0 && (
          <>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  handleLinkToVehicle(e.target.value);
                  e.target.value = '';
                }
              }}
              className="form-select"
              style={{ fontSize: '9pt', padding: '6px 10px' }}
            >
              <option value="">Link to Vehicle...</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>
                  {v.year} {v.make} {v.model}
                </option>
              ))}
            </select>

            <button
              onClick={handleMarkOrganized}
              className="button button-secondary"
              style={{ fontSize: '9pt', padding: '6px 12px' }}
            >
              Mark Organized
            </button>

            <button
              onClick={handleDelete}
              className="button button-secondary"
              style={{ fontSize: '9pt', padding: '6px 12px' }}
            >
              Delete
            </button>

            <button
              onClick={clearSelection}
              className="button button-secondary"
              style={{ fontSize: '9pt', padding: '6px 12px' }}
            >
              Clear
            </button>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setShowInfoPanel(!showInfoPanel)}
            className={`button ${showInfoPanel ? 'button-primary' : 'button-secondary'}`}
            style={{ fontSize: '9pt', padding: '6px 12px' }}
          >
            Info (I)
          </button>
          <button
            onClick={selectAll}
            className="button button-secondary"
            style={{ fontSize: '9pt', padding: '6px 12px' }}
          >
            Select All (⌘A)
          </button>
        </div>
      </div>
    </div>
  );
};
