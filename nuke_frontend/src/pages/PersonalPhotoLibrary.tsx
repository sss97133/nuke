/**
 * Personal Photo Library - Organization Tool
 * 
 * Goal: Organize 30,000 photos into vehicle profiles as fast as possible
 * Design: Full-screen photos, clickable sidebar, minimal UI
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PersonalPhotoLibraryService, PersonalPhoto, VehicleSuggestion } from '../services/personalPhotoLibraryService';
import { ImageUploadService } from '../services/imageUploadService';
import { supabase } from '../lib/supabase';

type GridDensity = 'small' | 'medium' | 'large';

export const PersonalPhotoLibrary: React.FC = () => {
  const navigate = useNavigate();
  
  // Core data
  const [allPhotos, setAllPhotos] = useState<PersonalPhoto[]>([]);
  const [displayPhotos, setDisplayPhotos] = useState<PersonalPhoto[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<VehicleSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  
  // UI state
  const [hideOrganized, setHideOrganized] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [gridDensity, setGridDensity] = useState<GridDensity>('medium');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  
  // Computed counts for sidebar
  const [counts, setCounts] = useState({
    total: 0,
    organized: 0,
    unorganized: 0,
    aiComplete: 0,
    aiPending: 0,
    aiProcessing: 0,
    aiFailed: 0,
    vehicleFound: 0,
    noVehicle: 0,
    anglesFront: 0,
    anglesRear: 0,
    anglesSide: 0,
    anglesInterior: 0,
    anglesEngineBay: 0,
    anglesUndercarriage: 0,
    anglesDetail: 0
  });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [allPhotos, hideOrganized, activeFilter]);

  useEffect(() => {
    // Keyboard shortcuts
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedPhotos(new Set(displayPhotos.map(p => p.id)));
      }
      if (e.key === 'Escape') {
        setSelectedPhotos(new Set());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [displayPhotos]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [photosData, vehiclesData, suggestionsData] = await Promise.all([
        PersonalPhotoLibraryService.getUnorganizedPhotos(10000),
        supabase.from('vehicles').select('id, year, make, model, trim').order('year', { ascending: false }).then(r => r.data || []),
        PersonalPhotoLibraryService.getVehicleSuggestions()
      ]);

      setAllPhotos(photosData);
      setVehicles(vehiclesData);
      setSuggestions(suggestionsData);
      
      // Calculate counts
      const newCounts = {
        total: photosData.length,
        organized: photosData.filter(p => p.organization_status === 'organized').length,
        unorganized: photosData.filter(p => p.organization_status === 'unorganized').length,
        aiComplete: photosData.filter(p => p.ai_processing_status === 'complete').length,
        aiPending: photosData.filter(p => p.ai_processing_status === 'pending').length,
        aiProcessing: photosData.filter(p => p.ai_processing_status === 'processing').length,
        aiFailed: photosData.filter(p => p.ai_processing_status === 'failed').length,
        vehicleFound: photosData.filter(p => p.ai_detected_vehicle).length,
        noVehicle: photosData.filter(p => !p.ai_detected_vehicle).length,
        anglesFront: photosData.filter(p => p.ai_detected_angle?.includes('front')).length,
        anglesRear: photosData.filter(p => p.ai_detected_angle?.includes('rear')).length,
        anglesSide: photosData.filter(p => p.ai_detected_angle?.includes('side')).length,
        anglesInterior: photosData.filter(p => p.ai_detected_angle === 'interior').length,
        anglesEngineBay: photosData.filter(p => p.ai_detected_angle === 'engine_bay').length,
        anglesUndercarriage: photosData.filter(p => p.ai_detected_angle === 'undercarriage').length,
        anglesDetail: photosData.filter(p => p.ai_detected_angle === 'detail').length
      };
      setCounts(newCounts);
      
    } catch (error) {
      console.error('Error loading:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...allPhotos];

    // Hide organized filter
    if (hideOrganized) {
      filtered = filtered.filter(p => p.organization_status === 'unorganized');
    }

    // Active filter
    if (activeFilter) {
      if (activeFilter === 'ai_complete') {
        filtered = filtered.filter(p => p.ai_processing_status === 'complete');
      } else if (activeFilter === 'ai_pending') {
        filtered = filtered.filter(p => p.ai_processing_status === 'pending');
      } else if (activeFilter === 'ai_processing') {
        filtered = filtered.filter(p => p.ai_processing_status === 'processing');
      } else if (activeFilter === 'ai_failed') {
        filtered = filtered.filter(p => p.ai_processing_status === 'failed');
      } else if (activeFilter === 'vehicle_found') {
        filtered = filtered.filter(p => p.ai_detected_vehicle);
      } else if (activeFilter === 'no_vehicle') {
        filtered = filtered.filter(p => !p.ai_detected_vehicle);
      } else if (activeFilter.startsWith('angle_')) {
        const angle = activeFilter.replace('angle_', '');
        filtered = filtered.filter(p => p.ai_detected_angle?.includes(angle));
      }
    }

    setDisplayPhotos(filtered);
  };

  const handleBulkUpload = async (files: File[]) => {
    setUploading(true);
    setUploadProgress({ current: 0, total: files.length });

    for (let i = 0; i < files.length; i++) {
      try {
        await ImageUploadService.uploadImage(undefined, files[i], 'general');
        setUploadProgress({ current: i + 1, total: files.length });
      } catch (error) {
        console.error(`Failed:`, error);
      }
    }

    setUploading(false);
    loadData();
  };

  const handleLinkToVehicle = async (vehicleId: string) => {
    try {
      await PersonalPhotoLibraryService.bulkLinkToVehicle(Array.from(selectedPhotos), vehicleId);
      setSelectedPhotos(new Set());
      loadData();
    } catch (error) {
      alert('Failed to link photos');
    }
  };

  const handleMarkOrganized = async () => {
    try {
      await PersonalPhotoLibraryService.markAsOrganized(Array.from(selectedPhotos));
      setSelectedPhotos(new Set());
      loadData();
    } catch (error) {
      alert('Failed');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete ${selectedPhotos.size} photos?`)) return;
    try {
      await PersonalPhotoLibraryService.deletePhotos(Array.from(selectedPhotos));
      setSelectedPhotos(new Set());
      loadData();
    } catch (error) {
      alert('Failed to delete');
    }
  };

  const handleAcceptSuggestion = async (suggestion: VehicleSuggestion) => {
    try {
      await PersonalPhotoLibraryService.acceptVehicleSuggestion(suggestion.id, {
        year: suggestion.suggested_year || 2000,
        make: suggestion.suggested_make || 'Unknown',
        model: suggestion.suggested_model || 'Unknown',
        trim: suggestion.suggested_trim,
        vin: suggestion.suggested_vin
      });
      loadData();
    } catch (error) {
      alert('Failed to accept suggestion');
    }
  };

  const getGridColumns = () => {
    switch (gridDensity) {
      case 'small': return 8;
      case 'medium': return 5;
      case 'large': return 3;
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="text text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
      {/* LEFT SIDEBAR - Clickable Filters */}
      <div style={{
        width: '200px',
        borderRight: '1px solid var(--border-light)',
        background: 'var(--white)',
        overflowY: 'auto',
        flexShrink: 0
      }}>
        {/* Upload Button */}
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border-light)' }}>
          <input
            type="file"
            id="upload-input"
            multiple
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length) handleBulkUpload(files);
            }}
          />
          <button
            onClick={() => document.getElementById('upload-input')?.click()}
            className="button button-primary"
            style={{ width: '100%', padding: '8px', fontSize: '9pt' }}
          >
            UPLOAD PHOTOS
          </button>
        </div>

        {/* Hide Organized Toggle */}
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border-light)' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={hideOrganized}
              onChange={(e) => setHideOrganized(e.target.checked)}
              style={{ marginRight: '6px' }}
            />
            <span className="text text-small font-bold">Hide Organized</span>
          </label>
        </div>

        {/* AI Status */}
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border-light)' }}>
          <div className="text text-small text-muted" style={{ marginBottom: '8px', letterSpacing: '0.5px' }}>
            AI STATUS
          </div>
          {[
            { key: 'ai_complete', label: 'Complete', count: counts.aiComplete },
            { key: 'ai_pending', label: 'Pending', count: counts.aiPending },
            { key: 'ai_processing', label: 'Processing', count: counts.aiProcessing },
            { key: 'ai_failed', label: 'Failed', count: counts.aiFailed }
          ].map(item => (
            <div
              key={item.key}
              onClick={() => setActiveFilter(activeFilter === item.key ? null : item.key)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 6px',
                marginBottom: '2px',
                cursor: 'pointer',
                background: activeFilter === item.key ? 'var(--grey-200)' : 'transparent',
                border: activeFilter === item.key ? '1px solid var(--border-medium)' : '1px solid transparent'
              }}
            >
              <span className="text text-small">{item.label}</span>
              <span className="text text-small font-bold">{item.count.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Vehicle Detection */}
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border-light)' }}>
          <div className="text text-small text-muted" style={{ marginBottom: '8px', letterSpacing: '0.5px' }}>
            VEHICLE
          </div>
          {[
            { key: 'vehicle_found', label: 'Detected', count: counts.vehicleFound },
            { key: 'no_vehicle', label: 'Not Found', count: counts.noVehicle }
          ].map(item => (
            <div
              key={item.key}
              onClick={() => setActiveFilter(activeFilter === item.key ? null : item.key)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 6px',
                marginBottom: '2px',
                cursor: 'pointer',
                background: activeFilter === item.key ? 'var(--grey-200)' : 'transparent',
                border: activeFilter === item.key ? '1px solid var(--border-medium)' : '1px solid transparent'
              }}
            >
              <span className="text text-small">{item.label}</span>
              <span className="text text-small font-bold">{item.count.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Angles */}
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border-light)' }}>
          <div className="text text-small text-muted" style={{ marginBottom: '8px', letterSpacing: '0.5px' }}>
            ANGLE
          </div>
          {[
            { key: 'angle_front', label: 'Front', count: counts.anglesFront },
            { key: 'angle_rear', label: 'Rear', count: counts.anglesRear },
            { key: 'angle_side', label: 'Side', count: counts.anglesSide },
            { key: 'angle_interior', label: 'Interior', count: counts.anglesInterior },
            { key: 'angle_engine', label: 'Engine Bay', count: counts.anglesEngineBay },
            { key: 'angle_detail', label: 'Detail', count: counts.anglesDetail }
          ].map(item => (
            <div
              key={item.key}
              onClick={() => setActiveFilter(activeFilter === item.key ? null : item.key)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 6px',
                marginBottom: '2px',
                cursor: item.count > 0 ? 'pointer' : 'default',
                opacity: item.count === 0 ? 0.4 : 1,
                background: activeFilter === item.key ? 'var(--grey-200)' : 'transparent',
                border: activeFilter === item.key ? '1px solid var(--border-medium)' : '1px solid transparent'
              }}
            >
              <span className="text text-small">{item.label}</span>
              <span className="text text-small font-bold">{item.count.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* AI Suggestions */}
        {suggestions.length > 0 && (
          <div style={{ padding: '12px' }}>
            <div className="text text-small text-muted" style={{ marginBottom: '8px', letterSpacing: '0.5px' }}>
              AI SUGGESTIONS
            </div>
            {suggestions.map(s => (
              <div
                key={s.id}
                style={{
                  padding: '8px',
                  marginBottom: '8px',
                  border: '1px solid var(--border-light)',
                  background: 'var(--grey-50)'
                }}
              >
                <div className="text text-small font-bold" style={{ marginBottom: '2px' }}>
                  {s.suggested_year} {s.suggested_make} {s.suggested_model}
                </div>
                <div className="text text-small text-muted" style={{ marginBottom: '6px' }}>
                  {s.image_count} photos • {Math.round(s.confidence * 100)}%
                </div>
                <button
                  onClick={() => handleAcceptSuggestion(s)}
                  className="button button-primary"
                  style={{ width: '100%', padding: '6px', fontSize: '8pt' }}
                >
                  ACCEPT & CREATE
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CENTER - Photo Grid */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top Bar */}
        <div style={{
          background: 'var(--white)',
          borderBottom: '1px solid var(--border-light)',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div className="text text-small">
            Showing: {displayPhotos.length.toLocaleString()} 
            {activeFilter && ' (filtered)'}
          </div>
          
          {activeFilter && (
            <button
              onClick={() => setActiveFilter(null)}
              className="button button-secondary"
              style={{ padding: '4px 8px', fontSize: '8pt' }}
            >
              CLEAR FILTER
            </button>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0' }}>
            <span className="text text-small text-muted" style={{ marginRight: '8px', alignSelf: 'center' }}>
              Grid:
            </span>
            {(['small', 'medium', 'large'] as GridDensity[]).map((size, idx) => (
              <button
                key={size}
                onClick={() => setGridDensity(size)}
                className={`button ${gridDensity === size ? 'button-primary' : 'button-secondary'}`}
                style={{
                  padding: '6px 10px',
                  fontSize: '8pt',
                  marginLeft: idx > 0 ? '-1px' : '0',
                  textTransform: 'uppercase'
                }}
              >
                {size[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Photo Grid */}
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--grey-100)' }}>
          {uploading ? (
            <div style={{ padding: '60px 20px', textAlign: 'center' }}>
              <div className="text font-bold" style={{ fontSize: '12pt', marginBottom: '16px' }}>
                Uploading {uploadProgress.current} / {uploadProgress.total}
              </div>
              <div style={{
                width: '100%',
                maxWidth: '500px',
                margin: '0 auto',
                height: '24px',
                background: 'var(--grey-200)',
                border: '2px inset var(--border-medium)'
              }}>
                <div style={{
                  width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                  height: '100%',
                  background: 'var(--primary)',
                  transition: 'width 0.2s'
                }} />
              </div>
            </div>
          ) : displayPhotos.length === 0 ? (
            <div style={{ 
              padding: '80px 20px', 
              textAlign: 'center',
              background: 'var(--white)',
              border: '1px solid var(--border-light)',
              margin: '20px'
            }}>
              <div className="text font-bold" style={{ fontSize: '12pt', marginBottom: '8px' }}>
                {activeFilter ? 'No photos match filter' : hideOrganized ? 'All photos organized!' : 'No photos yet'}
              </div>
              <div className="text text-small text-muted">
                {activeFilter ? 'Try a different filter' : 'Upload photos to get started'}
              </div>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${getGridColumns()}, 1fr)`,
              gap: '0'
            }}>
              {displayPhotos.map(photo => {
                const isSelected = selectedPhotos.has(photo.id);
                const thumbnailUrl = photo.variants?.thumbnail || photo.variants?.small || photo.image_url;

                return (
                  <div
                    key={photo.id}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey) {
                        const newSel = new Set(selectedPhotos);
                        if (newSel.has(photo.id)) newSel.delete(photo.id);
                        else newSel.add(photo.id);
                        setSelectedPhotos(newSel);
                      } else {
                        setSelectedPhotos(new Set([photo.id]));
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
                      alt=""
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

                    {isSelected && (
                      <div style={{
                        position: 'absolute',
                        top: '6px',
                        left: '6px',
                        width: '18px',
                        height: '18px',
                        background: 'var(--primary)',
                        border: '2px solid white',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: 'bold'
                      }}>
                        ✓
                      </div>
                    )}

                    {/* AI Status (if not complete) */}
                    {photo.ai_processing_status !== 'complete' && gridDensity !== 'small' && (
                      <div style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        padding: '2px 5px',
                        background: photo.ai_processing_status === 'processing' ? '#ff9d00' : '#999',
                        color: 'white',
                        fontSize: '7pt',
                        fontWeight: 'bold'
                      }}>
                        {photo.ai_processing_status === 'processing' ? 'AI' : '...'}
                      </div>
                    )}

                    {/* Vehicle info (large only) */}
                    {gridDensity === 'large' && photo.ai_detected_vehicle && (
                      <div style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: 'rgba(255,255,255,0.95)',
                        borderTop: '1px solid var(--border-light)',
                        padding: '4px 6px'
                      }}>
                        <div className="text font-bold" style={{ fontSize: '8pt' }}>
                          {photo.ai_detected_vehicle.year} {photo.ai_detected_vehicle.make}
                        </div>
                        {photo.ai_detected_angle && (
                          <div className="text text-muted" style={{ fontSize: '7pt' }}>
                            {photo.ai_detected_angle.replace('_', ' ').toUpperCase()}
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

        {/* BOTTOM TOOLBAR */}
        <div style={{
          background: 'var(--white)',
          borderTop: '1px solid var(--border-light)',
          padding: '8px 12px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}>
          <div className="text text-small" style={{ marginRight: '8px' }}>
            {selectedPhotos.size > 0 
              ? `${selectedPhotos.size} selected`
              : `${displayPhotos.length} photos`
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
                style={{ fontSize: '9pt', padding: '4px 8px' }}
              >
                <option value="">Link to...</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.year} {v.make} {v.model}
                  </option>
                ))}
              </select>

              <button
                onClick={handleMarkOrganized}
                className="button button-secondary"
                style={{ fontSize: '8pt', padding: '6px 10px' }}
              >
                ORGANIZED
              </button>

              <button
                onClick={handleDelete}
                className="button button-secondary"
                style={{ fontSize: '8pt', padding: '6px 10px' }}
              >
                DELETE
              </button>

              <button
                onClick={() => setSelectedPhotos(new Set())}
                className="button button-secondary"
                style={{ fontSize: '8pt', padding: '6px 10px' }}
              >
                CLEAR
              </button>
            </>
          )}

          <button
            onClick={() => setSelectedPhotos(new Set(displayPhotos.map(p => p.id)))}
            className="button button-secondary"
            style={{ marginLeft: 'auto', fontSize: '8pt', padding: '6px 10px' }}
          >
            SELECT ALL
          </button>
        </div>
      </div>
    </div>
  );
};
