/**
 * Personal Photo Library - Organization Tool
 * 
 * Goal: Organize 30,000 photos into vehicle profiles as fast as possible
 * Design: Full-screen photos, clickable sidebar, minimal UI
 * Version: 2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PersonalPhotoLibraryService } from '../services/personalPhotoLibraryService';
import type { VehicleSuggestion } from '../services/personalPhotoLibraryService';
import { ImageUploadService } from '../services/imageUploadService';
import { supabase } from '../lib/supabase';
import { readCachedSession } from '../utils/cachedSession';
import { ImageSetService } from '../services/imageSetService';
import type { ImageSet } from '../services/imageSetService';
import { useToast } from '../hooks/useToast';
import { InputDialog } from '../components/common/InputDialog';
import { usePhotoLibrary } from '../hooks/usePhotoLibrary';
import { PhotoGrid } from '../components/photos/PhotoGrid';
import { TimelineScrubber } from '../components/photos/TimelineScrubber';
import { QuickLook } from '../components/photos/QuickLook';
import { usePersistedState } from '../hooks/usePersistedState';
import type { Virtualizer } from '@tanstack/react-virtual';

export const PersonalPhotoLibrary: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null);

  // Core data — photos come from usePhotoLibrary (virtualized infinite query)
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<VehicleSuggestion[]>([]);
  const [loading, setLoading] = useState(() => readCachedSession() === null);
  const [personalAlbums, setPersonalAlbums] = useState<ImageSet[]>([]);
  
  // UI state — persisted across sessions
  const [hideOrganized, setHideOrganized] = usePersistedState('nuke:photolib:hideOrganized', true);
  const [gridColumns, setGridColumns] = usePersistedState<number>('nuke:photolib:columns', 5);
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState('nuke:photolib:sidebar', false);

  // UI state — transient
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [activeVehicleId, setActiveVehicleId] = useState<string | null>(null);

  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [isTouchSelecting, setIsTouchSelecting] = useState(false);
  const [touchVisitedIds, setTouchVisitedIds] = useState<Set<string>>(new Set());
  const [aiStatusCollapsed, setAiStatusCollapsed] = useState(true); // collapsed by default, expands when counts load
  const [quickLookPhotoId, setQuickLookPhotoId] = useState<string | null>(null);
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

  // Virtualized infinite photo query — replaces allPhotos/displayPhotos/loadData/applyFilters
  const {
    photos: displayPhotos,
    totalCount,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isLoading: photosLoading,
    refetch: refetchPhotos,
  } = usePhotoLibrary({
    hideOrganized,
    filterStatus: activeFilter,
  });

  // Sticky date label state
  const [currentDateLabel, setCurrentDateLabel] = useState<string | null>(null);

  // Timeline scrubber data
  const [dateSummary, setDateSummary] = useState<Array<{ month: string; count: number }>>([]);

  // Map month → first virtual row index (computed from displayPhotos)
  const monthToRowIndex = React.useMemo(() => {
    const map = new Map<string, number>();
    // Simplified: we store month labels and their first occurrence index
    // PhotoGrid builds its own date groups, so this is for the scrubber jump
    const monthFormatter = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long' });
    let currentMonth = '';
    let virtualRowIdx = 0;
    const columns = gridColumns;

    for (let i = 0; i < displayPhotos.length; i++) {
      const photo = displayPhotos[i];
      const dateStr = photo.taken_at || photo.created_at;
      const month = dateStr ? monthFormatter.format(new Date(dateStr)) : 'Unknown';
      const monthKey = dateStr ? dateStr.substring(0, 7) : 'unknown';

      if (month !== currentMonth) {
        // Header row
        if (!map.has(monthKey)) {
          map.set(monthKey, virtualRowIdx);
        }
        virtualRowIdx++; // header row
        currentMonth = month;
        // Photo rows for this group start here
      }
    }
    return map;
  }, [displayPhotos, gridColumns]);

  // Load sidebar data (stats, vehicles, suggestions, albums) — separate from photos
  useEffect(() => {
    loadSidebarData();
  }, []);

  // Load date summary for timeline scrubber
  useEffect(() => {
    PersonalPhotoLibraryService.getPhotoDateSummary(hideOrganized)
      .then(setDateSummary)
      .catch(console.error);
  }, [hideOrganized]);

  // QuickLook navigation helpers
  const quickLookNavigate = useCallback(
    (direction: 1 | -1) => {
      setQuickLookPhotoId((currentId) => {
        if (!currentId) return null;
        const idx = displayPhotos.findIndex((p) => p.id === currentId);
        if (idx < 0) return currentId;
        const nextIdx = idx + direction;
        if (nextIdx >= 0 && nextIdx < displayPhotos.length) {
          return displayPhotos[nextIdx].id;
        }
        return currentId;
      });
    },
    [displayPhotos],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedPhotos(new Set(displayPhotos.map(p => p.id)));
        return;
      }
      if (e.key === 'Escape') {
        // Close QuickLook first, then clear selection
        if (quickLookPhotoId) {
          setQuickLookPhotoId(null);
        } else {
          setSelectedPhotos(new Set());
        }
        return;
      }
      // Spacebar quick-look: toggle preview for last-clicked/selected photo
      if (e.key === ' ' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setQuickLookPhotoId((prev) => {
          if (prev) return null;
          const sel = Array.from(selectedPhotos);
          return sel.length > 0 ? sel[sel.length - 1] : null;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [displayPhotos, selectedPhotos, quickLookPhotoId]);

  const loadSidebarData = async () => {
    setLoading(true);
    try {
      const [statsResult, vehiclesData, suggestionsData, albumsData] = await Promise.all([
        PersonalPhotoLibraryService.getLibraryStats(),
        supabase.from('vehicles').select('id, year, make, model, trim').order('year', { ascending: false }).limit(500).then(r => {
          if (r.error) console.error('[PhotoLibrary] Vehicle query error:', r.error);
          return r.data || [];
        }),
        PersonalPhotoLibraryService.getVehicleSuggestions(),
        ImageSetService.getPersonalAlbums()
      ]);

      setVehicles(vehiclesData);
      setSuggestions(suggestionsData);
      setPersonalAlbums(albumsData);

      const newCounts = {
        total: statsResult.total_photos || 0,
        organized: statsResult.organized_photos || 0,
        unorganized: statsResult.unorganized_photos || 0,
        aiComplete: statsResult.ai_status_breakdown?.complete || 0,
        aiPending: statsResult.ai_status_breakdown?.pending || 0,
        aiProcessing: statsResult.ai_status_breakdown?.processing || 0,
        aiFailed: statsResult.ai_status_breakdown?.failed || 0,
        vehicleFound: statsResult.vehicle_detection?.found || 0,
        noVehicle: statsResult.vehicle_detection?.not_found || 0,
        anglesFront: statsResult.angle_breakdown?.front || 0,
        anglesRear: statsResult.angle_breakdown?.rear || 0,
        anglesSide: statsResult.angle_breakdown?.side || 0,
        anglesInterior: statsResult.angle_breakdown?.interior || 0,
        anglesEngineBay: statsResult.angle_breakdown?.engine_bay || 0,
        anglesUndercarriage: statsResult.angle_breakdown?.undercarriage || 0,
        anglesDetail: statsResult.angle_breakdown?.detail || 0
      };
      setCounts(newCounts);

      // Auto-expand sections only when they have non-zero counts
      const hasAiData = newCounts.aiComplete + newCounts.aiPending + newCounts.aiProcessing + newCounts.aiFailed > 0;
      if (hasAiData) setAiStatusCollapsed(false);
      const hasVehicleData = newCounts.vehicleFound + newCounts.noVehicle > 0;
      if (hasVehicleData) setVehicleSectionCollapsed(false);
      const hasAngleData = newCounts.anglesFront + newCounts.anglesRear + newCounts.anglesSide + newCounts.anglesInterior + newCounts.anglesEngineBay + newCounts.anglesDetail > 0;
      if (hasAngleData) setAnglesSectionCollapsed(false);

    } catch (error) {
      console.error('Error loading sidebar:', error);
    } finally {
      setLoading(false);
    }
  };

  /** Invalidate photo queries and reload sidebar data after mutations */
  const invalidateAndReload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['photo-library'] });
    await loadSidebarData();
  }, [queryClient]);

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
    invalidateAndReload();
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
      invalidateAndReload();
    } catch (error) {
      alert('Failed to link photos');
    }
  };

  const handleMarkOrganized = async () => {
    try {
      await PersonalPhotoLibraryService.markAsOrganized(Array.from(selectedPhotos));
      setSelectedPhotos(new Set());
      invalidateAndReload();
    } catch (error) {
      alert('Failed');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete ${selectedPhotos.size} photos?`)) return;
    try {
      await PersonalPhotoLibraryService.deletePhotos(Array.from(selectedPhotos));
      setSelectedPhotos(new Set());
      invalidateAndReload();
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
      invalidateAndReload();
    } catch (error) {
      alert('Failed to accept suggestion');
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
        await invalidateAndReload();
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
      await invalidateAndReload();
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
      await invalidateAndReload();
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
      await invalidateAndReload();
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
        await invalidateAndReload();
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
      await invalidateAndReload();
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

  const [vehicleSectionCollapsed, setVehicleSectionCollapsed] = useState(true);
  const [anglesSectionCollapsed, setAnglesSectionCollapsed] = useState(true);
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

  // Drag-and-drop: handle drops on sidebar targets
  const handleDragOverTarget = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverTarget(targetId);
  }, []);

  const handleDragLeaveTarget = useCallback(() => {
    setDragOverTarget(null);
  }, []);

  const handleDropOnVehicle = useCallback(async (e: React.DragEvent, vehicleId: string) => {
    e.preventDefault();
    setDragOverTarget(null);
    setIsDragging(false);
    const photoIdsJson = e.dataTransfer.getData('application/x-nuke-photos');
    if (!photoIdsJson) return;
    const photoIds: string[] = JSON.parse(photoIdsJson);
    if (photoIds.length === 0) return;

    const v = vehicles.find(vh => vh.id === vehicleId);
    const label = v ? `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'vehicle' : 'vehicle';
    try {
      await PersonalPhotoLibraryService.bulkLinkToVehicle(photoIds, vehicleId);
      showToast(`Linked ${photoIds.length} photo${photoIds.length > 1 ? 's' : ''} to ${label}`, 'success');
      setSelectedPhotos(new Set());
      invalidateAndReload();
    } catch {
      showToast('Failed to link photos', 'error');
    }
  }, [vehicles, showToast, invalidateAndReload]);

  const handleDropOnAlbum = useCallback(async (e: React.DragEvent, albumId: string) => {
    e.preventDefault();
    setDragOverTarget(null);
    setIsDragging(false);
    const photoIdsJson = e.dataTransfer.getData('application/x-nuke-photos');
    if (!photoIdsJson) return;
    const photoIds: string[] = JSON.parse(photoIdsJson);
    if (photoIds.length === 0) return;

    try {
      const added = await ImageSetService.addImagesToSet(albumId, photoIds);
      if (added === 0) {
        showToast('Photos already in album', 'info');
      } else {
        showToast(`Added ${added} photo${added > 1 ? 's' : ''} to album`, 'success');
        setSelectedPhotos(new Set());
      }
      invalidateAndReload();
    } catch {
      showToast('Failed to add to album', 'error');
    }
  }, [showToast, invalidateAndReload]);

  const handleDropNewAlbum = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTarget(null);
    setIsDragging(false);
    const photoIdsJson = e.dataTransfer.getData('application/x-nuke-photos');
    if (!photoIdsJson) return;
    const photoIds: string[] = JSON.parse(photoIdsJson);
    if (photoIds.length === 0) return;
    setAlbumNameDialog({ isOpen: true, defaultName: `Album ${new Date().toLocaleDateString()}` });
    // Temporarily select the dragged photos so the album creation picks them up
    setSelectedPhotos(new Set(photoIds));
  }, []);

  // Listen for drag state from tiles
  useEffect(() => {
    const onDragStart = () => setIsDragging(true);
    const onDragEnd = () => { setIsDragging(false); setDragOverTarget(null); };
    window.addEventListener('nuke:photo-drag-start', onDragStart);
    window.addEventListener('nuke:photo-drag-end', onDragEnd);
    return () => {
      window.removeEventListener('nuke:photo-drag-start', onDragStart);
      window.removeEventListener('nuke:photo-drag-end', onDragEnd);
    };
  }, []);

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
        width: sidebarCollapsed ? '40px' : '200px',
        minWidth: sidebarCollapsed ? '40px' : '200px',
        borderRight: '2px solid var(--border-light)',
        background: 'var(--white)',
        overflow: 'hidden',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
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
            style={{ padding: '2px 4px', fontSize: '9px' }}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </div>

        {!sidebarCollapsed && (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
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
            style={{ width: '100%', padding: '8px', fontSize: '12px' }}
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
                      height: '8px', background: isProcessing
                        ? 'var(--success)'
                        : hasIssues
                          ? 'var(--error)'
                          : item.status === 'complete'
                            ? 'var(--success)'
                            : 'var(--text-disabled)',
                      display: 'inline-block'
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
            <span style={{ fontSize: '12px' }}>{vehicleSectionCollapsed ? '▼' : '▲'}</span>
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
            <span style={{ fontSize: '12px' }}>{anglesSectionCollapsed ? '▼' : '▲'}</span>
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
            <span style={{ fontSize: '12px' }}>{vehicleProfilesCollapsed ? '▼' : '▲'}</span>
          </div>
          {!vehicleProfilesCollapsed && (
            <>
              <input
                type="text"
                placeholder="Filter..."
                value={vehicleSearch}
                onChange={(e) => setVehicleSearch(e.target.value)}
                className="form-input"
                style={{ width: '100%', fontSize: '11px', marginBottom: '6px', padding: '4px 6px' }}
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
                    const isDropTarget = dragOverTarget === `vehicle-${v.id}`;
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
                        onDragOver={(e) => handleDragOverTarget(e, `vehicle-${v.id}`)}
                        onDragLeave={handleDragLeaveTarget}
                        onDrop={(e) => handleDropOnVehicle(e, v.id)}
                        style={{
                          padding: '4px 6px',
                          marginBottom: '2px',
                          cursor: 'pointer',
                          background: isDropTarget ? 'var(--primary-light, rgba(0,0,0,0.08))' : isActive ? 'var(--grey-200)' : 'transparent',
                          border: isDropTarget ? '2px solid var(--primary, #333)' : isActive ? '1px solid var(--border-medium)' : '1px solid transparent',
                          fontSize: '11px',
                          transition: 'border 0.12s, background 0.12s',
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
                  style={{ width: '100%', marginTop: '6px', fontSize: '11px', padding: '4px 6px' }}
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
              {personalAlbums.map(album => {
                const isAlbumDropTarget = dragOverTarget === `album-${album.id}`;
                return (
                <div
                  key={album.id}
                  onDragOver={(e) => handleDragOverTarget(e, `album-${album.id}`)}
                  onDragLeave={handleDragLeaveTarget}
                  onDrop={(e) => handleDropOnAlbum(e, album.id)}
                  style={{
                    border: isAlbumDropTarget ? '2px solid var(--primary, #333)' : '1px solid var(--border-light)',
                    padding: '4px 6px',
                    background: isAlbumDropTarget ? 'var(--primary-light, rgba(0,0,0,0.08))' : 'var(--grey-50)',
                    transition: 'border 0.12s, background 0.12s',
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
                        style={{ fontSize: '11px', padding: '2px 4px', flex: 1 }}
                      />
                      <button
                        onClick={() => handleUpdateAlbumName(album.id, editingAlbumName)}
                        className="button button-primary"
                        style={{ fontSize: '9px', padding: '2px 4px' }}
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => {
                          setEditingAlbumId(null);
                          setEditingAlbumName('');
                        }}
                        className="button button-secondary"
                        style={{ fontSize: '9px', padding: '2px 4px' }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div 
                      className="text" 
                      style={{ 
                        fontSize: '11px', 
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
                  <div className="text text-small text-muted" style={{ fontSize: '9px', marginBottom: '4px' }}>
                    {(album.image_count || 0).toLocaleString()} photos
                  </div>
                  <button
                    onClick={() => handleConvertAlbumToVehicle(album)}
                    className="button button-secondary"
                    style={{ width: '100%', fontSize: '9px', padding: '3px 4px' }}
                  >
                    CONVERT TO PROFILE
                  </button>
                </div>
              );
              })}
            </div>
          )}

          {/* New Album drop zone — visible during drag */}
          {isDragging && (
            <div
              onDragOver={(e) => handleDragOverTarget(e, 'new-album')}
              onDragLeave={handleDragLeaveTarget}
              onDrop={handleDropNewAlbum}
              style={{
                border: dragOverTarget === 'new-album' ? '2px solid var(--primary, #333)' : '2px dashed var(--border-medium)',
                padding: '8px',
                marginBottom: '6px',
                textAlign: 'center',
                background: dragOverTarget === 'new-album' ? 'var(--primary-light, rgba(0,0,0,0.08))' : 'transparent',
                transition: 'border 0.12s, background 0.12s',
              }}
            >
              <span className="text text-small text-muted" style={{ fontSize: '9px', textTransform: 'uppercase' }}>
                DROP TO CREATE ALBUM
              </span>
            </div>
          )}

          {selectedPhotos.size > 0 && (
            <button
              onClick={() => handleAddToAlbum()}
              className="button button-secondary"
              style={{ width: '100%', fontSize: '11px', padding: '6px 10px' }}
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
                  border: '2px solid var(--border-light)',
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
                  style={{ width: '100%', padding: '6px', fontSize: '11px' }}
                >
                  ACCEPT & CREATE
                </button>
              </div>
            ))}
          </div>
        )}
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
              style={{ padding: '4px 8px', fontSize: '11px' }}
            >
              CLEAR FILTER
            </button>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="text text-small text-muted" style={{ fontSize: '9px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              {gridColumns} COL
            </span>
            <input
              type="range"
              min={1}
              max={20}
              value={gridColumns}
              onChange={(e) => setGridColumns(Number(e.target.value))}
              style={{
                width: '100px',
                height: '2px',
                accentColor: 'var(--text)',
                cursor: 'pointer',
              }}
            />
          </div>
        </div>

        {/* Photo Grid — Virtualized */}
        <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
          {/* Upload progress overlay */}
          {uploading && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 5,
                padding: '8px 12px',
                background: 'var(--white)',
                borderBottom: '1px solid var(--border-light)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <div className="text font-bold" style={{ fontSize: '15px' }}>
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

          {/* Sticky date label */}
          {currentDateLabel && displayPhotos.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: uploading ? '52px' : '4px',
                left: '8px',
                zIndex: 4,
                padding: '2px 8px',
                background: 'rgba(0,0,0,0.7)',
                color: 'var(--surface-elevated)',
                fontSize: '9px',
                fontFamily: 'Arial, sans-serif',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                pointerEvents: 'none',
              }}
            >
              {currentDateLabel}
            </div>
          )}

          {displayPhotos.length === 0 && !photosLoading ? (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--grey-100)',
            }}>
              <div style={{
                padding: '80px 20px',
                textAlign: 'center',
                background: 'var(--white)',
                border: '2px solid var(--border-light)',
              }}>
                <div className="text font-bold" style={{ fontSize: '16px', marginBottom: '8px' }}>
                  {activeFilter ? 'No photos match filter' : hideOrganized ? 'All photos organized!' : 'No photos yet'}
                </div>
                <div className="text text-small text-muted">
                  {activeFilter ? 'Try a different filter' : 'Upload photos to get started'}
                </div>
              </div>
            </div>
          ) : photosLoading ? (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--grey-100)',
            }}>
              <div className="text text-muted">Loading photos...</div>
            </div>
          ) : (
            <PhotoGrid
              photos={displayPhotos}
              selectedPhotos={selectedPhotos}
              columns={gridColumns}
              hasNextPage={!!hasNextPage}
              isFetchingNextPage={!!isFetchingNextPage}
              fetchNextPage={fetchNextPage}
              onPhotoClick={(photoId, e) => {
                const newSel = new Set(selectedPhotos);
                if (newSel.has(photoId)) {
                  newSel.delete(photoId);
                } else {
                  newSel.add(photoId);
                }
                setSelectedPhotos(newSel);
              }}
              onTouchStart={startTouchSelection}
              onTouchMove={moveTouchSelection}
              onTouchEnd={endTouchSelection}
              onDateChange={setCurrentDateLabel}
              virtualizerRef={virtualizerRef}
            />
          )}

          {/* Timeline Scrubber */}
          {dateSummary.length > 0 && displayPhotos.length > 0 && (
            <TimelineScrubber
              dateSummary={dateSummary}
              virtualizer={virtualizerRef.current}
              monthToRowIndex={monthToRowIndex}
            />
          )}
        </div>

        {/* BOTTOM TOOLBAR */}
        <div style={{
          background: 'var(--white)',
          borderTop: '2px solid var(--border-light)',
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
                style={{ fontSize: '11px', padding: '6px 10px' }}
              >
                ADD TO ALBUM
              </button>

              {activeVehicleId && (
                <button
                  onClick={() => handleLinkToVehicle(activeVehicleId)}
                  className="button button-secondary"
                  style={{ fontSize: '11px', padding: '6px 10px' }}
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
                style={{ fontSize: '12px', padding: '4px 8px' }}
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
                style={{ fontSize: '11px', padding: '6px 10px' }}
              >
                DELETE
              </button>

              <button
                onClick={() => setSelectedPhotos(new Set())}
                className="button button-secondary"
                style={{ fontSize: '11px', padding: '6px 10px' }}
              >
                CLEAR
              </button>
            </>
          )}

          <button
            onClick={() => setSelectedPhotos(new Set(displayPhotos.map(p => p.id)))}
            className="button button-secondary"
            style={{ marginLeft: 'auto', fontSize: '11px', padding: '6px 10px' }}
          >
            SELECT ALL
          </button>
        </div>
      </div>

      {/* QuickLook overlay */}
      {quickLookPhotoId && (() => {
        const photo = displayPhotos.find((p) => p.id === quickLookPhotoId);
        if (!photo) return null;
        return (
          <QuickLook
            photo={photo}
            onClose={() => setQuickLookPhotoId(null)}
            onNext={() => quickLookNavigate(1)}
            onPrev={() => quickLookNavigate(-1)}
          />
        );
      })()}

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
            <div className="text font-bold" style={{ marginBottom: '12px', fontSize: '15px' }}>
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
                style={{ fontSize: '11px', padding: '6px 12px' }}
              >
                Cancel
              </button>
              <button
                onClick={handleRestartAIProcessing}
                className="button button-primary"
                style={{ fontSize: '11px', padding: '6px 12px' }}
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
            <div className="text font-bold" style={{ marginBottom: '12px', fontSize: '15px' }}>
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
                      style={{ fontSize: '11px', padding: '6px 12px' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmitToVehicle}
                      className="button button-primary"
                      style={{ fontSize: '11px', padding: '6px 12px' }}
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
              placeholder="VIN or chassis ID (4-17 chars)"
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
