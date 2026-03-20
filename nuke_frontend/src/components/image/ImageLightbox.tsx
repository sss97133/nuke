import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { useImageTags } from '../../hooks/useImageTags';
import { ImageAIChat } from './ImageAIChat';
import { FaviconIcon } from '../common/FaviconIcon';
import { useImageAnalysis } from '../../hooks/useImageAnalysis';
import { useAutoTagging } from '../../hooks/useAutoTagging';
import SpatialPartPopup from '../parts/SpatialPartPopup';
import PartCheckoutModal from '../parts/PartCheckoutModal';
import PartEnrichmentModal from '../parts/PartEnrichmentModal';
import { ManualAnnotationViewer } from './ManualAnnotationViewer';
import { ClickablePartModal } from '../parts/ClickablePartModal';
import { AnnotoriousImageTagger } from './AnnotoriousImageTagger';
import { ImageInfoPanel } from './ImageInfoPanel';
import { ImageExpandedData } from './ImageExpandedData';
import { AdminNotificationService } from '../../services/adminNotificationService';
import toast from 'react-hot-toast';
import '../../design-system.css';

interface ImageLightboxProps {
  imageUrl: string;
  imageId?: string;
  timelineEventId?: string;
  vehicleId?: string;
  organizationId?: string;
  vehicleYMM?: { year?: number; make?: string; model?: string };
  isOpen: boolean;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  canEdit?: boolean;
  /** Position label e.g. "3 of 50" */
  title?: string;
  /** Secondary line e.g. date */
  description?: string;
  /** Display name for this image (caption, filename, or zone) — shown when image is present */
  imageDisplayName?: string;
  /** Full image record from gallery for expanded data panel (caption, file_name, category, vehicle_zone, etc.) */
  imageRecord?: any;
}

// Spatial Tag Marker Component
interface SpatialTagMarkerProps {
  tag: any;
  isShoppable: boolean;
  onClick: () => void;
}

const SpatialTagMarker: React.FC<SpatialTagMarkerProps> = ({ tag, isShoppable, onClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  
  // Determine tag styling based on auto-generation and verification
  const isAutoTag = tag.auto_generated === true;
  const isVerified = tag.verified === true;
  const confidence = tag.confidence_score || 0;
  const isLinkedVehicle = !!tag.linked_vehicle_id;
  
  // Visual styling logic
  let borderColor = 'var(--border)';
  let bgColor = 'var(--surface)';
  let bgColorWithAlpha = 'rgba(255,255,255,0.67)';
  let borderStyle = 'solid';

  if (isAutoTag) {
    if (isVerified) {
      bgColor = 'var(--success)'; // Green - verified auto-tag
      bgColorWithAlpha = 'rgba(40,167,69,0.67)';
      borderColor = 'var(--success)';
    } else {
      bgColor = 'var(--warning)'; // Yellow - unverified auto-tag
      bgColorWithAlpha = 'rgba(176,90,0,0.67)';
      borderColor = 'var(--warning)';
      borderStyle = 'dashed';
    }
  } else if (isShoppable) {
    bgColor = 'var(--success)'; // Green - shoppable
    bgColorWithAlpha = 'rgba(40,167,69,0.67)';
  }

  if (isLinkedVehicle) {
    borderColor = 'var(--accent)'; // Blue border for linked vehicles
  }
  
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'absolute',
        left: `${tag.x_position}%`,
        top: `${tag.y_position}%`,
        width: `${tag.width || 20}%`,
        height: `${tag.height || 20}%`,
        background: isHovered ? bgColor : bgColorWithAlpha,
        border: `3px ${borderStyle} ${borderColor}`, cursor: 'pointer', transition: 'all 0.12s ease',
        zIndex: isHovered ? 10001 : 10000,
        pointerEvents: 'auto',
        opacity: isHovered ? 0.9 : 0.6
      }}
    >
      {isHovered && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: '8px',
          background: 'rgba(0, 0, 0, 0.95)',
          color: 'white',
          padding: '6px 10px', fontSize: '11px',
          fontWeight: 'bold',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          border: `2px solid ${borderColor}`
        }}>
          <div>{tag.tag_text || tag.tag_name}</div>
          {isAutoTag && (
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
              {isVerified ? 'VERIFIED' : `AI ${confidence}%`}
              {isLinkedVehicle && ' • Click to view'}
            </div>
          )}
          {isShoppable && <span> SHOP</span>}
        </div>
      )}
    </div>
  );
};

