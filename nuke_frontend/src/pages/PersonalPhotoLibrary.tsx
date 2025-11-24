/**
 * Personal Photo Library - Organization Tool
 * 
 * Goal: Organize 30,000 photos into vehicle profiles as fast as possible
 * Design: Full-screen photos, clickable sidebar, minimal UI
 * Version: 2.0
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PersonalPhotoLibraryService, PersonalPhoto, VehicleSuggestion } from '../services/personalPhotoLibraryService';
import { ImageUploadService } from '../services/imageUploadService';
import { supabase } from '../lib/supabase';
import { ImageSet, ImageSetService } from '../services/imageSetService';
import { useToast } from '../hooks/useToast';

type GridDensity = 'small' | 'medium' | 'large';

export const PersonalPhotoLibrary: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  
  // Core data
  const [allPhotos, setAllPhotos] = useState<PersonalPhoto[]>([]);
  const [displayPhotos, setDisplayPhotos] = useState<PersonalPhoto[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<VehicleSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [personalAlbums, setPersonalAlbums] = useState<ImageSet[]>([]);
  
  // UI state  
  const [hideOrganized, setHideOrganized] = useState(true); // Default: hide organized photos
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [gridDensity, setGridDensity] = useState<GridDensity>('medium');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [activeVehicleId, setActiveVehicleId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isTouchSelecting, setIsTouchSelecting] = useState(false);
  const [touchVisitedIds, setTouchVisitedIds] = useState<Set<string>>(new Set());
  
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
      const [photosData, vehiclesData, suggestionsData, albumsData] = await Promise.all([
        PersonalPhotoLibraryService.getUnorganizedPhotos(10000),
        supabase.from('vehicles').select('id, year, make, model, trim').order('year', { ascending: false }).then(r => r.data || []),
        PersonalPhotoLibraryService.getVehicleSuggestions(),
        ImageSetService.getPersonalAlbums()
      ]);

      setAllPhotos(photosData);
      setVehicles(vehiclesData);
      setSuggestions(suggestionsData);
      setPersonalAlbums(albumsData);
      
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
    if (!vehicleId || selectedPhotos.size === 0) return;
    const v = vehicles.find(vh => vh.id === vehicleId);
    const label = v ? `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'selected vehicle' : 'selected vehicle';
    const ok = window.confirm(`Send ${selectedPhotos.size} photos to "${label}"?\n\nThey will be attached to that vehicle profile.`);
    if (!ok) return;
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

  const filteredVehicles = vehicles.filter(v => {
    if (!vehicleSearch.trim()) return true;
    const q = vehicleSearch.toLowerCase();
    const text = `${v.year || ''} ${v.make || ''} ${v.model || ''} ${v.trim || ''}`.toLowerCase();
    return text.includes(q);
  });

  const handleAddToAlbum = async () => {
    if (selectedPhotos.size === 0) {
      alert('Select at least one photo first.');
      return;
    }

    const defaultName = `Album ${new Date().toLocaleDateString()}`;
    const name = window.prompt('Album name (existing or new):', defaultName);
    if (!name) return;

    try {
      // Try to find existing personal album by name
      let album = personalAlbums.find(a => a.name.toLowerCase() === name.toLowerCase());
      if (!album) {
        album = await ImageSetService.createPersonalAlbum({ name });
      }

      if (!album) {
        alert('Failed to create album');
        return;
      }

      const added = await ImageSetService.addImagesToSet(album.id, Array.from(selectedPhotos));
      if (added === 0) {
        alert('No new photos were added to the album (they may already be in it).');
      }

      // Refresh counts and album list
      await loadData();
    } catch (error) {
      console.error('Failed to add to album:', error);
      alert('Failed to add photos to album.');
    }
  };

  const handleConvertAlbumToVehicle = async (album: ImageSet) => {
    if (!album) return;
    if (!confirm(`Convert album "${album.name}" into a vehicle profile? This will create a vehicle and link all photos in the album.`)) {
      return;
    }

    const yearInput = window.prompt('Year (e.g. 1996):', '');
    if (!yearInput) return;
    const year = parseInt(yearInput, 10);
    if (Number.isNaN(year)) {
      alert('Year must be a number.');
      return;
    }

    const make = window.prompt('Make (e.g. Ford):', '') || '';
    if (!make.trim()) return;
    const model = window.prompt('Model (e.g. Bronco):', '') || '';
    if (!model.trim()) return;
    const trim = window.prompt('Trim (optional):', '') || undefined;
    const vin = window.prompt('VIN (recommended):', '') || undefined;

    try {
      const vehicleId = await ImageSetService.convertPersonalAlbumToVehicle({
        imageSetId: album.id,
        year,
        make: make.trim(),
        model: model.trim(),
        trim: trim?.trim() || undefined,
        vin: vin?.trim() || undefined
      });

      // Reload data so inbox updates, then navigate to new profile
      await loadData();
      navigate(`/vehicles/${vehicleId}`);
    } catch (error) {
      console.error('Failed to convert album to vehicle:', error);
      alert('Failed to convert album to vehicle profile.');
    }
  };

  const handleAiStatusClick = () => {
    const total =
      counts.aiComplete +
      counts.aiPending +
      counts.aiProcessing +
      counts.aiFailed;
    const inQueue = counts.aiPending + counts.aiProcessing;
    const message =
      total === 0
        ? 'AI has not processed any photos in this inbox yet. Newly uploaded images will be queued automatically after upload.'
        : `AI processing inbox: ${counts.aiComplete} complete, ${counts.aiPending} pending, ${counts.aiProcessing} processing, ${counts.aiFailed} failed. Queue size: ${inQueue}. Engine: personal-inbox-analyzer v1.`;
    showToast(message, 'info', 7000);
  };

  const handleVehicleStatusClick = () => {
    const message = `Vehicle detection: ${counts.vehicleFound} photos where a vehicle was detected, ${counts.noVehicle} with no vehicle detected. Detector: vision-vehicle-detector v1.`;
    showToast(message, 'info', 7000);
  };

  const handleAngleStatusClick = () => {
    const totalAngles =
      counts.anglesFront +
      counts.anglesRear +
      counts.anglesSide +
      counts.anglesInterior +
      counts.anglesEngineBay +
      counts.anglesDetail;
    const message =
      totalAngles === 0
        ? 'Angle analysis is enabled but no angles have been assigned in this inbox yet. As AI finishes, front / rear / side / interior / engine bay / detail counts will appear here.'
        : `Angle coverage so far — Front: ${counts.anglesFront}, Rear: ${counts.anglesRear}, Side: ${counts.anglesSide}, Interior: ${counts.anglesInterior}, Engine Bay: ${counts.anglesEngineBay}, Detail: ${counts.anglesDetail}.`;
    showToast(message, 'info', 8000);
  };

  const startTouchSelection = (e: React.TouchEvent<HTMLDivElement>) => {
    setIsTouchSelecting(true);
    const touch = e.touches[0];
    if (!touch) return;
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const tile = target?.closest('[data-photo-id]') as HTMLElement | null;
    const photoId = tile?.getAttribute('data-photo-id');
    if (!photoId) return;

    setSelectedPhotos(prev => {
      const next = new Set(prev);
      next.add(photoId);
      return next;
    });
    setTouchVisitedIds(new Set([photoId]));
  };

  const moveTouchSelection = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isTouchSelecting) return;
    const touch = e.touches[0];
    if (!touch) return;
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const tile = target?.closest('[data-photo-id]') as HTMLElement | null;
    const photoId = tile?.getAttribute('data-photo-id');
    if (!photoId) return;

    setTouchVisitedIds(prevVisited => {
      if (prevVisited.has(photoId)) return prevVisited;
      const nextVisited = new Set(prevVisited);
      nextVisited.add(photoId);
      setSelectedPhotos(prevSelected => {
        const nextSel = new Set(prevSelected);
        nextSel.add(photoId);
        return nextSel;
      });
      return nextVisited;
    });
  };

  const endTouchSelection = () => {
    setIsTouchSelecting(false);
    setTouchVisitedIds(new Set());
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
        width: sidebarCollapsed ? '40px' : '170px',
        borderRight: '1px solid var(--border-light)',
        background: 'var(--white)',
        overflowY: 'auto',
        flexShrink: 0
      }}>
        {/* Sidebar header / collapse toggle */}
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {!sidebarCollapsed && (
            <span className="text text-small text-muted" style={{ fontWeight: 600 }}>
              INBOX
            </span>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="button button-secondary"
            style={{ padding: '2px 4px', fontSize: '7pt' }}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </div>

        {!sidebarCollapsed && (
          <>
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
          <div
            className="text text-small text-muted"
            style={{ marginBottom: '8px', letterSpacing: '0.5px', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={handleAiStatusClick}
          >
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
          <div
            className="text text-small text-muted"
            style={{ marginBottom: '8px', letterSpacing: '0.5px', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={handleVehicleStatusClick}
          >
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
          <div
            className="text text-small text-muted"
            style={{ marginBottom: '8px', letterSpacing: '0.5px', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={handleAngleStatusClick}
          >
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

        {/* Vehicle Profiles - Work Table */}
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border-light)' }}>
          <div className="text text-small text-muted" style={{ marginBottom: '6px', letterSpacing: '0.5px' }}>
            VEHICLE PROFILES
          </div>
          <input
            type="text"
            placeholder="Filter..."
            value={vehicleSearch}
            onChange={(e) => setVehicleSearch(e.target.value)}
            className="form-input"
            style={{ width: '100%', fontSize: '8pt', marginBottom: '6px', padding: '4px 6px' }}
          />
          <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
            {filteredVehicles.length === 0 ? (
              <div className="text text-small text-muted">
                No matching vehicles
              </div>
            ) : (
              filteredVehicles.map(v => {
                const label = `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Untitled';
                const isActive = activeVehicleId === v.id;
                return (
                  <div
                    key={v.id}
                    onClick={() => setActiveVehicleId(isActive ? null : v.id)}
                    style={{
                      padding: '4px 6px',
                      marginBottom: '2px',
                      cursor: 'pointer',
                      background: isActive ? 'var(--grey-200)' : 'transparent',
                      border: isActive ? '1px solid var(--border-medium)' : '1px solid transparent',
                      fontSize: '8pt'
                    }}
                  >
                    {label}
                  </div>
                );
              })
            )}
          </div>
          {activeVehicleId && (
            <button
              onClick={() => navigate(`/vehicles/${activeVehicleId}`)}
              className="button button-secondary"
              style={{ width: '100%', marginTop: '6px', fontSize: '8pt', padding: '4px 6px' }}
            >
              OPEN PROFILE
            </button>
          )}
        </div>

        {/* Personal Albums */}
        <div style={{ padding: '12px' }}>
          <div className="text text-small text-muted" style={{ marginBottom: '6px', letterSpacing: '0.5px' }}>
            ALBUMS
          </div>
          {personalAlbums.length === 0 ? (
            <div className="text text-small text-muted">
              Albums are created from selected photos.
            </div>
          ) : (
            <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {personalAlbums.map(album => (
                <div
                  key={album.id}
                  style={{
                    border: '1px solid var(--border-light)',
                    padding: '4px 6px',
                    background: 'var(--grey-50)'
                  }}
                >
                  <div className="text" style={{ fontSize: '8pt', fontWeight: 600, marginBottom: '2px' }}>
                    {album.name}
                  </div>
                  <div className="text text-small text-muted" style={{ fontSize: '7pt', marginBottom: '4px' }}>
                    {(album.image_count || 0).toLocaleString()} photos
                  </div>
                  <button
                    onClick={() => handleConvertAlbumToVehicle(album)}
                    className="button button-secondary"
                    style={{ width: '100%', fontSize: '7pt', padding: '3px 4px' }}
                  >
                    CONVERT TO PROFILE
                  </button>
                </div>
              ))}
            </div>
          )}
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
        </>
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
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${getGridColumns()}, 1fr)`,
                gap: '0'
              }}
              onTouchStart={startTouchSelection}
              onTouchMove={moveTouchSelection}
              onTouchEnd={endTouchSelection}
              onTouchCancel={endTouchSelection}
            >
              {displayPhotos.map(photo => {
                const isSelected = selectedPhotos.has(photo.id);
                const thumbnailUrl =
                  gridDensity === 'large'
                    ? (photo.variants?.medium || photo.variants?.large || photo.image_url)
                    : gridDensity === 'medium'
                      ? (photo.variants?.small || photo.variants?.medium || photo.image_url)
                      : (photo.variants?.thumbnail || photo.variants?.small || photo.image_url);

                return (
                  <div
                    key={photo.id}
                    data-photo-id={photo.id}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey) {
                        const newSel = new Set(selectedPhotos);
                        if (newSel.has(photo.id)) newSel.delete(photo.id);
                        else newSel.add(photo.id);
                        setSelectedPhotos(newSel);
                      } else {
                        const newSel = new Set(selectedPhotos);
                        if (newSel.has(photo.id)) {
                          newSel.delete(photo.id);
                        } else {
                          newSel.add(photo.id);
                        }
                        setSelectedPhotos(newSel);
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

                    {/* Album count badge (personal or vehicle albums) */}
                    {photo.album_count > 0 && (
                      <div style={{
                        position: 'absolute',
                        bottom: '4px',
                        right: '4px',
                        padding: '2px 4px',
                        background: 'rgba(0,0,0,0.75)',
                        color: 'white',
                        fontSize: '7pt',
                        borderRadius: '0px',
                        border: '1px solid rgba(255,255,255,0.8)'
                      }}>
                        {photo.album_count} ALBUM{photo.album_count > 1 ? 'S' : ''}
                      </div>
                    )}

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
                        {photo.ai_processing_status === 'processing'
                          ? 'AI'
                          : photo.ai_processing_status === 'pending'
                            ? 'PEND'
                            : photo.ai_processing_status === 'failed'
                              ? 'ERR'
                              : 'AI'}
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
              <button
                onClick={handleAddToAlbum}
                className="button button-secondary"
                style={{ fontSize: '8pt', padding: '6px 10px' }}
              >
                ADD TO ALBUM
              </button>

              {activeVehicleId && (
                <button
                  onClick={() => handleLinkToVehicle(activeVehicleId)}
                  className="button button-secondary"
                  style={{ fontSize: '8pt', padding: '6px 10px' }}
                >
                  LINK TO ACTIVE PROFILE
                </button>
              )}

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
