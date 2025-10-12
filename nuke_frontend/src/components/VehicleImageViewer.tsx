// Simple Vehicle Image Viewer Window
// Consistent image viewing across the site

import React from 'react';
// SimpleImageUpload removed during cleanup
import ProImageViewer from './ProImageViewer';

interface ImageData {
  id: string;
  image_url: string;
  thumbnail_url?: string;
  created_at?: string;
  is_primary?: boolean;
  is_sensitive?: boolean;
  sensitive_type?: string | null;
  storage_path?: string | null;
}

interface VehicleImageViewerProps {
  images: string[];
  vehicleId: string;
  title?: string;
  showAddButton?: boolean;
  canDelete?: boolean;
  onAddPhotos?: () => void;
  onImportComplete?: () => void;
  className?: string;
  style?: React.CSSProperties;
  extraRightControls?: React.ReactNode;
}

const VehicleImageViewer: React.FC<VehicleImageViewerProps> = ({
  images,
  vehicleId,
  title = 'Vehicle Images',
  showAddButton = false,
  canDelete = true,
  onAddPhotos,
  onImportComplete,
  className = '',
  style = {},
  extraRightControls
}) => {
  // Load images directly from database if none provided
  const [loadedImages, setLoadedImages] = React.useState<ImageData[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [selectedImage, setSelectedImage] = React.useState<{ url: string; id: string } | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = React.useState(0);
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);
  const [sortMode, setSortMode] = React.useState<'primary_newest' | 'newest' | 'oldest'>('primary_newest');
  const [isAuthorizedForSensitive, setIsAuthorizedForSensitive] = React.useState<boolean>(false);
  const [workingIds, setWorkingIds] = React.useState<Record<string, boolean>>({});
  const [stageFilter, setStageFilter] = React.useState<string>('');
  const [roleFilter, setRoleFilter] = React.useState<string>('');
  const [areaFilter, setAreaFilter] = React.useState<string>('');
  const [partFilter, setPartFilter] = React.useState<string>('');
  const [showFilters, setShowFilters] = React.useState<boolean>(false);
  const [editOpen, setEditOpen] = React.useState<boolean>(false);
  const [editImage, setEditImage] = React.useState<ImageData | null>(null);
  const [editForm, setEditForm] = React.useState<{ process_stage?: string; workflow_role?: string; area?: string; part?: string; tags?: { vin?: boolean; speedometer?: boolean; paperwork_title?: boolean; exterior?: boolean; engine_bay?: boolean } } | null>(null);
  const [editMode, setEditMode] = React.useState<boolean>(false);
  const [selectedImages, setSelectedImages] = React.useState<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = React.useState<{total: number, completed: number, uploading: boolean}>({total: 0, completed: 0, uploading: false});
  

  const loadImages = React.useCallback(async () => {
    if (!vehicleId) {
      console.log('No vehicleId provided');
      return;
    }
    // Throttle duplicate loads within 800ms and prevent overlapping
    const now = Date.now();
    (loadImages as any)._last = (loadImages as any)._last || 0;
    if (now - (loadImages as any)._last < 800) return;
    (loadImages as any)._last = now;

    if ((loadImages as any)._inflight) return;
    (loadImages as any)._inflight = true;

    try {
      const { supabase } = await import('../lib/supabase');
      
      let query = supabase
        .from('vehicle_images')
        .select('id, image_url, thumbnail_url, created_at, is_primary, is_sensitive, sensitive_type, storage_path')
        .eq('vehicle_id', vehicleId);

    // Apply filters
    if (stageFilter) query = query.eq('process_stage', stageFilter);
    if (roleFilter)  query = query.eq('workflow_role', roleFilter);
    if (areaFilter)  query = query.ilike('area', `%${areaFilter}%`);
    if (partFilter)  query = query.ilike('part', `%${partFilter}%`);

    // Apply ordering based on sortMode
    if (sortMode === 'primary_newest') {
      query = query.order('is_primary', { ascending: false }).order('created_at', { ascending: false });
    } else if (sortMode === 'newest') {
      query = query.order('created_at', { ascending: false });
    } else if (sortMode === 'oldest') {
      query = query.order('created_at', { ascending: true });
    }

    const { data, error } = await query;
    
    if (error) {
      console.error('Failed to load images:', error);
    } else if (data && data.length > 0) {
      setLoadedImages(data);
    } else {
      // No DB rows: attempt storage fallback for historical paths
      try {
        // Prefer canonical bucket
        const bucketCanonical = supabase.storage.from('vehicle-data');
        // Legacy bucket (read-only fallback)
        const bucketLegacy = supabase.storage.from('vehicle-images');

        const publicUrls: string[] = [];

        // Helper to list a path and push file URLs
        const listPath = async (bucketRef: ReturnType<typeof supabase.storage.from>, path: string) => {
          const { data: files, error: listErr } = await bucketRef.list(path, { limit: 1000 });
          if (listErr) {
            console.warn('Storage list error for', path, listErr);
            return;
          }
          if (!files) return;
          for (const f of files) {
            // Only treat entries with metadata (files) or id as files; folders often have null metadata
            const isFile = !!(f as any)?.metadata || !!(f as any)?.id;
            if (!isFile) continue;
            if (f.name) {
              const fullPath = path ? `${path}/${f.name}` : f.name;
              const { data: pub } = bucketRef.getPublicUrl(fullPath);
              if (pub?.publicUrl) publicUrls.push(pub.publicUrl);
            }
          }
        };

        // Try both path styles that exist in this project
        // Style A (legacy): without 'vehicles/' prefix on legacy bucket
        await listPath(bucketLegacy, `${vehicleId}`);
        const { data: eventDirsA } = await bucketLegacy.list(`${vehicleId}/events`, { limit: 1000 });
        if (eventDirsA && eventDirsA.length > 0) {
          for (const dir of eventDirsA) {
            if (dir.name) await listPath(bucketLegacy, `${vehicleId}/events/${dir.name}`);
          }
        }

        // Style B: with 'vehicles/' prefix on canonical bucket
        await listPath(bucketCanonical, `vehicles/${vehicleId}`);
        const { data: eventDirsB } = await bucketCanonical.list(`vehicles/${vehicleId}/events`, { limit: 1000 });
        if (eventDirsB && eventDirsB.length > 0) {
          for (const dir of eventDirsB) {
            if (dir.name) await listPath(bucketCanonical, `vehicles/${vehicleId}/events/${dir.name}`);
          }
        }

        const uniqueUrls = Array.from(new Set(publicUrls));
        setLoadedImages(uniqueUrls.map((url, i) => ({ id: `storage-${i}`, image_url: url })));
      } catch (e) {
        console.error('Storage fallback failed:', e);
        setLoadedImages([]);
      }
    }
    } catch (err) {
      console.error('Error in loadImages:', err);
    } finally {
      (loadImages as any)._inflight = false;
    }
  }, [vehicleId, stageFilter, roleFilter, areaFilter, partFilter, sortMode]);

  React.useEffect(() => {
    if (vehicleId) {
      loadImages();
    } else if (images.length > 0) {
      setLoadedImages(images.map((url, index) => ({ id: `legacy-${index}`, image_url: url })));
    }
  }, [images, vehicleId, loadImages, sortMode, stageFilter, roleFilter, areaFilter, partFilter]);

  // Determine if current user may view sensitive originals
  React.useEffect(() => {
    (async () => {
      try {
        const { supabase } = await import('../lib/supabase');
        const { data: auth } = await supabase.auth.getUser();
        const authId = auth?.user?.id;
        if (!authId) { setIsAuthorizedForSensitive(false); return; }
        // Owner check
        const { data: v } = await supabase.from('vehicles').select('user_id').eq('id', vehicleId).maybeSingle();
        const isOwner = v?.user_id && v.user_id === authId;
        // Capability check
        const { data: p } = await supabase.from('profiles').select('can_view_sensitive').eq('id', authId).maybeSingle();
        const canView = !!p?.can_view_sensitive;
        setIsAuthorizedForSensitive(Boolean(isOwner || canView));
      } catch (e) {
        setIsAuthorizedForSensitive(false);
      }
    })();
  }, [vehicleId]);

  // Listen for external refresh events (e.g., after event uploads)
  React.useEffect(() => {
    const handler = (e: any) => {
      if (!vehicleId) return;
      if (!e?.detail?.vehicleId || e.detail.vehicleId === vehicleId) {
        loadImages();
      }
    };
    window.addEventListener('vehicle_images_updated', handler);
    return () => window.removeEventListener('vehicle_images_updated', handler);
  }, [vehicleId, loadImages]);

  // Always show the component, even with no images
  if (loadedImages.length === 0 && !showAddButton && !isLoading) {
    return (
      <div className="text-center py-8 text-gray-500">
        <div className="text-lg mb-2">No images yet</div>
        <div className="text-sm">Upload some photos to get started</div>
      </div>
    );
  }

  const updateImagePosition = async (imageId: string, newPosition: number) => {
    // Position column doesn't exist yet - skip database update
    console.log('Position update skipped - column not available:', imageId, newPosition);
  };

  const reorderImages = async (newOrder: ImageData[]) => {
    setLoadedImages(newOrder);
    
    // Update positions in database
    for (let i = 0; i < newOrder.length; i++) {
      if (!newOrder[i].id.startsWith('legacy-')) {
        await updateImagePosition(newOrder[i].id, i);
      }
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }

    const newImages = [...loadedImages];
    const draggedImage = newImages[draggedIndex];
    
    // Remove dragged image from its current position
    newImages.splice(draggedIndex, 1);
    
    // Insert at new position
    newImages.splice(dropIndex, 0, draggedImage);
    
    reorderImages(newImages);
    setDraggedIndex(null);
  };

  const isUuid = (s: string) => /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(s);

  // Set selected image as lead/cover (DB-backed only)
  const setAsLead = async (image: ImageData) => {
    try {
      if (!isUuid(image.id)) return; // only DB-backed images can be lead
      setWorkingIds(prev => ({ ...prev, [image.id]: true }));
      const { supabase } = await import('../lib/supabase');
      // Clear existing primary
      await supabase
        .from('vehicle_images')
        .update({ is_primary: false })
        .eq('vehicle_id', vehicleId)
        .eq('is_primary', true);
      // Set this one as primary
      const { error } = await supabase
        .from('vehicle_images')
        .update({ is_primary: true })
        .eq('id', image.id);
      if (error) {
        console.error('Failed to set lead image:', error);
        return;
      }
      // Refresh gallery and notify others to refresh hero image
      await loadImages();
      try { 
        window.dispatchEvent(new CustomEvent('vehicle_images_updated', { detail: { vehicleId } })); 
        window.dispatchEvent(new CustomEvent('lead_image_updated', { detail: { vehicleId } })); 
      } catch {}
    } catch (e) {
      console.error('setAsLead failed:', e);
    } finally {
      setWorkingIds(prev => ({ ...prev, [image.id]: false }));
    }
  };

  // Save edits from Edit Tag Modal
  const saveEdit = async () => {
    if (!editImage || !editForm) { setEditOpen(false); return; }
    try {
      const { supabase } = await import('../lib/supabase');
      // Load current labels to merge
      const { data: current } = await supabase
        .from('vehicle_images')
        .select('labels')
        .eq('id', editImage.id)
        .maybeSingle();

      let labels: string[] = Array.isArray(current?.labels) ? [...current!.labels] : [];
      const setFlag = (name: string, on?: boolean) => {
        const has = labels.includes(name);
        if (on && !has) labels.push(name);
        if (!on && has) labels = labels.filter(l => l !== name);
      };
      if (editForm.tags) {
        setFlag('vin', !!editForm.tags.vin);
        setFlag('speedometer', !!editForm.tags.speedometer);
        setFlag('paperwork', !!editForm.tags.paperwork_title);
        setFlag('exterior', !!editForm.tags.exterior);
        setFlag('engine_bay', !!editForm.tags.engine_bay);
      }

      const { error } = await supabase
        .from('vehicle_images')
        .update({
          process_stage: editForm.process_stage || null,
          workflow_role: editForm.workflow_role || null,
          area: editForm.area || null,
          part: editForm.part || null,
          labels
        })
        .eq('id', editImage.id);
      if (error) {
        console.error('Failed to update tags:', error);
      }
      setEditOpen(false);
      setEditImage(null);
      setEditForm(null);
      loadImages();
      try { window.dispatchEvent(new CustomEvent('vehicle_images_updated', { detail: { vehicleId } })); } catch {}
    } catch (e) {
      console.error('Save edit failed:', e);
    }
  };

  const deleteImage = async (id: string, filePath: string | undefined) => {
    console.log('Attempting to delete image with ID:', id, 'filePath:', filePath);

    // Don't try to delete legacy placeholder images
    if (id.startsWith('legacy-')) {
      console.log('Skipping deletion of legacy placeholder image');
      return;
    }

    setIsLoading(true);
    try {
      const { supabase } = await import('../lib/supabase');

      // If this is a storage-fallback image (non-UUID id), only remove from storage using URL-derived path
      if (!isUuid(id)) {
        const img = loadedImages.find(x => x.id === id);
        if (img?.image_url) {
          // Derive bucket and path from public URL
          const pubPrefix = '/storage/v1/object/public/';
          const idx = img.image_url.indexOf(pubPrefix);
          if (idx !== -1) {
            const remainder = img.image_url.substring(idx + pubPrefix.length); // e.g., vehicle-data/vehicles/uuid/file.jpg
            const slash = remainder.indexOf('/');
            if (slash > 0) {
              const bucket = remainder.substring(0, slash);
              const path = remainder.substring(slash + 1);
              const { error: storageError } = await supabase.storage
                .from(bucket)
                .remove([path]);
              if (storageError) console.error('Storage deletion error:', storageError);
            }
          }
        }
      } else {
        // Delete from storage if filePath provided
        if (filePath) {
          const { error: storageError } = await supabase.storage
            .from('vehicle-data')
            .remove([filePath]);
          if (storageError) console.error('Storage deletion error:', storageError);
        }
        // Delete from database by UUID id
        const { error: dbError } = await supabase
          .from('vehicle_images')
          .delete()
          .eq('id', id);
        if (dbError) {
          console.error('Database deletion error:', dbError);
          return;
        }
      }
      
      // Capture image URL before removing from state for cleanup
      const imgBefore = loadedImages.find(x => x.id === id);
      // Update local state
      setLoadedImages(prev => prev.filter(img => img.id !== id));

      // Clean up timeline event image_urls containing this image URL (best-effort)
      const urlToRemove = imgBefore?.image_url;
      if (urlToRemove) {
        const updateTables = async (table: string) => {
          try {
            const { data, error } = await supabase
              .from(table)
              .select('id, image_urls')
              .eq('vehicle_id', vehicleId);
            if (error) {
              // ignore table not found
              return;
            }
            if (data && Array.isArray(data)) {
              for (const ev of data) {
                const imgs: string[] = Array.isArray(ev.image_urls) ? ev.image_urls : [];
                if (imgs.includes(urlToRemove)) {
                  const filtered = imgs.filter(u => u !== urlToRemove);
                  await supabase
                    .from(table)
                    .update({ image_urls: filtered })
                    .eq('id', ev.id);
                }
              }
            }
          } catch {}
        };
        await updateTables('timeline_events');
        await updateTables('vehicle_timeline_events');
        try { window.dispatchEvent(new CustomEvent('vehicle_images_updated', { detail: { vehicleId } })); } catch {}
      }
      
    } catch (error) {
      console.error('Error deleting image:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const openLightbox = async (image: ImageData, index: number) => {
    const isIdUuid = isUuid(image.id);
    let url = image.image_url;
    if (image.is_sensitive && isAuthorizedForSensitive && image.storage_path) {
      try {
        const { supabase } = await import('../lib/supabase');
        const { data, error } = await supabase
          .storage
          .from('vehicle-data')
          .createSignedUrl(image.storage_path, 60);
        if (!error && data?.signedUrl) url = data.signedUrl;
      } catch {}
    }
    setSelectedImage({ url, id: isIdUuid ? image.id : undefined as any });
    setCurrentImageIndex(index);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
    setSelectedImage(null);
  };

  const nextImage = () => {
    const nextIndex = (currentImageIndex + 1) % loadedImages.length;
    const nextImg = loadedImages[nextIndex];
    setSelectedImage({ url: nextImg.image_url, id: nextImg.id });
    setCurrentImageIndex(nextIndex);
  };

  const prevImage = () => {
    const prevIndex = (currentImageIndex - 1 + loadedImages.length) % loadedImages.length;
    const prevImg = loadedImages[prevIndex];
    setSelectedImage({ url: prevImg.image_url, id: prevImg.id });
    setCurrentImageIndex(prevIndex);
  };

  // Utilities for sensitivity override
  const fetchBlob = async (url: string): Promise<Blob> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch image');
    return await res.blob();
  };

  const createBlurPreview = async (blob: Blob): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 480;
        const ratio = img.width ? Math.min(1, maxW / img.width) : 1;
        const w = Math.max(1, Math.floor(img.width * ratio));
        const h = Math.max(1, Math.floor(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('no ctx')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        // Heavier manual blur: many passes with varied offsets and higher opacity
        const passes = 24;
        for (let i = 1; i <= passes; i++) {
          const offset = i * 1.5;
          ctx.globalAlpha = 0.12;
          ctx.drawImage(canvas, -offset, 0);
          ctx.drawImage(canvas, offset, 0);
          ctx.drawImage(canvas, 0, -offset);
          ctx.drawImage(canvas, 0, offset);
          // diagonals
          ctx.drawImage(canvas, -offset, -offset);
          ctx.drawImage(canvas, offset, offset);
          ctx.drawImage(canvas, -offset, offset);
          ctx.drawImage(canvas, offset, -offset);
        }
        ctx.globalAlpha = 1;
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error('blob failed')), 'image/jpeg', 0.8);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  };

  const markSensitive = async (image: ImageData) => {
    try {
      setWorkingIds(prev => ({ ...prev, [image.id]: true }));
      const { supabase } = await import('../lib/supabase');
      const baseName = crypto.randomUUID();
      const previewPath = `vehicles/${vehicleId}/previews/${baseName}.jpg`;
      const sensitivePath = `vehicles/${vehicleId}/sensitive/${baseName}.jpg`;

      // Fetch original blob from existing URL (may be public or preview). Prefer storage_path if present
      let originalBlob: Blob | null = null;
      if (image.storage_path && image.is_sensitive) {
        // already sensitive; nothing to do
        return;
      }
      // Use current displayed URL as source
      originalBlob = await fetchBlob(image.image_url);

      // Upload original to sensitive path
      const { error: upOrigErr } = await supabase.storage.from('vehicle-data').upload(sensitivePath, originalBlob, { upsert: false });
      if (upOrigErr) throw upOrigErr;

      // Create and upload blurred preview
      const blurBlob = await createBlurPreview(originalBlob);
      const { error: upPrevErr } = await supabase.storage.from('vehicle-data').upload(previewPath, blurBlob, { upsert: false });
      if (upPrevErr) throw upPrevErr;
      const { data: prevUrlData } = supabase.storage.from('vehicle-data').getPublicUrl(previewPath);

      // Update DB
      const { error: dbErr } = await supabase
        .from('vehicle_images')
        .update({
          is_sensitive: true,
          sensitive_type: image.sensitive_type || 'paperwork',
          storage_path: sensitivePath,
          image_url: prevUrlData.publicUrl
        })
        .eq('id', image.id);
      if (dbErr) throw dbErr;

      // Refresh grid
      loadImages();
    } catch (e) {
      console.error('Mark sensitive failed:', e);
    } finally {
      setWorkingIds(prev => ({ ...prev, [image.id]: false }));
    }
  };

  const markNotSensitive = async (image: ImageData) => {
    try {
      setWorkingIds(prev => ({ ...prev, [image.id]: true }));
      const { supabase } = await import('../lib/supabase');
      const baseName = crypto.randomUUID();
      const publicPath = `vehicles/${vehicleId}/images/${baseName}.jpg`;

      // Obtain original: if we have storage_path (sensitive), try signed URL fetch
      let sourceBlob: Blob | null = null;
      if (image.is_sensitive && image.storage_path) {
        const { data } = await supabase.storage.from('vehicle-data').createSignedUrl(image.storage_path, 60);
        const src = data?.signedUrl || image.image_url;
        sourceBlob = await fetchBlob(src);
      } else {
        // Not sensitive but flagged incorrectly; copy from current url
        sourceBlob = await fetchBlob(image.image_url);
      }
      // Upload to public images path
      const { error: upErr } = await supabase.storage.from('vehicle-data').upload(publicPath, sourceBlob!, { upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('vehicle-data').getPublicUrl(publicPath);

      // Update DB flags
      const { error: dbErr } = await supabase
        .from('vehicle_images')
        .update({
          is_sensitive: false,
          sensitive_type: null,
          storage_path: publicPath,
          image_url: pub.publicUrl
        })
        .eq('id', image.id);
      if (dbErr) throw dbErr;

      loadImages();
    } catch (e) {
      console.error('Mark not sensitive failed:', e);
    } finally {
      setWorkingIds(prev => ({ ...prev, [image.id]: false }));
    }
  };

  return (
    <div className={className} style={{ 
      fontFamily: 'Arial, sans-serif',
      ...style
    }}>
      {/* Upload Progress Bar */}
      {uploadProgress.uploading && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-800">Uploading images...</span>
            <span className="text-sm text-blue-600">{uploadProgress.completed} of {uploadProgress.total}</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
              style={{ width: `${(uploadProgress.completed / uploadProgress.total) * 100}%` }}
            ></div>
          </div>
        </div>
      )}
      
      {/* Toolbar: Filters (left) · Sort + Extras (right) */}
      <div className="flex items-center justify-between mb-2" style={{ gap: 8 }}>
        <div className="relative">
          <button className="button button-small" onClick={() => setShowFilters(v => !v)}>
            Filters{(stageFilter || roleFilter || areaFilter || partFilter) ? ' • active' : ''}
          </button>
          {showFilters && (
            <div className="absolute mt-1 bg-white border rounded shadow p-2 z-20" style={{ minWidth: 280 }}>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="text-xs border rounded px-1 py-0.5">
                  <option value="">Stage: All</option>
                  <option value="discovery">Discovery</option>
                  <option value="disassembly">Disassembly</option>
                  <option value="metalwork">Metalwork</option>
                  <option value="bodywork">Bodywork</option>
                  <option value="paint_prep">Paint Prep</option>
                  <option value="paint_stage1">Paint Stage 1</option>
                  <option value="paint_stage2">Paint Stage 2</option>
                  <option value="mechanical">Mechanical</option>
                  <option value="wiring">Wiring</option>
                  <option value="upholstery">Upholstery</option>
                  <option value="undercarriage">Undercarriage</option>
                  <option value="reassembly">Reassembly</option>
                  <option value="final">Final</option>
                </select>
                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="text-xs border rounded px-1 py-0.5">
                  <option value="">Role: All</option>
                  <option value="before">Before</option>
                  <option value="during">During</option>
                  <option value="after">After</option>
                  <option value="issue">Issue</option>
                  <option value="parts">Parts</option>
                  <option value="receipt">Receipt</option>
                  <option value="reference">Reference</option>
                </select>
                <input value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} placeholder="Area (e.g. left_rocker)" className="text-xs border rounded px-1 py-0.5" />
                <input value={partFilter} onChange={(e) => setPartFilter(e.target.value)} placeholder="Part (e.g. rocker_panel)" className="text-xs border rounded px-1 py-0.5" />
                <div className="col-span-2 flex items-center justify-between">
                  <button className="text-xs border rounded px-2 py-0.5" onClick={() => { setStageFilter(''); setRoleFilter(''); setAreaFilter(''); setPartFilter(''); }}>Clear</button>
                  <button className="text-xs border rounded px-2 py-0.5" onClick={() => setShowFilters(false)}>Done</button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center" style={{ gap: 6 }}>
          <button 
            className={`text-xs px-2 py-1 rounded transition-colors ${
              editMode ? 'bg-blue-500 text-white' : 'border hover:bg-gray-50'
            }`}
            onClick={() => {
              setEditMode(!editMode);
              setSelectedImages(new Set());
            }}
          >
            {editMode ? 'Done' : 'Edit'}
          </button>
          {editMode && selectedImages.size > 0 && (
            <button 
              className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              onClick={() => {
                selectedImages.forEach(id => {
                  const img = loadedImages.find(i => i.id === id);
                  if (img) deleteImage(img.id, img.storage_path || undefined);
                });
                setSelectedImages(new Set());
              }}
            >
              Delete ({selectedImages.size})
            </button>
          )}
          <span className="text-xs text-gray-600">Sort:</span>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as any)} className="text-xs border rounded px-1 py-0.5">
            <option value="primary_newest">Primary, then newest</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          {extraRightControls}
        </div>
      </div>

      {/* Edit Tag Modal */}
      {editOpen && editImage && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Edit Image Tags</h3>
              <button className="modal-close" onClick={() => { setEditOpen(false); setEditImage(null); }}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="text-xs text-gray-600">Process Stage</label>
                  <select
                    value={editForm?.process_stage || ''}
                    onChange={(e) => setEditForm(f => ({ ...(f||{}), process_stage: e.target.value }))}
                    className="border rounded px-2 py-1 text-sm w-full"
                  >
                    <option value="">–</option>
                    <option value="discovery">Discovery</option>
                    <option value="disassembly">Disassembly</option>
                    <option value="metalwork">Metalwork</option>
                    <option value="bodywork">Bodywork</option>
                    <option value="paint_prep">Paint Prep</option>
                    <option value="paint_stage1">Paint Stage 1</option>
                    <option value="paint_stage2">Paint Stage 2</option>
                    <option value="mechanical">Mechanical</option>
                    <option value="wiring">Wiring</option>
                    <option value="upholstery">Upholstery</option>
                    <option value="undercarriage">Undercarriage</option>
                    <option value="reassembly">Reassembly</option>
                    <option value="final">Final</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600">Workflow Role</label>
                  <select
                    value={editForm?.workflow_role || ''}
                    onChange={(e) => setEditForm(f => ({ ...(f||{}), workflow_role: e.target.value }))}
                    className="border rounded px-2 py-1 text-sm w-full"
                  >
                    <option value="">–</option>
                    <option value="before">Before</option>
                    <option value="during">During</option>
                    <option value="after">After</option>
                    <option value="issue">Issue</option>
                    <option value="parts">Parts</option>
                    <option value="receipt">Receipt</option>
                    <option value="reference">Reference</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600">Area</label>
                  <input
                    value={editForm?.area || ''}
                    onChange={(e) => setEditForm(f => ({ ...(f||{}), area: e.target.value }))}
                    className="border rounded px-2 py-1 text-sm w-full"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">Part</label>
                  <input
                    value={editForm?.part || ''}
                    onChange={(e) => setEditForm(f => ({ ...(f||{}), part: e.target.value }))}
                    className="border rounded px-2 py-1 text-sm w-full"
                  />
                </div>
              </div>

              <div className="mt-3">
                <div className="text-xs text-gray-600 mb-1">Evidence Tags</div>
                <div className="flex flex-wrap gap-3 text-sm">
                  {[
                    { key: 'vin', label: 'VIN' },
                    { key: 'speedometer', label: 'Speedometer' },
                    { key: 'paperwork_title', label: 'Paperwork (Title)' },
                    { key: 'exterior', label: 'Exterior' },
                    { key: 'engine_bay', label: 'Engine Bay' },
                  ].map(t => (
                    <label key={t.key} className="inline-flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!editForm?.tags?.[t.key as keyof NonNullable<typeof editForm>['tags']]}
                        onChange={(e) => setEditForm(f => ({ ...(f||{}), tags: { ...(f?.tags||{}), [t.key]: e.target.checked } }))}
                      />
                      <span>{t.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="button button-primary" onClick={saveEdit}>Save</button>
              <button className="button" onClick={() => { setEditOpen(false); setEditImage(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {/* Image Grid */}
      <div>
        <div className="grid gap-4" style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))'
        }}>
          {loadedImages.map((image, index) => (
            <div 
              key={image.id} 
              className="relative group" 
              draggable={!image.id.startsWith('legacy-')}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              style={{
                aspectRatio: '4/3',
                border: index === 0 ? '2px solid var(--primary)' : '1px solid var(--border-light)',
                borderRadius: 'var(--radius)',
                overflow: 'hidden',
                backgroundColor: 'var(--grey-100)',
                cursor: editMode ? 'pointer' : (draggedIndex === index ? 'grabbing' : 'pointer'),
                opacity: draggedIndex === index ? 0.5 : 1,
                transform: draggedIndex === index ? 'rotate(5deg)' : 'none',
                transition: 'all 0.2s ease'
              }}
            >
              {image.is_primary && (
                <div 
                  className="absolute top-2 left-2 px-2 py-1 text-xs font-medium rounded shadow-sm"
                  style={{
                    backgroundColor: '#10b981',
                    color: 'white',
                    fontSize: '11px',
                    zIndex: 10
                  }}
                >
                  LEAD
                </div>
              )}
              
              {/* Edit mode selection checkbox */}
              {editMode && (
                <div className="absolute top-2 right-2" style={{ zIndex: 12 }}>
                  <input
                    type="checkbox"
                    checked={selectedImages.has(image.id)}
                    onChange={(e) => {
                      const newSelected = new Set(selectedImages);
                      if (e.target.checked) {
                        newSelected.add(image.id);
                      } else {
                        newSelected.delete(image.id);
                      }
                      setSelectedImages(newSelected);
                    }}
                    className="w-4 h-4 text-blue-600 bg-white border-2 border-gray-300 rounded focus:ring-blue-500"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              )}
              <img 
                src={image.thumbnail_url || image.image_url} 
                alt="Vehicle" 
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  pointerEvents: draggedIndex === index ? 'none' : 'auto'
                }}
                onClick={() => {
                  if (editMode) {
                    const newSelected = new Set(selectedImages);
                    if (selectedImages.has(image.id)) {
                      newSelected.delete(image.id);
                    } else {
                      newSelected.add(image.id);
                    }
                    setSelectedImages(newSelected);
                  } else {
                    openLightbox(image, index);
                  }
                }}
                onError={(e) => {
                  console.error('Failed to load image:', image.thumbnail_url || image.image_url);
                  e.currentTarget.style.display = 'none';
                }}
              />
              {/* Delete button only - simplified */}
              {isUuid(image.id) && !editMode && (
                <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ zIndex: 16 }}>
                  <button
                    className="bg-white/90 text-red-600 px-2 py-1 rounded hover:bg-red-600 hover:text-white transition-colors shadow-sm"
                    disabled={!!workingIds[image.id]}
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      if (confirm('Delete this image?')) {
                        deleteImage(image.id, image.storage_path || undefined);
                      }
                    }}
                    title="Delete"
                  >
                    🗑
                  </button>
                </div>
              )}
            </div>
          ))}
          
          {/* Add Photo Button */}
          {showAddButton && (
            <div 
              className="relative group" 
              style={{
                aspectRatio: '4/3',
                border: '2px dashed var(--border-light)',
                borderRadius: 'var(--radius)',
                overflow: 'hidden',
                backgroundColor: 'var(--grey-50)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease'
              }}
            >
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={async (e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    const files = Array.from(e.target.files);
                    
                    setUploadProgress({total: files.length, completed: 0, uploading: true});
                    
                    try {
                      // Import the upload service
                      const { supabase } = await import('../lib/supabase');
                      
                      for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const fileName = `${Date.now()}_${i}_${file.name}`;
                        const filePath = `vehicles/${vehicleId}/images/${fileName}`;
                        
                        // Upload to storage
                        const { error: uploadError } = await supabase.storage
                          .from('vehicle-data')
                          .upload(filePath, file);
                        
                        if (!uploadError) {
                          // Get public URL
                          const { data: urlData } = supabase.storage
                            .from('vehicle-data')
                            .getPublicUrl(filePath);
                          
                          // Save to database
                          await supabase
                            .from('vehicle_images')
                            .insert({
                              vehicle_id: vehicleId,
                              image_url: urlData.publicUrl,
                              storage_path: filePath,
                              filename: file.name,
                              mime_type: file.type,
                              file_size: file.size,
                              category: 'general',
                              is_primary: i === 0 && loadedImages.length === 0
                            });
                        }
                        
                        setUploadProgress(prev => ({...prev, completed: i + 1}));
                      }
                      
                      // Refresh images
                      await loadImages();
                      
                      if (onAddPhotos) {
                        onAddPhotos();
                      }
                    } catch (error) {
                      console.error('Upload failed:', error);
                    } finally {
                      setUploadProgress({total: 0, completed: 0, uploading: false});
                      // Clear the input
                      e.target.value = '';
                    }
                  }
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 group-hover:text-gray-700 transition-colors">
                <div className="w-12 h-12 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center mb-2 group-hover:border-gray-400 transition-colors">
                  <span className="text-xl font-light">+</span>
                </div>
                <div className="text-sm font-medium">Drop files here</div>
                <div className="text-xs text-gray-400">or click to browse</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pro Image Viewer */}
      {lightboxOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          backgroundColor: 'rgba(0,0,0,0.9)'
        }}>
          <button
            onClick={closeLightbox}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'var(--grey-200)',
              border: '2px outset var(--grey-300)',
              fontSize: '14pt',
              width: '32px',
              height: '32px',
              cursor: 'pointer',
              zIndex: 10000
            }}
          >
            ×
          </button>
          <ProImageViewer vehicleId={vehicleId} />
        </div>
      )}
    </div>
  );
};

export default VehicleImageViewer;