const ImageLightbox: React.FC<ImageLightboxProps> = ({
  imageUrl,
  imageId,
  timelineEventId,
  vehicleId,
  organizationId,
  vehicleYMM,
  isOpen,
  onClose,
  onNext,
  onPrev,
  canEdit = true,
  title,
  description,
  imageDisplayName,
  imageRecord,
}) => {
  const {
    tags,
    loading: tagsLoading,
    createTag: createTagFn,
    loadTags
  } = useImageTags(imageId);
  
  const {
    analyzing,
    analysisProgress,
    analyzeImage: triggerAIAnalysis
  } = useImageAnalysis();
  
  const {
    autoTagImage,
    isTagging,
    progress: taggingProgress
  } = useAutoTagging();

  const [imageLoaded, setImageLoaded] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [rotation, setRotation] = useState(0);
  const [isSensitive, setIsSensitive] = useState(false);
  const [showTagger, setShowTagger] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [claimTarget, setClaimTarget] = useState<{ platform: string; handle: string; profileUrl?: string | null } | null>(null);
  const [claimProofType, setClaimProofType] = useState<'profile_link' | 'screenshot' | 'other'>('profile_link');
  const [claimProofUrl, setClaimProofUrl] = useState('');
  const [claimNotes, setClaimNotes] = useState('');
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  
  const formatIngestionLabel = (ingestion: any) => {
    const s = String(ingestion || '').trim();
    if (!s) return 'Unknown';
    if (s === 'craigslist_scrape' || s === 'scraper') return 'Automation v.0';
    if (s === 'bat_listing' || s === 'bat_import') return 'BaT import';
    if (s === 'external_import') return 'External import';
    if (s === 'user_upload') return 'User upload';
    if (s === 'dropbox_import') return 'Dropbox import';
    if (s === 'e2e_test') return 'BaT E2E Test';
    return s
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatPlatformLabelFromUrl = (url: string) => {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (host.includes('bringatrailer.com')) return 'Bring a Trailer';
      if (host.includes('carsandbids.com')) return 'Cars & Bids';
      if (host.includes('craigslist.org')) return 'Craigslist';
      if (host.includes('mecum.com') || host.includes('images.mecum.com')) return 'Mecum';
      return host;
    } catch {
      return url;
    }
  };

  // Touch gesture handlers for swipe navigation + info panel
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      // Single finger - swipe, double-tap, or long-press
      const touch = e.touches[0];
      setTouchStart({ x: touch.clientX, y: touch.clientY });
      setIsPinching(false);
      setIsDragging(true);
      
      // Check for double-tap
      const now = Date.now();
      if (now - lastTap < 300) {
        // Double tap detected - toggle zoom
        e.preventDefault();
        setZoom(zoom === 1 ? 2 : 1);
        setLastTap(0);
        return;
      }
      setLastTap(now);
      
      // Start long-press timer
      const timer = setTimeout(() => {
        // Long press detected
        if (canEdit || isAdmin) {
          setContextMenuPos({ x: touch.clientX, y: touch.clientY });
          setShowContextMenu(true);
          // Haptic feedback if available
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
        }
      }, 500);
      setLongPressTimer(timer);
      
    } else if (e.touches.length === 2) {
      // Two fingers - ONLY pinch zoom, no navigation or other gestures
      const distance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      setTouchStartDistance(distance);
      setIsPinching(true);
      
      // Clear long-press timer
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        setLongPressTimer(null);
      }
    }
  };
  
  const handleTouchMove = (e: React.TouchEvent) => {
    // Clear long-press timer if user moves
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    
    if (isPinching && e.touches.length === 2 && touchStartDistance) {
      // Two-finger gesture - ONLY pinch zoom, no navigation or other gestures
      const currentDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      
      // Pinch zoom - continuous scale (only if distance actually changes)
      const distanceChange = Math.abs(currentDistance - touchStartDistance);
      if (distanceChange > 10) {
        const scale = Math.max(1, Math.min(4, currentDistance / touchStartDistance));
        setZoom(scale);
      }
    }
  };
  
  const handleTouchEnd = (e: React.TouchEvent) => {
    // Clear long-press timer
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    
    // If it was a pinch gesture, don't process any navigation
    if (isPinching) {
      setTouchStart(null);
      setTouchStartDistance(null);
      setIsPinching(false);
      setIsDragging(false);
      return;
    }
    
    // If no touch start position, can't process navigation
    if (!touchStart) {
      return;
    }
    
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;
    const distance = Math.hypot(deltaX, deltaY);
    
    // If barely moved, it might be a tap (not a double-tap which is handled earlier)
    if (distance < 10) {
      // Single tap - could toggle UI or other actions
      // Already handled by other logic
    } else {
      // Determine gesture type: horizontal (navigate or sidebar) or vertical (info panel)
      const isMobile = window.innerWidth < 640; // sm breakpoint
      
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        // Horizontal swipe
        if (isMobile && touchStart && touchStart.x < 50) {
          // Swipe from left edge on mobile - control sidebar
          if (deltaX > 80) {
            // Swipe right from left edge - open sidebar
            setShowSidebar(true);
          } else if (deltaX < -80 && showSidebar) {
            // Swipe left - close sidebar
            setShowSidebar(false);
          }
        } else {
          // Horizontal swipe in center - navigate between images
          if (Math.abs(deltaX) > 120) {
            if (deltaX > 0 && onPrev) {
              onPrev();
            } else if (deltaX < 0 && onNext) {
              onNext();
            }
          }
        }
      } else {
        // Vertical swipe - info panel control
        if (Math.abs(deltaY) > 50) {
          if (deltaY < -50) {
            // Swipe up - show comments tab (user requested)
            setShowInfoPanel(true);
            setActiveTab('comments');
            setShowSidebar(true);
          } else if (deltaY > 50 && showInfoPanel) {
            // Swipe down - hide info panel
            setShowInfoPanel(false);
          } else if (deltaY > 100 && !showInfoPanel) {
            // Long swipe down - close lightbox
            onClose();
          }
        }
      }
    }
    
    setTouchStart(null);
    setTouchStartDistance(null);
    setIsPinching(false);
    setIsDragging(false);
  };

  const [attribution, setAttribution] = useState<any>(null);
  const [imageMetadata, setImageMetadata] = useState<any>(null);
  const [angleData, setAngleData] = useState<any>(null);
  const [vehicleOwnerId, setVehicleOwnerId] = useState<string | null>(null);
  const [previousOwners, setPreviousOwners] = useState<Set<string>>(new Set());

  // Sidebar State (Desktop only now) - Open by default
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeTab, setActiveTab] = useState<'info' | 'comments' | 'tags' | 'actions'>('info');
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [locationDisplay, setLocationDisplay] = useState<'coordinates' | 'city' | 'org'>('city');
  
  // Mobile Info Panel State - Start closed, swipe up to reveal
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const infoPanelRef = useRef<any>(null);
  
  // Touch gesture state
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [touchStartDistance, setTouchStartDistance] = useState<number | null>(null);
  const [isPinching, setIsPinching] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [lastTap, setLastTap] = useState<number>(0);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Modals
  const [spatialPopupOpen, setSpatialPopupOpen] = useState(false);
  const [selectedSpatialTag, setSelectedSpatialTag] = useState<any>(null);
  const [clickablePartModalOpen, setClickablePartModalOpen] = useState(false);
  const [selectedPartName, setSelectedPartName] = useState<string | null>(null);
  const [selectedPart, setSelectedPart] = useState<any>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [isPrimary, setIsPrimary] = useState(false);

  const handleSpatialOrder = useCallback((supplier: any) => {
    if (!selectedSpatialTag) return;
    setSelectedPart({
      name: selectedSpatialTag.tag_name,
      partNumber: selectedSpatialTag.oem_part_number,
      supplier,
      vehicleId,
      imageTagId: selectedSpatialTag.id
    });
    setSpatialPopupOpen(false);
    setCheckoutModalOpen(true);
  }, [selectedSpatialTag, vehicleId]);

  // Save rotation to database
  const saveRotation = useCallback(async (newRotation: number) => {
    if (!imageId) return;
    
    try {
      const { error } = await supabase
        .from('vehicle_images')
        .update({ rotation: newRotation })
        .eq('id', imageId);
      
      if (error) {
        console.error('Error saving rotation:', error);
      }
    } catch (err) {
      console.error('Error saving rotation:', err);
    }
  }, [imageId]);

  // Toggle sensitive content blur
  const toggleSensitive = useCallback(async () => {
    if (!imageId) return;
    
    const newSensitive = !isSensitive;
    setIsSensitive(newSensitive);
    
    try {
      const { error } = await supabase
        .from('vehicle_images')
        .update({ is_sensitive: newSensitive })
        .eq('id', imageId);
      
      if (error) {
        console.error('Error saving sensitive state:', error);
        setIsSensitive(!newSensitive); // Revert on error
      }
    } catch (err) {
      console.error('Error saving sensitive state:', err);
      setIsSensitive(!newSensitive); // Revert on error
    }
  }, [imageId, isSensitive]);

  // Update image medium (photograph, render, drawing, screenshot)
  const updateImageMedium = useCallback(async (medium: string) => {
    if (!imageId) return;
    const prev = imageMetadata?.image_medium || 'photograph';
    setImageMetadata((m: any) => m ? { ...m, image_medium: medium } : m);
    try {
      const { error } = await supabase
        .from('vehicle_images')
        .update({ image_medium: medium })
        .eq('id', imageId);
      if (error) {
        console.error('Error updating image medium:', error);
        setImageMetadata((m: any) => m ? { ...m, image_medium: prev } : m);
        toast.error('Failed to update medium');
      } else {
        toast.success(`Tagged as ${medium}`);
        window.dispatchEvent(new CustomEvent('vehicle_images_updated', { detail: { vehicleId } } as any));
      }
    } catch (err) {
      console.error('Error updating image medium:', err);
      setImageMetadata((m: any) => m ? { ...m, image_medium: prev } : m);
    }
  }, [imageId, imageMetadata, vehicleId]);

  // Set as primary image
  const setAsPrimary = useCallback(async () => {
    if (!imageId) return;
    
    // Check permissions: must be admin OR canEdit
    if (!isAdmin && !canEdit) {
      alert('You do not have permission to set primary image');
      return;
    }
    
    try {
      if (vehicleId) {
        // Handle vehicle images
        // Clear all primary flags for this vehicle
        await supabase
          .from('vehicle_images')
          .update({ is_primary: false })
          .eq('vehicle_id', vehicleId);
        
        // Set this image as primary
        const { error } = await supabase
          .from('vehicle_images')
          .update({ is_primary: true })
          .eq('id', imageId);
        
        if (error) {
          console.error('Error setting as primary:', error);
          return;
        }
        
        // Also update vehicle's primary_image_url if available
        const { data: imageData } = await supabase
          .from('vehicle_images')
          .select('image_url, large_url, medium_url')
          .eq('id', imageId)
          .single();
        
        if (imageData) {
          const imageUrl = imageData.large_url || imageData.medium_url || imageData.image_url;
          if (imageUrl) {
            await supabase
              .from('vehicles')
              .update({ primary_image_url: imageUrl })
              .eq('id', vehicleId);
          }
        }
        
        // Update local state
        if (imageMetadata) {
          setImageMetadata({ ...imageMetadata, is_primary: true });
        }
        
        // Emit events to refresh other components
        window.dispatchEvent(new CustomEvent('lead_image_updated', { 
          detail: { vehicleId } 
        } as any));
        window.dispatchEvent(new CustomEvent('vehicle_images_updated', { 
          detail: { vehicleId } 
        } as any));
      } else if (organizationId) {
        // Handle organization images
        // Clear all primary flags for this organization
        await supabase
          .from('organization_images')
          .update({ is_primary: false })
          .eq('organization_id', organizationId);
        
        // Set this image as primary
        const { error } = await supabase
          .from('organization_images')
          .update({ is_primary: true })
          .eq('id', imageId);
        
        if (error) {
          console.error('Error setting as primary:', error);
          return;
        }
        
        // Also update organization's logo_url if available
        const { data: imageData } = await supabase
          .from('organization_images')
          .select('image_url, large_url, medium_url')
          .eq('id', imageId)
          .single();
        
        if (imageData) {
          const imageUrl = imageData.large_url || imageData.medium_url || imageData.image_url;
          if (imageUrl) {
            await supabase
              .from('businesses')
              .update({ logo_url: imageUrl })
              .eq('id', organizationId);
          }
        }
        
        // Update local state
        if (imageMetadata) {
          setImageMetadata({ ...imageMetadata, is_primary: true });
        }
        
        // Reload page or emit event to refresh
        window.location.reload();
      }
    } catch (err) {
      console.error('Error setting as primary:', err);
      alert('Failed to set primary image: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  }, [imageId, vehicleId, organizationId, imageMetadata, isAdmin, canEdit]);

  // Delete image
  const deleteImage = useCallback(async () => {
    if (!imageId) return;

    const confirmed = window.confirm('Delete this image? This action cannot be undone.');
    if (!confirmed) return;

    try {
      // Get storage path before deleting DB record
      const { data: imageRecord } = await supabase
        .from('vehicle_images')
        .select('storage_path')
        .eq('id', imageId)
        .single();

      const { error } = await supabase
        .from('vehicle_images')
        .delete()
        .eq('id', imageId);

      if (error) {
        console.error('Error deleting image:', error);
        const reason = error.message || error.code || 'Unknown error';
        toast.error(`Failed to delete image: ${reason}`);
        return;
      }

      // Clean up storage file
      if (imageRecord?.storage_path) {
        const bucket = imageRecord.storage_path.startsWith('vehicles/') ? 'vehicle-data' : 'vehicle-photos';
        await supabase.storage.from(bucket).remove([imageRecord.storage_path]);
      }

      toast.success('Image deleted');

      // Emit event to refresh gallery
      window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
        detail: { vehicleId }
      } as any));

      // Close lightbox
      onClose();
    } catch (err) {
      console.error('Error deleting image:', err);
      const reason = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to delete image: ${reason}`);
    }
  }, [imageId, vehicleId, onClose]);

  // Remove image from vehicle (send back to personal photo library)
  const removeFromVehicle = useCallback(async () => {
    if (!imageId || !vehicleId) return;

    try {
      const { error } = await supabase
        .from('vehicle_images')
        .update({
          vehicle_id: null,
          organization_status: 'unorganized',
          organized_at: null,
          is_primary: false,
        })
        .eq('id', imageId);

      if (error) {
        console.error('Error removing image from vehicle:', error);
        const reason = error.message || error.code || 'Unknown error';
        toast.error(`Failed to remove image: ${reason}`);
        return;
      }

      toast.success('Image moved to your photo library');

      window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
        detail: { vehicleId }
      } as any));

      onClose();
    } catch (err) {
      console.error('Error removing image from vehicle:', err);
      const reason = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to remove image: ${reason}`);
    }
  }, [imageId, vehicleId, onClose]);

  // Get session
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        const adminStatus = await AdminNotificationService.isCurrentUserAdmin();
        setIsAdmin(adminStatus);
      }
    });
  }, []);

  // Reset transient analysis UI state when switching images
  useEffect(() => {
    setAnalysisError(null);
    setClaimDialogOpen(false);
    setClaimTarget(null);
    setClaimSubmitting(false);
    setClaimError(null);
    setClaimProofType('profile_link');
    setClaimProofUrl('');
    setClaimNotes('');
  }, [imageId]);

  // Load Metadata & Attribution
  const loadImageMetadata = useCallback(async () => {
    if (!imageId || (!vehicleId && !organizationId)) return;

    // Load vehicle ownership info
    try {
      const { data: vehicleData } = await supabase
        .from('vehicles')
        .select('user_id, uploaded_by')
        .eq('id', vehicleId)
        .single();
      
      if (vehicleData) {
        // Current owner is user_id (or uploaded_by as fallback)
        const currentOwnerId = vehicleData.user_id || vehicleData.uploaded_by;
        setVehicleOwnerId(currentOwnerId || null);
        
        // Load previous owners from ownership history
        const { data: ownershipData } = await supabase
          .from('vehicle_ownerships')
          .select('owner_profile_id, is_current')
          .eq('vehicle_id', vehicleId)
          .eq('is_current', false);
        
        if (ownershipData) {
          const prevOwners = new Set(ownershipData.map(o => o.owner_profile_id).filter(Boolean));
          setPreviousOwners(prevOwners);
        }
      }
    } catch (err) {
      console.warn('Error loading vehicle ownership:', err);
    }

    // Also check vehicle_contributors for previous owner role
    try {
      const { data: contributors } = await supabase
        .from('vehicle_contributors')
        .select('user_id, role')
        .eq('vehicle_id', vehicleId)
        .eq('role', 'previous_owner')
        .eq('status', 'active');
      
      if (contributors) {
        contributors.forEach(c => {
          if (c.user_id) {
            setPreviousOwners(prev => new Set([...prev, c.user_id]));
          }
        });
      }
    } catch (err) {
      console.warn('Error loading contributors:', err);
    }

    // Image Metadata - load image first, then load profile separately
    const { data: imgData, error: imgError } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('id', imageId)
      .single();
    
    if (imgData) {
      setImageMetadata(imgData);
      
      // Load rotation and sensitive state from database
      if (imgData.rotation !== undefined) {
        setRotation(imgData.rotation || 0);
      }
      if (imgData.is_sensitive !== undefined) {
        setIsSensitive(imgData.is_sensitive || false);
      }
      
      // CRITICAL: Check ghost user attribution first (actual photographer)
      // Then fall back to uploader profile (person who imported it)
      let photographerInfo = null;
      let uploaderInfo = null;
      
      // 1. Check for ghost user attribution (EXIF-based photographer)
      const { data: deviceAttr } = await supabase
        .from('device_attributions')
        .select(`
          ghost_user_id,
          attribution_source,
          confidence_score,
          ghost_users!inner (
            display_name,
            camera_make,
            camera_model
          )
        `)
        .eq('image_id', imageId)
        .maybeSingle();
      
      if (deviceAttr?.ghost_users && !Array.isArray(deviceAttr.ghost_users)) {
        const ghostUser = deviceAttr.ghost_users as any;
        photographerInfo = {
          name: ghostUser.display_name,
          camera: `${ghostUser.camera_make || ''} ${ghostUser.camera_model || ''}`.trim(),
          isGhost: true,
          confidence: deviceAttr.confidence_score
        };
      }
      
      // 2. For BAT images, get organization attribution instead of user
      let organizationInfo = null;
      if (imgData.source === 'bat_listing' && vehicleId) {
        // Get organization from vehicle's organization_vehicles relationship with relationship type
        const { data: orgData } = await supabase
          .from('organization_vehicles')
          .select(`
            organization_id,
            relationship_type,
            businesses!inner (
              id,
              business_name
            )
          `)
          .eq('vehicle_id', vehicleId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (orgData?.businesses && !Array.isArray(orgData.businesses)) {
          const org = orgData.businesses as any;
          const relationshipLabels: Record<string, string> = {
            owner: 'Owner',
            consigner: 'Consignment',
            collaborator: 'Collaborator',
            service_provider: 'Service',
            work_location: 'Work site',
            seller: 'Seller',
            buyer: 'Buyer',
            parts_supplier: 'Parts',
            fabricator: 'Fabricator',
            painter: 'Paint',
            upholstery: 'Upholstery',
            transport: 'Transport',
            storage: 'Storage',
            inspector: 'Inspector'
          };
          
          organizationInfo = {
            id: org.id,
            name: org.business_name || 'Unknown Organization',
            relationshipType: orgData.relationship_type,
            relationshipLabel: relationshipLabels[orgData.relationship_type] || orgData.relationship_type || 'Linked'
          };
        }
      }

      // 2.5. For auction images, infer the *origin* (seller) from vehicle_events data when available.
      // This is distinct from the ingestion action (import/scrape) and helps preserve provenance.
      let sellerInfo: any = null;
      // If the vehicle has a BaT event, treat the seller as the default origin for auction photos.
      if (vehicleId) {
        try {
          const { data: batEvent } = await supabase
            .from('vehicle_events')
            .select(`
              source_url,
              seller_identifier,
              seller_external_identity_id
            `)
            .eq('vehicle_id', vehicleId)
            .eq('source_platform', 'bat')
            .order('ended_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          // If we have a seller_external_identity_id, look up the identity details separately
          let sellerIdentity: any = null;
          if (batEvent?.seller_external_identity_id) {
            const { data: identity } = await supabase
              .from('external_identities')
              .select('id, platform, handle, profile_url, display_name, claimed_by_user_id, claim_confidence')
              .eq('id', batEvent.seller_external_identity_id)
              .maybeSingle();
            sellerIdentity = identity;
          }

          const handle = batEvent?.seller_identifier || sellerIdentity?.handle || null;
          if (handle) {
            sellerInfo = {
              platform: 'bat',
              handle,
              displayName: sellerIdentity?.display_name || null,
              profileUrl: sellerIdentity?.profile_url || `https://bringatrailer.com/member/${handle}/`,
              claimedByUserId: sellerIdentity?.claimed_by_user_id || null,
              claimConfidence: sellerIdentity?.claim_confidence || null,
              listingUrl: batEvent?.source_url || null
            };
          }
        } catch (err) {
          // Non-blocking: provenance may be incomplete in some envs.
          sellerInfo = null;
        }
      }
      
      // 3. Load uploader profile (person who ran the import) - only if not BAT
      // For imported images (Craigslist, etc.), user_id is the importer, not the photographer
      // Only show uploader if it's a direct upload (not imported/scraped)
      if (!organizationInfo && imgData.user_id && imgData.source !== 'scraper' && imgData.source !== 'craigslist_scrape' && imgData.source !== 'bat_listing') {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .eq('id', imgData.user_id)
          .single();

        uploaderInfo = profileData;
      }
      
      setAttribution({
        photographer: photographerInfo,
        uploader: uploaderInfo || null,
        organization: organizationInfo,
        seller: sellerInfo,
        source: imgData.source,
        created_at: imgData.created_at
      });
      
      // Show toast notification for BAT images
      if (imgData.source === 'bat_listing' && organizationInfo) {
        // Create toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: rgba(0, 0, 0, 0.9);
          color: white;
          padding: 16px 20px;
          border-radius: 8px;
          border: 2px solid var(--border);
          z-index: 10001;
          font-size: 12px;
          max-width: 300px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        const relationshipText = organizationInfo.relationshipLabel 
          ? `${organizationInfo.relationshipLabel} • ${organizationInfo.name}`
          : organizationInfo.name;
        toast.innerHTML = `
          <div style="font-weight: bold; margin-bottom: 4px;">Linked organization</div>
          <div style="font-size: 11px; margin-bottom: 2px;">${organizationInfo.name}</div>
          ${organizationInfo.relationshipLabel ? `<div style="font-size: 10px; color: rgba(255,255,255,0.7);">${organizationInfo.relationshipLabel}</div>` : ''}
          <button onclick="this.parentElement.remove()" style="position: absolute; top: 4px; right: 4px; background: transparent; color: rgba(255,255,255,0.9); border: none; padding: 2px 6px; font-size: 14px; cursor: pointer; font-weight: bold;">×</button>
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
          if (toast.parentElement) {
            toast.remove();
          }
        }, 5000);
      }
    }

    // Resolve canonical angle via spectrum → observations → raw fallback
    try {
      const { resolveAngle } = await import('../../utils/resolveAngle');
      const resolved = await resolveAngle(imageId, imgData.angle);
      setAngleData(resolved);
    } catch {
      setAngleData(null);
    }

    // Comments - load comments and profiles separately
    try {
      const { data: commentData } = await supabase
        .from('vehicle_image_comments')
        .select('*')
        .eq('image_id', imageId)
        .order('created_at', { ascending: false });
      
      if (commentData && commentData.length > 0) {
        // Load profiles for all commenters
        const userIds = [...new Set(commentData.map(c => c.user_id).filter(Boolean))];
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', userIds);
        
        const profilesMap = new Map((profilesData || []).map(p => [p.id, p]));
        const commentsWithUsers = commentData.map(comment => ({
          ...comment,
          user: comment.user_id ? profilesMap.get(comment.user_id) || null : null
        }));
        
        setComments(commentsWithUsers);
      } else {
        setComments([]);
      }
    } catch (err) {
      console.warn('Error loading comments:', err);
      setComments([]);
    }
  }, [imageId, vehicleId]);

  const runImageAnalysis = useCallback(
    async (opts?: { forceReprocess?: boolean }) => {
      if (!imageUrl) return;

      // Without image_id we can’t reliably hit caching/persistence.
      if (!imageId) {
        const msg = 'Missing image ID — cannot run analysis safely.';
        console.warn('[ImageLightbox] Skipping AI analysis:', msg);
        setAnalysisError(msg);
        return;
      }

      // If explicitly forcing reprocess, confirm intent (can increase spend).
      if (opts?.forceReprocess) {
        const confirmed = window.confirm(
          'Force reprocess this image?\n\nThis can trigger a new paid AI run even if we already have results.'
        );
        if (!confirmed) return;
      }

      setAnalysisError(null);
      const userId = session?.user?.id || null;

      const result = await triggerAIAnalysis(imageUrl, timelineEventId, vehicleId, {
        imageId,
        userId,
        forceReprocess: Boolean(opts?.forceReprocess)
      });

      if (result.success) {
        // Give the DB a moment to update before reloading.
        setTimeout(() => {
          loadTags();
          loadImageMetadata();
        }, 2000);
      } else if (result.error) {
        setAnalysisError(result.error);
      }
    },
    [imageUrl, vehicleId, imageId, session?.user?.id, triggerAIAnalysis, timelineEventId, loadTags, loadImageMetadata]
  );

  const submitClaim = useCallback(async () => {
    if (!claimTarget) return;
    setClaimSubmitting(true);
    setClaimError(null);

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        setClaimError('Please sign in to submit a claim.');
        return;
      }

      const payload: any = {
        p_platform: claimTarget.platform,
        p_handle: claimTarget.handle,
        p_profile_url: claimTarget.profileUrl || null,
        p_proof_type: claimProofType,
        p_proof_url: claimProofUrl.trim() ? claimProofUrl.trim() : null,
        p_notes: claimNotes.trim() ? claimNotes.trim() : null
      };

      const { error } = await supabase.rpc('request_external_identity_claim', payload);
      if (error) {
        setClaimError(error.message);
        return;
      }

      setClaimDialogOpen(false);
      setClaimTarget(null);
      setClaimProofUrl('');
      setClaimNotes('');
      alert('Claim request submitted. We’ll review it as soon as proof is available.');
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setClaimSubmitting(false);
    }
  }, [claimTarget, claimProofType, claimProofUrl, claimNotes]);

  useEffect(() => {
    loadImageMetadata();
    
    // Subscribe to realtime changes for this image's metadata
    if (imageId) {
      const channel = supabase
        .channel(`image-metadata-${imageId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'vehicle_images',
            filter: `id=eq.${imageId}`
          },
          (payload) => {
            console.log('Image metadata updated, reloading...', payload);
            // Reload metadata when image is updated
            loadImageMetadata();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [loadImageMetadata, imageId]);
  
  // Also listen for custom events (for compatibility)
  useEffect(() => {
    const handleImageUpdate = () => {
      if (imageId) {
        loadImageMetadata();
      }
    };
    
    window.addEventListener('vehicle_images_updated', handleImageUpdate as any);
    window.addEventListener('image_metadata_updated', handleImageUpdate as any);
    
    return () => {
      window.removeEventListener('vehicle_images_updated', handleImageUpdate as any);
      window.removeEventListener('image_metadata_updated', handleImageUpdate as any);
    };
  }, [loadImageMetadata, imageId]);

  // Comments Logic
  const addComment = async () => {
    if (!newComment.trim() || !imageId || !session?.user) return;
    
    try {
      const { error } = await supabase.from('vehicle_image_comments').insert({
        image_id: imageId,
        user_id: session.user.id,
        comment_text: newComment.trim(),
        vehicle_id: vehicleId
      });

      if (error) {
        console.error('Error posting comment:', error);
        alert('Failed to post comment: ' + error.message);
        return;
      }

      setNewComment('');
      // Reload comments using the same method as loadImageMetadata
      const { data: commentData } = await supabase
        .from('vehicle_image_comments')
        .select('*')
        .eq('image_id', imageId)
        .order('created_at', { ascending: false });
      
      if (commentData && commentData.length > 0) {
        const userIds = [...new Set(commentData.map(c => c.user_id).filter(Boolean))];
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']); // Dummy ID if empty
        
        const profilesMap = new Map((profilesData || []).map(p => [p.id, p]));
        const commentsWithUsers = commentData.map(comment => ({
          ...comment,
          user: comment.user_id ? profilesMap.get(comment.user_id) || null : null
        }));
        
        setComments(commentsWithUsers);
      } else {
        setComments([]);
      }
    } catch (err) {
      console.error('Error posting comment:', err);
      alert('Failed to post comment');
    }
  };

  // Lock body scroll and handle keyboard/wheel navigation
  useEffect(() => {
    // Lock body scroll when lightbox is open
    document.body.style.overflow = 'hidden';
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (claimDialogOpen) {
          setClaimDialogOpen(false);
          setClaimTarget(null);
          setClaimError(null);
          return;
        }
        if (showTagger) {
          setShowTagger(false);
        } else {
          onClose();
        }
      }
      if (e.key === 'ArrowLeft' && onPrev && !showTagger) onPrev();
      if (e.key === 'ArrowRight' && onNext && !showTagger) onNext();
    };
    
    // Handle wheel events - on desktop, allow sidebar scrolling or image panning
    const handleWheel = (e: WheelEvent) => {
      // Only navigate if not in tagger
      if (showTagger) return;
      
      // Check if we're over the sidebar
      const target = e.target as HTMLElement;
      if (sidebarRef.current && sidebarRef.current.contains(target)) {
        // If over sidebar, allow normal scrolling - don't prevent default
        return;
      }
      
      // On desktop, don't use wheel for image navigation
      // Allow normal scroll/pan behavior instead
      // (This prevents accidental navigation while scrolling)
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      // Restore body scroll when lightbox closes
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [onClose, onPrev, onNext, showTagger, claimDialogOpen]);

  if (!isOpen) return null;

  // If Tagger is open, show it fullscreen
  if (showTagger) {
    return createPortal(
      <div 
        className="fixed inset-0 bg-[#0a0a0a] flex flex-col"
        style={{
          zIndex: 10000,
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0
        }}
      >
        {/* Close button for tagger */}
        <div className="flex items-center justify-between px-6 py-3 bg-[#111] border-b-2 border-white/20">
          <span className="text-[10px] text-white/50 font-medium tracking-wide uppercase">
            IMAGE TAGGER
          </span>
          <button 
            onClick={() => {
              setShowTagger(false);
              loadTags();
              loadImageMetadata();
            }}
            className="px-4 py-2 bg-transparent border-2 border-white/30 text-white text-[10px] font-bold uppercase tracking-wide hover:border-white hover:bg-white/10 transition-all duration-150"
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            DONE
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <AnnotoriousImageTagger
            imageUrl={imageUrl}
            imageId={imageId}
            vehicleId={vehicleId}
            onTagsUpdate={() => {
              loadTags();
              loadImageMetadata();
            }}
          />
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div 
      className="fixed inset-0 bg-[#0a0a0a] flex flex-col text-white" 
      style={{ 
        fontFamily: 'Arial, sans-serif',
        zIndex: 10000,
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0
      }}
    >
      {/* Header - Mobile-Optimized */}
      <div className="bg-[#111] border-b-2 border-white/20">
        {/* Mobile: Single Row, Actually Minimal */}
        <div className="block sm:hidden">
          <div 
            style={{ 
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: '#0a0a0a',
              padding: '4px 8px',
              flexWrap: 'nowrap',
              gap: '8px',
              minWidth: 0,
              width: '100%'
            }}
          >
            <button 
              onClick={onClose}
              style={{ 
                fontFamily: 'Arial, sans-serif', 
                fontSize: '8px', 
                padding: '2px 4px', 
                flexShrink: 0,
                color: 'var(--surface-glass)',
                fontWeight: 700,
                textTransform: 'uppercase',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              CLOSE
            </button>
            
            {(imageDisplayName || title) && (
              <span 
                style={{ 
                  fontSize: '8px' as const, 
                  whiteSpace: 'nowrap', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis', 
                  minWidth: 0,
                  flex: '1 1 auto',
                  color: 'rgba(255,255,255,0.85)',
                  fontWeight: 600,
                  textAlign: 'center'
                }}
                title={imageDisplayName ? `${imageDisplayName}${title ? ` · ${title}` : ''}` : title}
              >
                {imageDisplayName || title}
              </span>
            )}
          </div>
        </div>

        {/* Desktop: Original horizontal layout */}
        <div className="hidden sm:flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-4">
          <button 
            onClick={onClose}
              className="text-white/60 hover:text-white text-[10px] font-semibold"
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            CLOSE
          </button>
          <div className="h-3 w-[1px] bg-white/20"></div>
          <span className="text-[9px] text-white/50 font-medium tracking-wide uppercase" title={imageDisplayName || undefined}>
            {imageDisplayName || description || title || 'IMAGE'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {onPrev && (
            <button 
              onClick={onPrev}
              className="px-3 py-1.5 bg-[#1a1a1a] border-2 border-white/30 text-white text-[9px] font-bold uppercase tracking-wide hover:border-white hover:bg-white/10 transition-all duration-150"
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              ← PREV
            </button>
          )}
          {onNext && (
            <button 
              onClick={onNext}
              className="px-3 py-1.5 bg-[#1a1a1a] border-2 border-white/30 text-white text-[9px] font-bold uppercase tracking-wide hover:border-white hover:bg-white/10 transition-all duration-150"
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              NEXT →
            </button>
          )}
          
          {(canEdit || isAdmin) && (
            <>
              <div className="h-6 w-[1px] bg-white/20"></div>
              <button
                onClick={() => setShowTagger(true)}
                className="px-3 py-1.5 bg-white text-black border-2 border-white text-[9px] font-bold uppercase tracking-wide hover:bg-white/90 transition-all duration-150"
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                TAG
              </button>
              <button
                onClick={setAsPrimary}
                disabled={imageMetadata?.is_primary}
                className={`px-3 py-1.5 border-2 text-[9px] font-bold uppercase tracking-wide transition-all duration-150 ${
                  imageMetadata?.is_primary
                    ? 'bg-green-900/30 border-green-700/50 text-green-400 cursor-not-allowed'
                    : 'bg-transparent border-white/30 text-white hover:border-white hover:bg-white/10'
                }`}
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                  PRIMARY
              </button>
            </>
          )}

          <div className="h-6 w-[1px] bg-white/20"></div>
          
          <button 
            onClick={() => {
              const newRotation = (rotation + 90) % 360;
              setRotation(newRotation);
              saveRotation(newRotation);
            }}
            className="px-3 py-1.5 bg-transparent border-2 border-white/30 text-white text-[9px] font-bold uppercase tracking-wide hover:border-white hover:bg-white/10 transition-all duration-150"
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            ROTATE
          </button>
          
          <button 
            onClick={toggleSensitive}
            className={`px-3 py-1.5 border-2 text-[9px] font-bold uppercase tracking-wide transition-all duration-150 ${
              isSensitive 
                ? 'bg-yellow-600 text-black border-yellow-400 hover:bg-yellow-500' 
                : 'bg-transparent border-white/30 text-white hover:border-white hover:bg-white/10'
            }`}
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            SENS
          </button>
          
          {/* Medium toggle */}
          {(canEdit || isAdmin) && (
            <>
              <div className="h-6 w-[1px] bg-white/20"></div>
              {(['photograph', 'render', 'drawing', 'screenshot'] as const).map((m) => {
                const labels: Record<string, string> = { photograph: 'PHOTO', render: 'RENDER', drawing: 'DRAWING', screenshot: 'SCREEN' };
                const active = (imageMetadata?.image_medium || 'photograph') === m;
                return (
                  <button
                    key={m}
                    onClick={() => updateImageMedium(m)}
                    className={`px-2 py-1.5 border-2 text-[8px] font-bold uppercase tracking-wide transition-all duration-150 ${
                      active
                        ? 'bg-white text-black border-white'
                        : 'bg-transparent border-white/20 text-white/50 hover:border-white/50 hover:text-white'
                    }`}
                    style={{ fontFamily: 'Arial, sans-serif' }}
                  >
                    {labels[m]}
                  </button>
                );
              })}
            </>
          )}

          {/* AI status indicator - only show retry on failure, subtle status otherwise */}
          {(() => {
            const status = imageMetadata?.ai_processing_status;
            if (status === 'failed') {
              return (
                <button
                  onClick={async (e) => {
                    await runImageAnalysis({ forceReprocess: (e as any)?.altKey === true });
                  }}
                  disabled={analyzing || !imageUrl || !imageId}
                  className={`px-3 py-1.5 border-2 text-[9px] font-bold uppercase tracking-wide transition-all duration-150 ${
                    analyzing
                      ? 'bg-[#2a2a2a] text-white/40 border-white/10 cursor-not-allowed'
                      : 'bg-transparent border-red-600/50 text-red-400 hover:border-red-500 hover:bg-red-600/10'
                  }`}
                  style={{ fontFamily: 'Arial, sans-serif' }}
                >
                  {analyzing ? 'RETRYING...' : 'RETRY'}
                </button>
              );
            }
            if (status === 'processing' || analyzing) {
              return (
                <span
                  className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wide text-white/40"
                  style={{ fontFamily: 'Arial, sans-serif' }}
                >
                  Analyzing...
                </span>
              );
            }
            if (status === 'pending') {
              return (
                <span
                  className="px-3 py-1.5 text-[9px] uppercase tracking-wide text-white/30"
                  style={{ fontFamily: 'Arial, sans-serif' }}
                >
                  Queued
                </span>
              );
            }
            // completed or unknown: show nothing in toolbar
            // Alt+click on the INFO button area still available for power users
            // Hidden power-user reprocess: hold Alt and click this invisible target
            return (
              <span
                className="px-1 py-1.5 cursor-default"
                onClick={async (e) => {
                  if ((e as any)?.altKey) {
                    await runImageAnalysis({ forceReprocess: true });
                  }
                }}
                title="Alt+click to force reprocess"
                style={{ opacity: 0, width: '1px', overflow: 'hidden' }}
              />
            );
          })()}
          
          <button 
            onClick={() => setShowSidebar(!showSidebar)}
            className={`px-3 py-1.5 border-2 text-[9px] font-bold uppercase tracking-wide transition-all duration-150 ${
              showSidebar 
                ? 'bg-white text-black border-white' 
                : 'bg-transparent border-white/30 text-white hover:border-white hover:bg-white/10'
            }`}
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            INFO
          </button>
          </div>
        </div>
      </div>

      {/* Two-Finger Quick Actions Bar (Mobile) */}
      {showQuickActions && (canEdit || isAdmin) && (
        <div 
          className="block sm:hidden fixed bottom-0 left-0 right-0 bg-[#0a0a0a] border-t-2 border-white/20 p-2 flex justify-around items-center"
          style={{ zIndex: 10002 }}
        >
          <button
            onClick={() => { setShowTagger(true); setShowQuickActions(false); }}
            className="flex-1 py-3 text-white text-[10px] font-bold border-2 border-white/30 bg-white text-black mx-1"
          >
            TAG
          </button>
          <button
            onClick={() => { setAsPrimary(); setShowQuickActions(false); }}
            disabled={imageMetadata?.is_primary}
            className="flex-1 py-3 text-white text-[10px] font-bold border-2 border-white/30 mx-1"
            style={{ backgroundColor: imageMetadata?.is_primary ? 'var(--success)' : 'rgba(255,255,255,0.1)' }}
          >
            PRIMARY
          </button>
          <button
            onClick={() => { const r = (rotation + 90) % 360; setRotation(r); saveRotation(r); setShowQuickActions(false); }}
            className="flex-1 py-3 text-white text-[10px] font-bold border-2 border-white/30 bg-transparent mx-1"
          >
            ROTATE
          </button>
          <button
            onClick={() => { toggleSensitive(); setShowQuickActions(false); }}
            className="flex-1 py-3 text-[10px] font-bold border-2 border-white/30 mx-1"
            style={{ backgroundColor: isSensitive ? 'var(--warning)' : 'rgba(255,255,255,0.1)', color: isSensitive ? 'black' : 'white' }}
          >
            BLUR
          </button>
          <button
            onClick={() => setShowQuickActions(false)}
            className="flex-1 py-3 text-white text-[10px] font-bold border-2 border-red-600 bg-red-600 mx-1"
          >
            X
          </button>
        </div>
      )}

      {/* Long-Press Context Menu (Mobile) */}
      {showContextMenu && (canEdit || isAdmin) && (
        <>
          <div 
            className="block sm:hidden fixed inset-0"
            style={{ zIndex: 10003, backgroundColor: 'transparent' }}
            onClick={() => setShowContextMenu(false)}
          />
          <div
            className="block sm:hidden fixed bg-[#0a0a0a] border-2 border-white/30"
            style={{
              zIndex: 10004,
              left: `${Math.min(contextMenuPos.x, typeof window !== 'undefined' ? window.innerWidth - 200 : 200)}px`,
              top: `${Math.min(contextMenuPos.y, typeof window !== 'undefined' ? window.innerHeight - 300 : 300)}px`,
              minWidth: '180px'
            }}
          >
            <button
              onClick={() => { setAsPrimary(); setShowContextMenu(false); }}
              className="w-full py-2 px-3 text-left text-white text-[9px] font-bold hover:bg-white/10 border-b border-white/10"
            >
              Set as Primary
            </button>
            <button
              onClick={() => { setShowTagger(true); setShowContextMenu(false); }}
              className="w-full py-2 px-3 text-left text-white text-[9px] font-bold hover:bg-white/10 border-b border-white/10"
            >
              Tag Image
            </button>
            <button
              onClick={() => { 
                if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  navigator.clipboard.writeText(imageUrl);
                }
                setShowContextMenu(false);
              }}
              className="w-full py-2 px-3 text-left text-white text-[9px] font-bold hover:bg-white/10 border-b border-white/10"
            >
              Copy Image URL
            </button>
            <button
              onClick={() => { 
                const a = document.createElement('a');
                a.href = imageUrl;
                a.download = 'image.jpg';
                a.click();
                setShowContextMenu(false);
              }}
              className="w-full py-2 px-3 text-left text-white text-[9px] font-bold hover:bg-white/10 border-b border-white/10"
            >
              Download Original
            </button>
            <button
              onClick={() => { toggleSensitive(); setShowContextMenu(false); }}
              className="w-full py-2 px-3 text-left text-white text-[9px] font-bold hover:bg-white/10 border-b border-white/10"
            >
              Mark Sensitive
            </button>
            {vehicleId && (
              <button
                onClick={() => {
                  removeFromVehicle();
                  setShowContextMenu(false);
                }}
                className="w-full py-2 px-3 text-left text-yellow-400 text-[9px] font-bold hover:bg-white/10 border-b border-white/10"
              >
                Remove from Vehicle
              </button>
            )}
            <button
              onClick={() => {
                if (confirm('Delete this image? Cannot be undone.')) {
                  deleteImage();
                }
                setShowContextMenu(false);
              }}
              className="w-full py-2 px-3 text-left text-red-500 text-[9px] font-bold hover:bg-white/10"
            >
              Delete Image
            </button>
          </div>
        </>
      )}

      {/* Main Content */}
      <div 
        className="flex-1 flex overflow-hidden relative" 
        style={{ 
          minHeight: 0,
          display: 'flex',
          flexDirection: 'row'
        }}
      >
        {/* Image Canvas - Takes remaining space */}
        <div
          ref={containerRef}
          className="flex-1 flex items-center justify-center p-4 relative"
          style={{ 
            minWidth: 0, 
            minHeight: 0,
            flex: '1 1 auto',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Vehicle"
            onLoad={() => setImageLoaded(true)}
            className="object-contain select-none"
            style={{ 
              pointerEvents: 'auto',
              transform: `rotate(${rotation}deg) scale(${zoom})`,
              transition: 'transform 0.3s ease, filter 0.3s ease',
              display: 'block',
              filter: isSensitive ? 'blur(20px)' : 'none',
              cursor: zoom > 1 ? 'grab' : 'default',
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain'
            }}
          />

          {/* Markers - Positioned absolutely over image */}
          {imageLoaded && tags.map(tag => (
            <SpatialTagMarker
              key={tag.id}
              tag={tag}
              isShoppable={!!tag.is_shoppable}
              onClick={() => {
                // If linked to another vehicle, open that vehicle profile
                if ((tag as any).linked_vehicle_id) {
                  window.open(`/vehicle/${(tag as any).linked_vehicle_id}`, '_blank');
                } else if (tag.tag_name || (tag as any).tag_text) {
                  setSelectedPartName(tag.tag_name || (tag as any).tag_text);
                  setClickablePartModalOpen(true);
                } else {
                  setSelectedSpatialTag(tag);
                  setSpatialPopupOpen(true);
                }
              }}
            />
          ))}
        </div>

        {/* Sidebar - Cursor Style - Fixed width, doesn't shrink, collapsible on desktop, swipeable on mobile */}
        {showSidebar && (
          <div 
            ref={sidebarRef}
            className="bg-[#111] border-l-2 border-white/20 flex flex-col overflow-hidden"
            style={{
              width: '256px',
              flexShrink: 0,
              minWidth: '256px',
              maxWidth: '256px',
              minHeight: 0,
              transition: 'transform 0.3s ease-out',
              // On mobile, allow swipe gestures on the sidebar itself
              touchAction: 'pan-y'
            }}
          >
            {/* Sidebar Header with Minimize Button */}
            <div className="flex items-center justify-between px-3 py-2 border-b-2 border-white/20">
              <span className="text-[8px] text-white/50 font-bold uppercase tracking-wide">DETAIL</span>
              <button 
                onClick={() => setShowSidebar(false)}
                className="px-2 py-1 bg-transparent border border-white/30 text-white text-[8px] font-bold uppercase tracking-wide hover:border-white hover:bg-white/10 transition-all duration-150"
                style={{ fontFamily: 'Arial, sans-serif' }}
                title="Minimize sidebar"
              >
                MINIMIZE
              </button>
            </div>

            {/* Tabs - Cursor Style */}
            <div className="flex border-b-2 border-white/20">
              {(canEdit || isAdmin) && (
                <button 
                  onClick={() => setActiveTab('actions')}
                  className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wide transition-all duration-150 ${
                    activeTab === 'actions' 
                      ? 'text-white border-b-2 border-white bg-white/5' 
                      : 'text-white/50 hover:text-white hover:bg-white/5'
                  }`}
                  style={{ fontFamily: 'Arial, sans-serif' }}
                >
                  ACTIONS
                </button>
              )}
              <button 
                onClick={() => setActiveTab('info')}
                className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wide transition-all duration-150 ${
                  activeTab === 'info' 
                    ? 'text-white border-b-2 border-white bg-white/5' 
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                INFO
              </button>
              <button 
                onClick={() => setActiveTab('comments')}
                className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wide transition-all duration-150 ${
                  activeTab === 'comments' 
                    ? 'text-white border-b-2 border-white bg-white/5' 
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                COMMENTS
              </button>
              <button 
                onClick={() => setActiveTab('tags')}
                className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wide transition-all duration-150 ${
                  activeTab === 'tags' 
                    ? 'text-white border-b-2 border-white bg-white/5' 
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                TAGS
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4" style={{ WebkitOverflowScrolling: 'touch', minHeight: 0 }}>
              {/* Actions Tab (Mobile Quick Actions) */}
              {activeTab === 'actions' && (canEdit || isAdmin) && (
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      setShowTagger(true);
                      setShowSidebar(false);
                    }}
                    className="w-full py-3 px-4 bg-white text-black border-2 border-white text-[10px] font-bold hover:bg-white/90"
                    style={{ fontFamily: 'Arial, sans-serif' }}
                  >
                    TAG IMAGE
                  </button>
                  
                  <button
                    onClick={() => {
                      setAsPrimary();
                      setShowSidebar(false);
                    }}
                    disabled={imageMetadata?.is_primary}
                    className={`w-full py-3 px-4 border-2 text-[10px] font-bold ${
                      imageMetadata?.is_primary
                        ? 'bg-green-700 border-green-400 text-white'
                        : 'bg-[#1a1a1a] border-white/30 text-white hover:bg-white/10'
                    }`}
                    style={{ fontFamily: 'Arial, sans-serif' }}
                  >
                    {imageMetadata?.is_primary ? '✓ PRIMARY IMAGE' : 'SET AS PRIMARY'}
                  </button>
                  
                  <button 
                    onClick={() => {
                      const newRotation = (rotation + 90) % 360;
                      setRotation(newRotation);
                      saveRotation(newRotation);
                    }}
                    className="w-full py-3 px-4 bg-[#1a1a1a] border-2 border-white/30 text-white text-[10px] font-bold hover:bg-white/10"
                    style={{ fontFamily: 'Arial, sans-serif' }}
                  >
                    ROTATE 90°
                  </button>
                  
                  <button 
                    onClick={toggleSensitive}
                    className={`w-full py-3 px-4 border-2 text-[10px] font-bold ${
                      isSensitive 
                        ? 'bg-yellow-600 text-black border-yellow-400' 
                        : 'bg-[#1a1a1a] border-white/30 text-white hover:bg-white/10'
                    }`}
                    style={{ fontFamily: 'Arial, sans-serif' }}
                  >
                    {isSensitive ? '✓ SENSITIVE (BLURRED)' : 'MARK AS SENSITIVE'}
                  </button>

                  <button
                    onClick={async () => {
                      if (!imageId) return;
                      const { error } = await supabase
                        .from('vehicle_images')
                        .update({ image_vehicle_match_status: 'unrelated' })
                        .eq('id', imageId);
                      if (error) {
                        toast.error('Failed to flag image');
                      } else {
                        toast.success('Image flagged as junk — hidden from gallery');
                        onClose();
                      }
                    }}
                    className="w-full py-3 px-4 bg-[#1a1a1a] border-2 border-yellow-500/50 text-yellow-400 text-[10px] font-bold hover:bg-yellow-900/20"
                    style={{ fontFamily: 'Arial, sans-serif' }}
                  >
                    FLAG AS JUNK
                  </button>

                  {/* Medium type selector */}
                  <div className="border-t-2 border-white/20 pt-3 mt-3">
                    <div
                      style={{
                        fontSize: '9px',
                        fontWeight: 700,
                        fontFamily: 'Arial, sans-serif',
                        color: 'rgba(255,255,255,0.5)',
                        letterSpacing: '0.5px',
                        marginBottom: '8px',
                      }}
                    >
                      MEDIUM
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {(['photograph', 'render', 'drawing', 'screenshot'] as const).map((m) => {
                        const labels: Record<string, string> = { photograph: 'PHOTO', render: 'RENDER', drawing: 'DRAWING', screenshot: 'SCREEN' };
                        const active = (imageMetadata?.image_medium || 'photograph') === m;
                        return (
                          <button
                            key={m}
                            onClick={() => { updateImageMedium(m); }}
                            className={`py-2 border-2 text-[9px] font-bold ${
                              active
                                ? 'bg-white text-black border-white'
                                : 'bg-[#1a1a1a] border-white/30 text-white hover:bg-white/10'
                            }`}
                            style={{ fontFamily: 'Arial, sans-serif' }}
                          >
                            {labels[m]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border-t-2 border-white/20 pt-3 mt-3">
                    <button
                      onClick={() => {
                        if (confirm('Delete this image? This cannot be undone.')) {
                          deleteImage();
                        }
                      }}
                      className="w-full py-3 px-4 bg-red-600 border-2 border-red-400 text-white text-[10px] font-bold hover:bg-red-700"
                      style={{ fontFamily: 'Arial, sans-serif' }}
                    >
                      DELETE IMAGE
                    </button>
                  </div>
                </div>
              )}

              {/* Info Tab — Reference-catalog-style expanded data */}
              {activeTab === 'info' && (
                <div className="space-y-0" style={{ fontSize: '11px' }}>
                  <ImageExpandedData
                    imageRecord={imageRecord}
                    imageMetadata={imageMetadata}
                    attribution={attribution}
                    resolvedAngle={angleData}
                    tags={tags}
                    commentsCount={comments.length}
                    dark
                  />
                </div>
              )}


              {/* Comments Tab */}
              {activeTab === 'comments' && (
                <div className="flex flex-col h-full">
                  <div className="flex-1 space-y-4 mb-4">
                    {comments.length === 0 ? (
                      <div className="text-center text-gray-500 mt-10">No comments yet</div>
                    ) : (
                      comments.map(c => {
                        const commenterId = c.user_id || c.user?.id;
                        const isOwner = vehicleOwnerId && commenterId === vehicleOwnerId;
                        const isPreviousOwner = commenterId && previousOwners.has(commenterId);
                        
                        return (
                          <div key={c.id} className="bg-white/5 p-3">
                            <div className="flex justify-between items-center mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-blue-400">{c.user?.full_name || 'Unknown'}</span>
                                {isOwner && (
                                  <span className="text-[9px] px-1.5 py-0.5 bg-green-900/50 text-green-300 border border-green-700">
                                    OWNER
                                  </span>
                                )}
                                {isPreviousOwner && !isOwner && (
                                  <span className="text-[9px] px-1.5 py-0.5 bg-yellow-900/50 text-yellow-300 border border-yellow-700">
                                    PREVIOUS OWNER
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-gray-500">{new Date(c.created_at).toLocaleDateString()}</span>
                            </div>
                            <p className="text-sm text-gray-200">{c.comment_text || c.comment}</p>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="mt-auto pt-4 border-t-2 border-white/20">
                    <input
                      className="w-full bg-[#1a1a1a] border-2 border-white/30 text-white text-[10px] p-3 mb-3 transition-all duration-150 focus:border-white focus:outline-none focus: -[0_0_0_3px_rgba(255,255,255,0.1)] placeholder:text-white/40"
                      style={{ fontFamily: 'Arial, sans-serif' }}
                      placeholder="Add a comment..."
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addComment()}
                    />
                    <button 
                      onClick={addComment}
                      disabled={!newComment.trim()}
                      className="w-full py-2.5 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-wide hover:bg-white/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 hover:translate-y-[-2px] hover: -[0_0_0_3px_rgba(255,255,255,0.2)]"
                      style={{ fontFamily: 'Arial, sans-serif' }}
                    >
                      POST COMMENT
                    </button>
                  </div>
        </div>
      )}

              {/* Tags Tab */}
              {activeTab === 'tags' && (
                <div className="space-y-2">
                  {tags.length === 0 ? (
                    <div className="text-center text-gray-500 mt-10">No tags yet. Click "+ TAG" to add one.</div>
                  ) : (
                    tags.map(tag => (
                      <div key={tag.id} className="flex justify-between items-center bg-white/5 p-2 hover:bg-white/10 cursor-pointer">
                        <span className="text-sm">{tag.tag_name}</span>
                        <span className={`text-[10px] px-2 py-0.5  ${tag.verified ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
                          {tag.verified ? 'Verified' : 'AI'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {spatialPopupOpen && selectedSpatialTag && (
        <SpatialPartPopup
          part={{
            name: selectedSpatialTag.tag_name,
            oem_part_number: selectedSpatialTag.oem_part_number,
            suppliers: selectedSpatialTag.suppliers || [],
            x: selectedSpatialTag.x_position || 50,
            y: selectedSpatialTag.y_position || 50
          }}
          onClose={() => setSpatialPopupOpen(false)}
          onOrder={handleSpatialOrder}
        />
      )}

      {clickablePartModalOpen && selectedPartName && vehicleId && (
        <ClickablePartModal
          isOpen={clickablePartModalOpen}
          onClose={() => { setClickablePartModalOpen(false); setSelectedPartName(null); }}
          partName={selectedPartName}
          vehicleId={vehicleId}
          vehicleYMM={vehicleYMM}
          imageId={imageId}
          userId={session?.user?.id}
        />
      )}

      {/* Mobile Info Panel (Swipe Up) - Only on mobile */}
      <div className="block sm:hidden">
        {showInfoPanel && (
          <ImageInfoPanel
            imageMetadata={imageMetadata}
            attribution={attribution}
            tags={tags}
            comments={comments}
            imageRecord={imageRecord}
            canEdit={canEdit}
            onTag={() => setShowTagger(true)}
            onSetPrimary={setAsPrimary}
            onRotate={() => {
              const newRotation = (rotation + 90) % 360;
              setRotation(newRotation);
              saveRotation(newRotation);
            }}
            onToggleSensitive={toggleSensitive}
            onDelete={deleteImage}
            onClose={() => setShowInfoPanel(false)}
            session={session}
          />
        )}
      </div>

      {/* Claim Identity Wizard (minimal) */}
      {claimDialogOpen && claimTarget && (
        <div
          className="fixed inset-0"
          style={{ zIndex: 10006, backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => {
            if (claimSubmitting) return;
            setClaimDialogOpen(false);
            setClaimTarget(null);
            setClaimError(null);
          }}
        >
          <div
            className="bg-[#111] border-2 border-white/20"
            style={{
              width: 'min(520px, calc(100vw - 24px))',
              margin: '80px auto',
              padding: '16px',
              color: 'white',
              fontFamily: 'Arial, sans-serif'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                Claim identity
              </div>
              <button
                onClick={() => {
                  if (claimSubmitting) return;
                  setClaimDialogOpen(false);
                  setClaimTarget(null);
                  setClaimError(null);
                }}
                style={{
                  fontSize: '10px',
                  fontWeight: 'bold',
                  background: 'transparent',
                  color: 'rgba(255,255,255,0.7)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  padding: '4px 8px',
                  cursor: 'pointer',
                  textTransform: 'uppercase'
                }}
              >
                Close
              </button>
            </div>

            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.7)', marginBottom: '12px' }}>
              You’re claiming <span style={{ color: 'white', fontWeight: 700 }}>@{claimTarget.handle}</span> on{' '}
              <span style={{ color: 'white', fontWeight: 700 }}>{claimTarget.platform}</span>. Provide proof so we can link it to your N‑Zero profile.
            </div>

            <div style={{ display: 'grid', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', textTransform: 'uppercase' }}>
                  Proof type
                </div>
                <select
                  value={claimProofType}
                  onChange={(e) => setClaimProofType(e.target.value as any)}
                  disabled={claimSubmitting}
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontSize: '10px',
                    backgroundColor: '#0a0a0a',
                    color: 'white',
                    border: '1px solid rgba(255,255,255,0.2)'
                  }}
                >
                  <option value="profile_link">Profile link</option>
                  <option value="screenshot">Screenshot</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', textTransform: 'uppercase' }}>
                  Proof URL (optional)
                </div>
                <input
                  value={claimProofUrl}
                  onChange={(e) => setClaimProofUrl(e.target.value)}
                  disabled={claimSubmitting}
                  placeholder="https://..."
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontSize: '10px',
                    backgroundColor: '#0a0a0a',
                    color: 'white',
                    border: '1px solid rgba(255,255,255,0.2)'
                  }}
                />
              </div>

              <div>
                <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', textTransform: 'uppercase' }}>
                  Notes
                </div>
                <textarea
                  value={claimNotes}
                  onChange={(e) => setClaimNotes(e.target.value)}
                  disabled={claimSubmitting}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontSize: '10px',
                    backgroundColor: '#0a0a0a',
                    color: 'white',
                    border: '1px solid rgba(255,255,255,0.2)',
                    resize: 'vertical'
                  }}
                />
              </div>

              {claimError && (
                <div style={{ fontSize: '9px', color: 'var(--error)' }}>
                  {claimError}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    if (claimSubmitting) return;
                    setClaimDialogOpen(false);
                    setClaimTarget(null);
                    setClaimError(null);
                  }}
                  disabled={claimSubmitting}
                  style={{
                    padding: '8px 10px',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    backgroundColor: 'transparent',
                    color: 'rgba(255,255,255,0.7)',
                    border: '1px solid rgba(255,255,255,0.25)',
                    cursor: claimSubmitting ? 'not-allowed' : 'pointer',
                    textTransform: 'uppercase'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={submitClaim}
                  disabled={claimSubmitting}
                  style={{
                    padding: '8px 10px',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    backgroundColor: claimSubmitting ? 'var(--text-disabled)' : 'var(--surface-elevated)',
                    color: claimSubmitting ? 'rgba(255,255,255,0.6)' : 'var(--text)',
                    border: '1px solid rgba(255,255,255,0.25)',
                    cursor: claimSubmitting ? 'not-allowed' : 'pointer',
                    textTransform: 'uppercase'
                  }}
                >
                  {claimSubmitting ? 'Submitting…' : 'Submit claim'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default ImageLightbox;
