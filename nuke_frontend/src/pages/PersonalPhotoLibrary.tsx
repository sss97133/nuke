/**
 * Personal Photo Library - Organization Tool
 * 
 * Goal: Organize 30,000 photos into vehicle profiles as fast as possible
 * Design: Full-screen photos, clickable sidebar, minimal UI
 * Version: 2.0
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PersonalPhotoLibraryService } from '../services/personalPhotoLibraryService';
import type { PersonalPhoto, VehicleSuggestion } from '../services/personalPhotoLibraryService';
import { ImageUploadService } from '../services/imageUploadService';
import { supabase } from '../lib/supabase';
import { ImageSetService } from '../services/imageSetService';
import type { ImageSet } from '../services/imageSetService';
import { useToast } from '../hooks/useToast';
import { InputDialog } from '../components/common/InputDialog';

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
  const [aiStatusCollapsed, setAiStatusCollapsed] = useState(false);
  const [showRestartWizard, setShowRestartWizard] = useState(false);
  const [showSubmitWizard, setShowSubmitWizard] = useState(false);
  const [submitVehicleId, setSubmitVehicleId] = useState<string | null>(null);
  const [editingAlbumId, setEditingAlbumId] = useState<string | null>(null);
  const [editingAlbumName, setEditingAlbumName] = useState('');
  const [albumNameDialog, setAlbumNameDialog] = useState<{ isOpen: boolean; defaultName: string }>({ isOpen: false, defaultName: '' });
  const [vehicleConversionDialog, setVehicleConversionDialog] = useState<{ isOpen: boolean; album: ImageSet | null; step: 'year' | 'make' | 'model' | 'trim' | 'vin'; values: { year?: string; make?: string; model?: string; trim?: string; vin?: string } }>({ isOpen: false, album: null, step: 'year', values: {} });
  
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

  const isAiCompleted = (status?: string | null) => status === 'complete' || status === 'completed';

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
      // Use optimized RPC functions for better performance
      const [photosResult, statsResult, vehiclesData, suggestionsData, albumsData] = await Promise.all([
        PersonalPhotoLibraryService.getUnorganizedPhotos(10000, 0),
        PersonalPhotoLibraryService.getLibraryStats(),
        supabase.from('vehicles').select('id, year, make, model, trim').order('year', { ascending: false }).then(r => r.data || []),
        PersonalPhotoLibraryService.getVehicleSuggestions(),
        ImageSetService.getPersonalAlbums()
      ]);

      const photosData = photosResult.photos;
      setAllPhotos(photosData);
      setVehicles(vehiclesData);
      setSuggestions(suggestionsData);
      setPersonalAlbums(albumsData);
      
      // Use stats from optimized RPC if available, otherwise calculate from photos
      const newCounts = {
        total: statsResult.total_photos || photosData.length,
        organized: statsResult.organized_photos || photosData.filter(p => p.organization_status === 'organized').length,
        unorganized: statsResult.unorganized_photos || photosData.filter(p => p.organization_status === 'unorganized').length,
        aiComplete: statsResult.ai_status_breakdown?.complete || photosData.filter(p => isAiCompleted(p.ai_processing_status)).length,
        aiPending: statsResult.ai_status_breakdown?.pending || photosData.filter(p => p.ai_processing_status === 'pending').length,
        aiProcessing: statsResult.ai_status_breakdown?.processing || photosData.filter(p => p.ai_processing_status === 'processing').length,
        aiFailed: statsResult.ai_status_breakdown?.failed || photosData.filter(p => p.ai_processing_status === 'failed').length,
        vehicleFound: statsResult.vehicle_detection?.found || photosData.filter(p => p.ai_detected_vehicle).length,
        noVehicle: statsResult.vehicle_detection?.not_found || photosData.filter(p => !p.ai_detected_vehicle).length,
        anglesFront: statsResult.angle_breakdown?.front || photosData.filter(p => p.ai_detected_angle?.includes('front')).length,
        anglesRear: statsResult.angle_breakdown?.rear || photosData.filter(p => p.ai_detected_angle?.includes('rear')).length,
        anglesSide: statsResult.angle_breakdown?.side || photosData.filter(p => p.ai_detected_angle?.includes('side')).length,
        anglesInterior: statsResult.angle_breakdown?.interior || photosData.filter(p => p.ai_detected_angle === 'interior').length,
        anglesEngineBay: statsResult.angle_breakdown?.engine_bay || photosData.filter(p => p.ai_detected_angle === 'engine_bay').length,
        anglesUndercarriage: statsResult.angle_breakdown?.undercarriage || photosData.filter(p => p.ai_detected_angle === 'undercarriage').length,
        anglesDetail: statsResult.angle_breakdown?.detail || photosData.filter(p => p.ai_detected_angle === 'detail').length
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
        filtered = filtered.filter(p => isAiCompleted(p.ai_processing_status));
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

  const handleAddToAlbum = async (albumId?: string) => {
    if (selectedPhotos.size === 0) {
      showToast('Select at least one photo first.', 'warning');
      return;
    }

    if (albumId) {
      // Add to existing album
      try {
        const added = await ImageSetService.addImagesToSet(albumId, Array.from(selectedPhotos));
        if (added === 0) {
          showToast('No new photos were added (they may already be in the album).', 'info');
        } else {
          showToast(`Added ${added} photo${added > 1 ? 's' : ''} to album.`, 'success');
          setSelectedPhotos(new Set());
        }
        await loadData();
      } catch (error: any) {
        console.error('Failed to add to album:', error);
        const message = error?.message || 'Failed to add photos to album.';
        showToast(message, 'error');
      }
      return;
    }

    // Create new album
    const defaultName = `Album ${new Date().toLocaleDateString()}`;
    setAlbumNameDialog({ isOpen: true, defaultName });
  };

  const handleRestartAIProcessing = async () => {
    try {
      // Reset failed and stuck pending photos to pending
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) {
        showToast('Not authenticated', 'error');
        return;
      }

      const { error } = await supabase
        .from('vehicle_images')
        .update({ 
          ai_processing_status: 'pending',
          ai_processing_started_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', session.session.user.id)
        .is('vehicle_id', null)
        .in('ai_processing_status', ['failed', 'pending']);

      if (error) throw error;

      showToast('AI processing restarted. Photos will be processed shortly.', 'success');
      setShowRestartWizard(false);
      await loadData();
    } catch (error) {
      console.error('Failed to restart AI processing:', error);
      showToast('Failed to restart AI processing.', 'error');
    }
  };

  const handleSubmitToVehicle = async () => {
    if (!submitVehicleId || selectedPhotos.size === 0) return;
    
    // Get vehicle details for confirmation
    const v = vehicles.find(vh => vh.id === submitVehicleId);
    const label = v ? `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'selected vehicle' : 'selected vehicle';
    
    // Show confirmation dialog
    const confirmed = window.confirm(
      `Submit ${selectedPhotos.size} photo${selectedPhotos.size > 1 ? 's' : ''} to:\n\n` +
      `${v?.year || '?'} ${v?.make || '?'} ${v?.model || '?'}\n\n` +
      `This will link the images to this vehicle.\n\n` +
      `Continue?`
    );
    
    if (!confirmed) {
      return;
    }
    
    try {
      await PersonalPhotoLibraryService.bulkLinkToVehicle(Array.from(selectedPhotos), submitVehicleId);
      showToast(`Submitted ${selectedPhotos.size} photo${selectedPhotos.size > 1 ? 's' : ''} to ${label}.`, 'success');
      setSelectedPhotos(new Set());
      setShowSubmitWizard(false);
      setSubmitVehicleId(null);
      await loadData();
    } catch (error) {
      console.error('Failed to submit photos:', error);
      showToast('Failed to submit photos to vehicle.', 'error');
    }
  };

  const handleUpdateAlbumName = async (albumId: string, newName: string) => {
    if (!newName.trim()) {
      showToast('Album name cannot be empty', 'warning');
      return;
    }

    try {
      await ImageSetService.updateImageSet(albumId, { name: newName.trim() });
      setEditingAlbumId(null);
      setEditingAlbumName('');
      await loadData();
      showToast('Album name updated', 'success');
    } catch (error) {
      console.error('Failed to update album name:', error);
      showToast('Failed to update album name', 'error');
    }
  };

  const handleConvertAlbumToVehicle = async (album: ImageSet) => {
    if (!album) return;
    if (!confirm(`Convert album "${album.name}" into a vehicle profile? This will create a vehicle and link all photos in the album.`)) {
      return;
    }

    // Try to extract vehicle info from album name (e.g. "1974 Ford Bronco")
    const nameParts = album.name.trim().split(/\s+/);
    let suggestedYear: string | null = null;
    let suggestedMake: string | null = null;
    let suggestedModel: string | null = null;

    // Try to parse year from beginning
    if (nameParts.length > 0 && /^\d{4}$/.test(nameParts[0])) {
      suggestedYear = nameParts[0];
      if (nameParts.length > 1) suggestedMake = nameParts[1];
      if (nameParts.length > 2) suggestedModel = nameParts.slice(2).join(' ');
    }

    setVehicleConversionDialog({
      isOpen: true,
      album,
      step: 'year',
      values: {
        year: suggestedYear || undefined,
        make: suggestedMake || undefined,
        model: suggestedModel || undefined
      }
    });
  };

  const handleVehicleConversionStep = async (value: string) => {
    const { album, step, values } = vehicleConversionDialog;
    if (!album) return;

    const newValues = { ...values };

    if (step === 'year') {
      const year = parseInt(value, 10);
      if (Number.isNaN(year)) {
        showToast('Year must be a number.', 'error');
        return;
      }
      newValues.year = value;
      setVehicleConversionDialog({ ...vehicleConversionDialog, step: 'make', values: newValues });
    } else if (step === 'make') {
      if (!value.trim()) {
        showToast('Make is required.', 'error');
        return;
      }
      newValues.make = value.trim();
      setVehicleConversionDialog({ ...vehicleConversionDialog, step: 'model', values: newValues });
    } else if (step === 'model') {
      if (!value.trim()) {
        showToast('Model is required.', 'error');
        return;
      }
      newValues.model = value.trim();
      setVehicleConversionDialog({ ...vehicleConversionDialog, step: 'trim', values: newValues });
    } else if (step === 'trim') {
      newValues.trim = value.trim() || undefined;
      setVehicleConversionDialog({ ...vehicleConversionDialog, step: 'vin', values: newValues });
    } else if (step === 'vin') {
      newValues.vin = value.trim() || undefined;
      
      // All steps complete, create vehicle
      try {
        const vehicleId = await ImageSetService.convertPersonalAlbumToVehicle({
          imageSetId: album.id,
          year: parseInt(newValues.year!, 10),
          make: newValues.make!,
          model: newValues.model!,
          trim: newValues.trim,
          vin: newValues.vin
        });

        // Update album name to match vehicle profile name
        const vehicleName = `${newValues.year} ${newValues.make} ${newValues.model}`.trim();
        try {
          await ImageSetService.updateImageSet(album.id, { name: vehicleName });
        } catch (e) {
          console.warn('Failed to update album name:', e);
        }

        // Reload data so inbox updates, then navigate to new profile
        setVehicleConversionDialog({ isOpen: false, album: null, step: 'year', values: {} });
        await loadData();
        showToast(`Album converted to vehicle profile: ${vehicleName}`, 'success');
        navigate(`/vehicle/${vehicleId}`);
      } catch (error) {
        console.error('Failed to convert album to vehicle:', error);
        showToast('Failed to convert album to vehicle profile.', 'error');
        setVehicleConversionDialog({ isOpen: false, album: null, step: 'year', values: {} });
      }
    }
  };

  const handleAlbumNameConfirm = async (name: string) => {
    if (!name || !name.trim()) {
      setAlbumNameDialog({ isOpen: false, defaultName: '' });
      return;
    }

    try {
      const album = await ImageSetService.createPersonalAlbum({ name: name.trim() });
      if (!album) {
        showToast('Failed to create album: No data returned', 'error');
        setAlbumNameDialog({ isOpen: false, defaultName: '' });
        return;
      }

      const added = await ImageSetService.addImagesToSet(album.id, Array.from(selectedPhotos));
      if (added === 0) {
        showToast('Album created but no new photos were added.', 'info');
      } else {
        showToast(`Created album "${name}" and added ${added} photo${added > 1 ? 's' : ''}.`, 'success');
        setSelectedPhotos(new Set());
      }

      setAlbumNameDialog({ isOpen: false, defaultName: '' });
      await loadData();
    } catch (error: any) {
      console.error('Failed to create album:', error);
      const message = error?.message || error?.toString() || 'Failed to create album. Check console for details.';
      showToast(message, 'error');
      setAlbumNameDialog({ isOpen: false, defaultName: '' });
      
      // If it's a database constraint error, suggest running migration
      if (message.includes('violates') || message.includes('constraint') || message.includes('null')) {
        console.error('Database schema issue detected. Make sure migration 20250125000000_fix_personal_albums_schema.sql has been applied.');
      }
    }
  };

  const [vehicleSectionCollapsed, setVehicleSectionCollapsed] = useState(false);
  const [anglesSectionCollapsed, setAnglesSectionCollapsed] = useState(false);
  const [vehicleProfilesCollapsed, setVehicleProfilesCollapsed] = useState(false);

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
        <div 
          style={{ 
            padding: '12px', 
            borderBottom: '1px solid var(--border-light)',
            cursor: 'pointer'
          }}
          onClick={(e) => {
            // Only toggle if clicking the row, not the text or status items
            if ((e.target as HTMLElement).closest('.ai-status-item') || (e.target as HTMLElement).closest('.ai-status-header')) {
              return;
            }
            setAiStatusCollapsed(!aiStatusCollapsed);
          }}
        >
          <div
            className="ai-status-header text text-small text-muted"
            style={{ 
              marginBottom: '8px', 
              letterSpacing: '0.5px', 
              cursor: 'pointer', 
              textDecoration: 'underline',
              pointerEvents: 'auto'
            }}
            onClick={(e) => {
              e.stopPropagation();
              handleAiStatusClick();
            }}
          >
            AI STATUS {aiStatusCollapsed ? '▼' : '▲'}
          </div>
          {!aiStatusCollapsed && [
            { key: 'ai_complete', label: 'Complete', count: counts.aiComplete, status: 'complete' },
            { key: 'ai_pending', label: 'Pending', count: counts.aiPending, status: 'pending' },
            { key: 'ai_processing', label: 'Processing', count: counts.aiProcessing, status: 'processing' },
            { key: 'ai_failed', label: 'Failed', count: counts.aiFailed, status: 'failed' }
          ].map(item => {
            const isProcessing = item.status === 'processing';
            const hasIssues = (item.status === 'failed' || item.status === 'pending') && item.count > 0;
            return (
              <div
                key={item.key}
                className="ai-status-item"
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasIssues && item.count > 0) {
                    setShowRestartWizard(true);
                  } else {
                    setActiveFilter(activeFilter === item.key ? null : item.key);
                  }
                }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '4px 6px',
                  marginBottom: '2px',
                  cursor: 'pointer',
                  background: activeFilter === item.key ? 'var(--grey-200)' : 'transparent',
                  border: activeFilter === item.key ? '1px solid var(--border-medium)' : '1px solid transparent',
                  pointerEvents: 'auto'
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {/* Status indicator light */}
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: isProcessing 
                        ? '#10b981' 
                        : hasIssues 
                          ? '#ef4444' 
                          : item.status === 'complete' 
                            ? '#10b981' 
                            : '#999',
                      display: 'inline-block',
                      boxShadow: isProcessing || hasIssues ? '0 0 4px currentColor' : 'none'
                    }}
                  />
                  <span className="text text-small">{item.label}</span>
                </span>
                <span className="text text-small font-bold">{item.count.toLocaleString()}</span>
              </div>
            );
          })}
        </div>

        {/* Vehicle Detection */}
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border-light)' }}>
          <div
            className="text text-small text-muted"
            style={{ marginBottom: '8px', letterSpacing: '0.5px', cursor: 'pointer', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setVehicleSectionCollapsed(!vehicleSectionCollapsed)}
          >
            <span>VEHICLE</span>
            <span style={{ fontSize: '9pt' }}>{vehicleSectionCollapsed ? '▼' : '▲'}</span>
          </div>
          {!vehicleSectionCollapsed && (
            <>
              <div
                className="text text-small text-muted"
                style={{ marginBottom: '4px', cursor: 'pointer' }}
                onClick={handleVehicleStatusClick}
              >
                Tap to see detection summary
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
            </>
          )}
        </div>

        {/* Angles */}
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border-light)' }}>
          <div
            className="text text-small text-muted"
            style={{ marginBottom: '8px', letterSpacing: '0.5px', cursor: 'pointer', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setAnglesSectionCollapsed(!anglesSectionCollapsed)}
          >
            <span>ANGLE</span>
            <span style={{ fontSize: '9pt' }}>{anglesSectionCollapsed ? '▼' : '▲'}</span>
          </div>
          {!anglesSectionCollapsed && (
            <>
              <div
                className="text text-small text-muted"
                style={{ marginBottom: '4px', cursor: 'pointer' }}
                onClick={handleAngleStatusClick}
              >
                Tap to see angle coverage summary
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
            </>
          )}
        </div>

        {/* Vehicle Profiles - Work Table */}
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border-light)' }}>
          <div
            className="text text-small text-muted"
            style={{ marginBottom: '6px', letterSpacing: '0.5px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setVehicleProfilesCollapsed(!vehicleProfilesCollapsed)}
          >
            <span>VEHICLE PROFILES</span>
            <span style={{ fontSize: '9pt' }}>{vehicleProfilesCollapsed ? '▼' : '▲'}</span>
          </div>
          {!vehicleProfilesCollapsed && (
            <>
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
                        onClick={() => {
                          if (selectedPhotos.size > 0) {
                            setSubmitVehicleId(v.id);
                            setShowSubmitWizard(true);
                          } else {
                            setActiveVehicleId(isActive ? null : v.id);
                          }
                        }}
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
              {activeVehicleId && selectedPhotos.size > 0 && (
                <button
                  onClick={() => {
                    setSubmitVehicleId(activeVehicleId);
                    setShowSubmitWizard(true);
                  }}
                  className="button button-primary"
                  style={{ width: '100%', marginTop: '6px', fontSize: '8pt', padding: '4px 6px' }}
                >
                  SUBMIT TO PROFILE
                </button>
              )}
            </>
          )}
        </div>

        {/* Personal Albums */}
        <div style={{ padding: '12px' }}>
          <div className="text text-small text-muted" style={{ marginBottom: '6px', letterSpacing: '0.5px' }}>
            ALBUMS
          </div>
          {personalAlbums.length === 0 ? (
            <div className="text text-small text-muted" style={{ marginBottom: '6px' }}>
              Albums are created from selected photos.
            </div>
          ) : (
            <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
              {personalAlbums.map(album => (
                <div
                  key={album.id}
                  style={{
                    border: '1px solid var(--border-light)',
                    padding: '4px 6px',
                    background: 'var(--grey-50)'
                  }}
                >
                  {editingAlbumId === album.id ? (
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '4px' }}>
                      <input
                        type="text"
                        value={editingAlbumName}
                        onChange={(e) => setEditingAlbumName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleUpdateAlbumName(album.id, editingAlbumName);
                          } else if (e.key === 'Escape') {
                            setEditingAlbumId(null);
                            setEditingAlbumName('');
                          }
                        }}
                        autoFocus
                        className="form-input"
                        style={{ fontSize: '8pt', padding: '2px 4px', flex: 1 }}
                      />
                      <button
                        onClick={() => handleUpdateAlbumName(album.id, editingAlbumName)}
                        className="button button-primary"
                        style={{ fontSize: '7pt', padding: '2px 4px' }}
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => {
                          setEditingAlbumId(null);
                          setEditingAlbumName('');
                        }}
                        className="button button-secondary"
                        style={{ fontSize: '7pt', padding: '2px 4px' }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div 
                      className="text" 
                      style={{ 
                        fontSize: '8pt', 
                        fontWeight: 600, 
                        marginBottom: '2px',
                        cursor: 'pointer',
                        textDecoration: 'underline'
                      }}
                      onClick={() => {
                        setEditingAlbumId(album.id);
                        setEditingAlbumName(album.name);
                      }}
                      title="Click to rename"
                    >
                      {album.name}
                    </div>
                  )}
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
          {selectedPhotos.size > 0 && (
            <button
              onClick={() => handleAddToAlbum()}
              className="button button-secondary"
              style={{ width: '100%', fontSize: '8pt', padding: '6px 10px' }}
            >
              {personalAlbums.length === 0 ? 'CREATE ALBUM' : 'ADD TO ALBUM'}
            </button>
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
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--grey-100)', position: 'relative' }}>
          {uploading && (
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 5,
                padding: '8px 12px',
                background: 'var(--white)',
                borderBottom: '1px solid var(--border-light)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <div className="text font-bold" style={{ fontSize: '11pt' }}>
                Uploading {uploadProgress.current} / {uploadProgress.total}
              </div>
              <div
                style={{
                  width: '100%',
                  height: '14px',
                  background: 'var(--grey-200)',
                  border: '1px solid var(--border-medium)'
                }}
              >
                <div
                  style={{
                    width: `${uploadProgress.total ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%`,
                    height: '100%',
                    background: 'var(--primary)',
                    transition: 'width 0.2s'
                  }}
                />
              </div>
            </div>
          )}
          {displayPhotos.length === 0 ? (
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
                        background: 'var(--surface-glass)',
                        borderTop: '1px solid var(--border)',
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

      {/* Restart AI Processing Wizard Modal */}
      {showRestartWizard && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={() => setShowRestartWizard(false)}
        >
          <div
            className="card"
            style={{
              background: 'var(--white)',
              padding: '20px',
              maxWidth: '400px',
              width: '90%',
              border: '2px solid var(--border)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text font-bold" style={{ marginBottom: '12px', fontSize: '11pt' }}>
              Restart AI Processing
            </div>
            <div className="text text-small" style={{ marginBottom: '16px' }}>
              This will reset all failed and pending photos back to the processing queue. 
              They will be analyzed by AI shortly.
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowRestartWizard(false)}
                className="button button-secondary"
                style={{ fontSize: '8pt', padding: '6px 12px' }}
              >
                Cancel
              </button>
              <button
                onClick={handleRestartAIProcessing}
                className="button button-primary"
                style={{ fontSize: '8pt', padding: '6px 12px' }}
              >
                Restart Processing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit to Vehicle Wizard Modal */}
      {showSubmitWizard && submitVehicleId && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={() => {
            setShowSubmitWizard(false);
            setSubmitVehicleId(null);
          }}
        >
          <div
            className="card"
            style={{
              background: 'var(--white)',
              padding: '20px',
              maxWidth: '400px',
              width: '90%',
              border: '2px solid var(--border)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text font-bold" style={{ marginBottom: '12px', fontSize: '11pt' }}>
              Submit to Vehicle
            </div>
            {(() => {
              const v = vehicles.find(vh => vh.id === submitVehicleId);
              const label = v ? `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'selected vehicle' : 'selected vehicle';
              return (
                <>
                  <div className="text text-small" style={{ marginBottom: '16px' }}>
                    Submit <strong>{selectedPhotos.size}</strong> photo{selectedPhotos.size > 1 ? 's' : ''} to <strong>"{label}"</strong>?
                  </div>
                  <div className="text text-small text-muted" style={{ marginBottom: '16px' }}>
                    The photos will be linked to this vehicle profile.
                  </div>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => {
                        setShowSubmitWizard(false);
                        setSubmitVehicleId(null);
                      }}
                      className="button button-secondary"
                      style={{ fontSize: '8pt', padding: '6px 12px' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmitToVehicle}
                      className="button button-primary"
                      style={{ fontSize: '8pt', padding: '6px 12px' }}
                    >
                      Submit
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Album Name Dialog */}
      <InputDialog
        isOpen={albumNameDialog.isOpen}
        title="New Album"
        message="Enter a name for the new album:"
        defaultValue={albumNameDialog.defaultName}
        onConfirm={handleAlbumNameConfirm}
        onCancel={() => setAlbumNameDialog({ isOpen: false, defaultName: '' })}
        confirmLabel="Create"
        required
      />

      {/* Vehicle Conversion Dialogs */}
      {vehicleConversionDialog.isOpen && vehicleConversionDialog.album && (
        <>
          {vehicleConversionDialog.step === 'year' && (
            <InputDialog
              isOpen={true}
              title="Convert Album to Vehicle"
              message="Enter the vehicle year:"
              defaultValue={vehicleConversionDialog.values.year || ''}
              placeholder="e.g. 1996"
              onConfirm={handleVehicleConversionStep}
              onCancel={() => setVehicleConversionDialog({ isOpen: false, album: null, step: 'year', values: {} })}
              confirmLabel="Next"
              required
            />
          )}
          {vehicleConversionDialog.step === 'make' && (
            <InputDialog
              isOpen={true}
              title="Convert Album to Vehicle"
              message="Enter the vehicle make:"
              defaultValue={vehicleConversionDialog.values.make || ''}
              placeholder="e.g. Ford"
              onConfirm={handleVehicleConversionStep}
              onCancel={() => setVehicleConversionDialog({ isOpen: false, album: null, step: 'year', values: {} })}
              confirmLabel="Next"
              required
            />
          )}
          {vehicleConversionDialog.step === 'model' && (
            <InputDialog
              isOpen={true}
              title="Convert Album to Vehicle"
              message="Enter the vehicle model:"
              defaultValue={vehicleConversionDialog.values.model || ''}
              placeholder="e.g. Bronco"
              onConfirm={handleVehicleConversionStep}
              onCancel={() => setVehicleConversionDialog({ isOpen: false, album: null, step: 'year', values: {} })}
              confirmLabel="Next"
              required
            />
          )}
          {vehicleConversionDialog.step === 'trim' && (
            <InputDialog
              isOpen={true}
              title="Convert Album to Vehicle"
              message="Enter the vehicle trim (optional):"
              defaultValue={vehicleConversionDialog.values.trim || ''}
              placeholder="Optional"
              onConfirm={handleVehicleConversionStep}
              onCancel={() => setVehicleConversionDialog({ isOpen: false, album: null, step: 'year', values: {} })}
              confirmLabel="Next"
            />
          )}
          {vehicleConversionDialog.step === 'vin' && (
            <InputDialog
              isOpen={true}
              title="Convert Album to Vehicle"
              message="Enter the VIN (optional but recommended):"
              defaultValue={vehicleConversionDialog.values.vin || ''}
              placeholder="17-character VIN"
              onConfirm={handleVehicleConversionStep}
              onCancel={() => setVehicleConversionDialog({ isOpen: false, album: null, step: 'year', values: {} })}
              confirmLabel="Create Vehicle"
            />
          )}
        </>
      )}
    </div>
  );
};
