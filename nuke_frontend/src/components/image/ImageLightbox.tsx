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
import '../../design-system.css';

interface ImageLightboxProps {
  imageUrl: string;
  imageId?: string;
  timelineEventId?: string;
  vehicleId?: string;
  vehicleYMM?: { year?: number; make?: string; model?: string };
  isOpen: boolean;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  canEdit?: boolean;
  title?: string;
  description?: string;
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
  let borderColor = '#000000';
  let bgColor = '#ffffff';
  let borderStyle = 'solid';
  
  if (isAutoTag) {
    if (isVerified) {
      bgColor = '#22c55e'; // Green - verified auto-tag
      borderColor = '#16a34a';
    } else {
      bgColor = '#eab308'; // Yellow - unverified auto-tag
      borderColor = '#ca8a04';
      borderStyle = 'dashed';
    }
  } else if (isShoppable) {
    bgColor = '#00ff00'; // Green - shoppable
  }
  
  if (isLinkedVehicle) {
    borderColor = '#3b82f6'; // Blue border for linked vehicles
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
        background: isHovered ? bgColor : `${bgColor}aa`,
        border: `3px ${borderStyle} ${borderColor}`,
        borderRadius: '4px',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
        transition: 'all 0.12s ease',
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
          padding: '6px 10px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 'bold',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          border: `2px solid ${borderColor}`
        }}>
          <div>{tag.tag_text || tag.tag_name}</div>
          {isAutoTag && (
            <div style={{ fontSize: '9px', color: '#888', marginTop: '2px' }}>
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
  vehicleYMM,
  isOpen,
  onClose,
  onNext,
  onPrev,
  canEdit = true,
  title,
  description
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
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  
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
        if (canEdit) {
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
      // Determine gesture type: horizontal (navigate) or vertical (info panel)
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        // Horizontal swipe - navigate (increased threshold to prevent accidental navigation)
        if (Math.abs(deltaX) > 120) {
          if (deltaX > 0 && onPrev) {
            onPrev();
          } else if (deltaX < 0 && onNext) {
            onNext();
          }
        }
      } else {
        // Vertical swipe - info panel
        if (Math.abs(deltaY) > 50) {
          if (deltaY < -50) {
            // Swipe up - show info panel
            setShowInfoPanel(true);
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

  // Set as primary image
  const setAsPrimary = useCallback(async () => {
    if (!imageId || !vehicleId) return;
    
    try {
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
    } catch (err) {
      console.error('Error setting as primary:', err);
    }
  }, [imageId, vehicleId, imageMetadata]);

  // Delete image
  const deleteImage = useCallback(async () => {
    if (!imageId) return;
    
    const confirmed = window.confirm('Delete this image? This action cannot be undone.');
    if (!confirmed) return;
    
    try {
      const { error } = await supabase
        .from('vehicle_images')
        .delete()
        .eq('id', imageId);
      
      if (error) {
        console.error('Error deleting image:', error);
        alert('Failed to delete image');
        return;
      }
      
      // Emit event to refresh gallery
      window.dispatchEvent(new CustomEvent('vehicle_images_updated', { 
        detail: { vehicleId } 
      } as any));
      
      // Close lightbox
      onClose();
    } catch (err) {
      console.error('Error deleting image:', err);
      alert('Failed to delete image');
    }
  }, [imageId, vehicleId, onClose]);

  // Get session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  // Load Metadata & Attribution
  const loadImageMetadata = useCallback(async () => {
    if (!imageId || !vehicleId) return;

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
      
      // 3. Load uploader profile (person who ran the import) - only if not BAT
      // For imported images (Craigslist, etc.), user_id is the importer, not the photographer
      // Only show uploader if it's a direct upload (not imported/scraped)
      if (!organizationInfo && imgData.user_id && imgData.source !== 'scraper' && imgData.source !== 'craigslist_scrape' && imgData.source !== 'bat_listing') {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, full_name, username')
          .eq('id', imgData.user_id)
          .single();
        
        uploaderInfo = profileData;
      }
      
      setAttribution({
        photographer: photographerInfo,
        uploader: uploaderInfo || null,
        organization: organizationInfo,
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
          border: 2px solid #fff;
          z-index: 10001;
          font-size: 12px;
          max-width: 300px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        const relationshipText = organizationInfo.relationshipLabel 
          ? `${organizationInfo.relationshipLabel} • ${organizationInfo.name}`
          : organizationInfo.name;
        toast.innerHTML = `
          <div style="font-weight: bold; margin-bottom: 4px;">Source</div>
          <div style="font-size: 11px; margin-bottom: 2px;">${organizationInfo.name}</div>
          ${organizationInfo.relationshipLabel ? `<div style="font-size: 10px; color: #ccc;">${organizationInfo.relationshipLabel}</div>` : ''}
          <button onclick="this.parentElement.remove()" style="position: absolute; top: 4px; right: 4px; background: transparent; color: #fff; border: none; padding: 2px 6px; font-size: 14px; cursor: pointer; font-weight: bold;">×</button>
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
          if (toast.parentElement) {
            toast.remove();
          }
        }, 5000);
      }
    }

    // AI Angle - handle gracefully if table doesn't exist or query fails
    try {
      const { data: angle } = await supabase
        .from('ai_angle_classifications_audit')
        .select('*')
        .eq('image_id', imageId)
        .maybeSingle();
      setAngleData(angle || null);
    } catch (err) {
      // Table might not exist or RLS might block - set to null
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
  }, [onClose, onPrev, onNext, showTagger]);

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
                color: 'rgba(255,255,255,0.8)',
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
            
            {title && (
              <span 
                style={{ 
                  fontSize: '8px', 
                  whiteSpace: 'nowrap', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis', 
                  minWidth: 0,
                  flex: '1 1 auto',
                  color: 'rgba(255,255,255,0.6)',
                  fontWeight: 500,
                  textAlign: 'center'
                }}
              >
                {title}
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
          <span className="text-[9px] text-white/50 font-medium tracking-wide uppercase">
            {description || title || 'IMAGE'}
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
          
          {canEdit && (
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
          
          <button 
            onClick={async () => {
              if (!imageUrl || !vehicleId) return;
              const result = await triggerAIAnalysis(imageUrl, timelineEventId, vehicleId);
              if (result.success) {
                setTimeout(() => {
                  loadTags();
                  loadImageMetadata();
                }, 2000);
              }
            }}
            disabled={analyzing || !imageUrl || !vehicleId}
            className={`px-3 py-1.5 border-2 text-[9px] font-bold uppercase tracking-wide transition-all duration-150 ${
              analyzing 
                ? 'bg-[#2a2a2a] text-white/40 border-white/10 cursor-not-allowed' 
                : 'bg-transparent border-white/30 text-white hover:border-white hover:bg-white/10'
            }`}
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            {analyzing ? 'AI...' : 'AI'}
          </button>
          
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
      {showQuickActions && canEdit && (
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
            style={{ backgroundColor: imageMetadata?.is_primary ? '#16a34a' : 'rgba(255,255,255,0.1)' }}
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
            style={{ backgroundColor: isSensitive ? '#eab308' : 'rgba(255,255,255,0.1)', color: isSensitive ? 'black' : 'white' }}
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
      {showContextMenu && canEdit && (
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
              width: 'auto',
              height: 'auto',
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
                  window.open(`/vehicles/${(tag as any).linked_vehicle_id}`, '_blank');
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

        {/* Sidebar - Cursor Style - Fixed width, doesn't shrink */}
        {showSidebar && (
          <div 
            ref={sidebarRef}
            className="bg-[#111] border-l-2 border-white/20 flex flex-col overflow-hidden"
            style={{
              width: '256px',
              flexShrink: 0,
              minWidth: '256px',
              maxWidth: '256px',
              minHeight: 0
            }}
          >
            {/* Tabs - Cursor Style */}
            <div className="flex border-b-2 border-white/20">
              {canEdit && (
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
              {activeTab === 'actions' && canEdit && (
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

              {/* Info Tab */}
              {activeTab === 'info' && (
                <div className="space-y-4" style={{ fontSize: '8pt' }}>
                  {/* Date/Time */}
                  {imageMetadata && (
                    <div>
                      <h4 style={{ fontSize: '7pt', fontWeight: 'bold', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: '4px' }}>Date & Time</h4>
                      <div style={{ fontSize: '8pt', color: '#fff' }}>
                        {(() => {
                          const date = imageMetadata.taken_at || imageMetadata.created_at;
                          if (!date) return 'Unknown';
                          const d = new Date(date);
                          const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                          const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                          const now = new Date();
                          const diffMs = now.getTime() - d.getTime();
                          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                          const relative = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Yesterday' : `${diffDays} days ago`;
                          return `${formatted} • ${time} • ${relative}`;
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Camera & EXIF */}
                  {imageMetadata?.exif_data?.camera && (
                    <div>
                      <h4 style={{ fontSize: '7pt', fontWeight: 'bold', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: '4px' }}>Camera & EXIF</h4>
                      <div style={{ fontSize: '8pt', color: '#fff' }}>
                        <div>
                          {typeof imageMetadata.exif_data.camera === 'string' 
                            ? imageMetadata.exif_data.camera 
                            : `${imageMetadata.exif_data.camera.make || ''} ${imageMetadata.exif_data.camera.model || ''}`.trim() || 'Camera'
                          }
                        </div>
                        {(() => {
                          const exif = imageMetadata.exif_data;
                          const parts = [];
                          if (exif.focalLength || exif.technical?.focalLength) {
                            const fl = exif.focalLength || exif.technical?.focalLength;
                            const flNum = typeof fl === 'number' ? fl : parseFloat(String(fl).replace('mm', ''));
                            if (!isNaN(flNum) && flNum > 0) {
                              parts.push(`${flNum.toFixed(1)}mm`);
                            }
                          }
                          if (exif.fNumber || exif.technical?.fNumber) {
                            const fn = exif.fNumber || exif.technical?.fNumber;
                            parts.push(`f/${typeof fn === 'number' ? fn.toFixed(1) : fn}`);
                          }
                          if (exif.exposureTime || exif.technical?.exposureTime) {
                            const et = exif.exposureTime || exif.technical?.exposureTime;
                            if (typeof et === 'number' && et < 1) {
                              parts.push(`1/${Math.round(1/et)}s`);
                            } else {
                              parts.push(`${et}s`);
                            }
                          }
                          if (exif.iso || exif.technical?.iso) {
                            parts.push(`ISO ${exif.iso || exif.technical?.iso}`);
                          }
                          if (parts.length > 0) {
                            return <div style={{ fontSize: '7pt', color: 'rgba(255,255,255,0.5)' }}>{parts.join(' • ')}</div>;
                          }
                          return null;
                        })()}
                        {imageMetadata.exif_data.dimensions && (
                          <div style={{ fontSize: '7pt', color: 'rgba(255,255,255,0.5)' }}>
                            {imageMetadata.exif_data.dimensions.width} × {imageMetadata.exif_data.dimensions.height}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Location */}
                  {imageMetadata?.exif_data?.location && (imageMetadata.exif_data.location.city || imageMetadata.exif_data.location.latitude) && (
                    <div>
                      <h4 style={{ fontSize: '7pt', fontWeight: 'bold', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: '4px' }}>Location</h4>
                      <div style={{ fontSize: '8pt', color: '#fff' }}>
                        {imageMetadata.exif_data.location.city && imageMetadata.exif_data.location.state
                          ? `${imageMetadata.exif_data.location.city}, ${imageMetadata.exif_data.location.state}`
                          : imageMetadata.exif_data.location.latitude
                            ? `${imageMetadata.exif_data.location.latitude.toFixed(4)}, ${imageMetadata.exif_data.location.longitude.toFixed(4)}`
                            : 'Unknown'
                        }
                      </div>
                    </div>
                  )}

                  {/* Stats */}
                  {(imageMetadata?.view_count || imageMetadata?.comment_count || comments.length > 0) && (
                    <div>
                      <h4 style={{ fontSize: '7pt', fontWeight: 'bold', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: '4px' }}>Stats</h4>
                      <div style={{ fontSize: '8pt', color: '#fff' }}>
                        {[
                          imageMetadata?.view_count ? `${imageMetadata.view_count} ${imageMetadata.view_count === 1 ? 'view' : 'views'}` : null,
                          comments.length > 0 ? `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}` : null
                        ].filter(Boolean).join(' • ') || 'No stats'}
                      </div>
                    </div>
                  )}

                  {/* Tags Preview */}
                  {tags.length > 0 && (
                    <div>
                      <h4 style={{ fontSize: '7pt', fontWeight: 'bold', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: '4px' }}>Tags</h4>
                      <div style={{ fontSize: '8pt', color: '#fff' }}>
                        {tags.slice(0, 5).map(tag => tag.tag_text || tag.tag_name || tag.text || 'tag').filter(Boolean).join(' • ')}
                        {tags.length > 5 && <span style={{ color: 'rgba(255,255,255,0.5)' }}> • +{tags.length - 5} more</span>}
                      </div>
                    </div>
                  )}

                  {attribution && (
                    <div>
                      <h4 style={{ fontSize: '7pt', fontWeight: 'bold', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: '4px' }}>Source</h4>
                      <div style={{ fontSize: '8pt', color: '#fff' }}>
                        {/* Source URL (clickable link to original) */}
                        {(() => {
                          const sourceUrl = imageMetadata?.exif_data?.source_url || 
                                          imageMetadata?.exif_data?.discovery_url ||
                                          imageMetadata?.source_url;
                          const sourceName = attribution.source === 'craigslist_scrape' ? 'Craigslist' :
                                           attribution.source === 'scraper' ? 'Craigslist' :
                                           attribution.source === 'bat_listing' ? 'Bring a Trailer' :
                                           attribution.source || 'Unknown';
                          
                          // Get Craigslist URL for favicon if it's a Craigslist source
                          const craigslistUrl = (attribution.source === 'craigslist_scrape' || attribution.source === 'scraper') 
                            ? (sourceUrl || 'https://craigslist.org')
                            : sourceUrl;
                          
                          return sourceUrl ? (
                            <div style={{ marginBottom: '6px' }}>
                              <a 
                                href={sourceUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                style={{ 
                                  color: '#4A9EFF', 
                                  textDecoration: 'underline',
                                  wordBreak: 'break-all',
                                  fontSize: '7pt',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px'
                                }}
                              >
                                <FaviconIcon url={craigslistUrl} matchTextSize={true} textSize={7} />
                                {sourceName}
                              </a>
                            </div>
                          ) : null;
                        })()}
                        
                        {/* Triggered by (who ran the extraction) */}
                        {attribution.uploader && (attribution.source === 'craigslist_scrape' || attribution.source === 'scraper') && (
                          <div style={{ marginBottom: '6px' }}>
                            <div style={{ fontSize: '7pt', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>Triggered by:</div>
                            <button
                              onClick={() => {
                                const profileCard = document.createElement('div');
                                profileCard.className = 'profile-toast';
                                profileCard.innerHTML = `
                                  <div style="position: fixed; top: 20px; right: 20px; z-index: 10000; background: #000; border: 2px solid #fff; padding: 12px; max-width: 280px; font-size: 8pt;">
                                    <div style="color: #fff; font-weight: bold; margin-bottom: 6px;">
                                      ${attribution.uploader.full_name || attribution.uploader.username || 'User'}
                                    </div>
                                    <div style="color: #bbb; font-size: 7pt; margin-bottom: 6px;">
                                      @${attribution.uploader.username || 'user'}
                                    </div>
                                    <a href="/profile/${attribution.uploader.id}" style="color: #4A9EFF; font-size: 7pt; text-decoration: underline;">
                                      View Profile →
                                    </a>
                                    <button onclick="this.parentElement.remove()" style="position: absolute; top: 4px; right: 4px; background: #fff; color: #000; border: none; padding: 2px 6px; font-size: 8pt; cursor: pointer;">
                                      ✕
                                    </button>
                                  </div>
                                `;
                                document.body.appendChild(profileCard);
                                setTimeout(() => profileCard.remove(), 5000);
                              }}
                              style={{ 
                                color: '#4A9EFF', 
                                textDecoration: 'underline',
                                cursor: 'pointer',
                                fontSize: '7pt',
                                background: 'none',
                                border: 'none',
                                padding: 0
                              }}
                            >
                              {attribution.uploader.full_name || attribution.uploader.username}
                            </button>
                          </div>
                        )}
                        
                        {/* Action type */}
                        {attribution.source && (() => {
                          // Try multiple sources for the URL
                          const sourceUrl = imageMetadata?.exif_data?.source_url || 
                                          imageMetadata?.exif_data?.discovery_url ||
                                          imageMetadata?.source_url ||
                                          (imageMetadata?.exif_data?.metadata?.discovery_url) ||
                                          (imageMetadata?.exif_data?.metadata?.listing_url);
                          
                          // For Craigslist sources, always show a clickable badge with favicon
                          // Use the source URL if available, otherwise use generic Craigslist URL
                          const isCraigslistSource = attribution.source === 'craigslist_scrape' || attribution.source === 'scraper';
                          const actionUrl = isCraigslistSource 
                            ? (sourceUrl || 'https://craigslist.org')
                            : sourceUrl;
                          
                          // Format action label - replace "scrape" with "automation v.0"
                          const formatActionLabel = (source: string) => {
                            if (source === 'craigslist_scrape' || source === 'scraper') {
                              return 'automation v.0';
                            }
                            return source.replace(/_/g, ' ');
                          };
                          
                          return (
                            <div style={{ marginBottom: '6px' }}>
                              <div style={{ fontSize: '7pt', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>Action:</div>
                              {actionUrl ? (
                                <a
                                  href={actionUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '7pt',
                                    color: 'var(--text-muted)',
                                    padding: '1px 6px',
                                    background: 'rgba(255,255,255,0.05)',
                                    borderRadius: '3px',
                                    whiteSpace: 'nowrap',
                                    textDecoration: 'none',
                                    textTransform: 'uppercase',
                                    cursor: 'pointer'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                                  }}
                                >
                                  <FaviconIcon url={actionUrl} matchTextSize={true} textSize={7} />
                                  {formatActionLabel(attribution.source)}
                                </a>
                              ) : (
                                <div style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontSize: '7pt',
                                  color: 'var(--text-muted)',
                                  padding: '1px 6px',
                                  background: 'rgba(255,255,255,0.05)',
                                  borderRadius: '3px',
                                  whiteSpace: 'nowrap',
                                  textTransform: 'uppercase'
                                }}>
                                  {isCraigslistSource ? (
                                    <>
                                      <FaviconIcon url="https://craigslist.org" matchTextSize={true} textSize={7} />
                                      {formatActionLabel(attribution.source)}
                                    </>
                                  ) : (
                                    formatActionLabel(attribution.source)
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        
                        {/* Photographer (if known) */}
                        {attribution.photographer && (
                          <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <div style={{ fontSize: '7pt', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>Photographer:</div>
                            <div style={{ fontSize: '7pt' }}>
                              {attribution.photographer.name}
                              {attribution.photographer.camera && (
                                <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: '4px', fontSize: '6pt' }}>
                                  ({attribution.photographer.camera})
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* AI Analysis Section - Data Inspector View */}
                  {(() => {
                    const tier1Analysis = imageMetadata?.ai_scan_metadata?.tier_1_analysis;
                    const appraiser = imageMetadata?.ai_scan_metadata?.appraiser;
                    const hasAnalysis = tier1Analysis || appraiser || angleData?.primary_label;
                    
                    // Only show section if we have analysis OR if user can trigger it
                    if (!hasAnalysis && (!vehicleId || !imageUrl)) {
                      return null;
                    }

                    // Helper to render a data row
                    const DataRow = ({ label, value, mono = false }: { label: string; value: any; mono?: boolean }) => {
                      if (value === null || value === undefined || value === '') return null;
                      const displayValue = typeof value === 'boolean' ? (value ? 'true' : 'false') : 
                                          Array.isArray(value) ? value.join(', ') :
                                          typeof value === 'object' ? JSON.stringify(value) : String(value);
                      return (
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'flex-start',
                          padding: '2px 0',
                          borderBottom: '1px solid rgba(255,255,255,0.05)'
                        }}>
                          <span style={{ 
                            fontSize: '7pt', 
                            color: 'rgba(255,255,255,0.5)',
                            minWidth: '100px',
                            flexShrink: 0
                          }}>{label}</span>
                          <span style={{ 
                            fontSize: '7pt', 
                            color: mono ? '#4ade80' : 'white',
                            fontFamily: mono ? 'monospace' : 'inherit',
                            textAlign: 'right',
                            wordBreak: 'break-word',
                            maxWidth: '180px'
                          }}>{displayValue}</span>
                        </div>
                      );
                    };
                    
                    return (
                      <div className="mb-4">
                        <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">AI Analysis</h4>
                        
                        {/* Analyze button if no analysis */}
                        {!hasAnalysis && vehicleId && imageUrl && (
                          <div style={{ marginBottom: '8px' }}>
                            <button
                              onClick={async () => {
                                if (!vehicleId || !imageUrl) return;
                                setAnalyzingImage(true);
                                try {
                                  const { data: { user } } = await supabase.auth.getUser();
                                  const { data, error } = await supabase.functions.invoke('analyze-image', {
                                    body: { image_url: imageUrl, image_id: imageId || null, vehicle_id: vehicleId, timeline_event_id: null, user_id: user?.id || null }
                                  });
                                  if (error) {
                                    alert(`Analysis failed: ${error.message}`);
                                  } else {
                                    if (typeof window !== 'undefined') {
                                      window.dispatchEvent(new CustomEvent('image_processing_complete', {
                                        detail: { imageId, result: data, vehicleId }
                                      }));
                                    }
                                    setTimeout(() => { loadImageMetadata(); loadTags(); }, 5000);
                                  }
                                } catch (err) {
                                  alert(`Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                                } finally {
                                  setAnalyzingImage(false);
                                }
                              }}
                              disabled={analyzingImage}
                              style={{
                                width: '100%',
                                padding: '8px',
                                fontSize: '8pt',
                                fontWeight: 'bold',
                                backgroundColor: analyzingImage ? '#4b5563' : '#ca8a04',
                                color: 'white',
                                border: 'none',
                                cursor: analyzingImage ? 'not-allowed' : 'pointer'
                              }}
                            >
                              {analyzingImage ? 'ANALYZING...' : 'ANALYZE NOW'}
                            </button>
                          </div>
                        )}

                        {/* DB Columns Section */}
                        {imageMetadata && (
                          <div style={{ marginBottom: '12px' }}>
                            <div style={{ 
                              fontSize: '6pt', 
                              color: 'rgba(255,255,255,0.3)', 
                              textTransform: 'uppercase',
                              marginBottom: '4px',
                              letterSpacing: '0.5px'
                            }}>DB COLUMNS</div>
                            <div style={{ 
                              background: 'rgba(0,0,0,0.3)', 
                              padding: '6px 8px',
                              border: '1px solid rgba(255,255,255,0.1)'
                            }}>
                              <DataRow label="image_category" value={imageMetadata.image_category} mono />
                              <DataRow label="category" value={imageMetadata.category} mono />
                              <DataRow label="source" value={imageMetadata.source} mono />
                              <DataRow label="taken_at" value={imageMetadata.taken_at ? new Date(imageMetadata.taken_at).toISOString() : null} mono />
                              <DataRow label="is_primary" value={imageMetadata.is_primary} mono />
                              <DataRow label="angle" value={imageMetadata.angle} mono />
                            </div>
                          </div>
                        )}

                        {/* Tier 1 Analysis Section */}
                        {tier1Analysis && (
                          <div style={{ marginBottom: '12px' }}>
                            <div style={{ 
                              fontSize: '6pt', 
                              color: 'rgba(255,255,255,0.3)', 
                              textTransform: 'uppercase',
                              marginBottom: '4px',
                              letterSpacing: '0.5px'
                            }}>TIER 1 ANALYSIS</div>
                            <div style={{ 
                              background: 'rgba(0,0,0,0.3)', 
                              padding: '6px 8px',
                              border: '1px solid rgba(255,255,255,0.1)'
                            }}>
                              <DataRow label="angle" value={tier1Analysis.angle} mono />
                              <DataRow label="category" value={tier1Analysis.category} mono />
                              <DataRow label="condition_glance" value={tier1Analysis.condition_glance} mono />
                              <DataRow label="components_visible" value={tier1Analysis.components_visible} mono />
                            </div>
                          </div>
                        )}

                        {/* Image Quality Section */}
                        {tier1Analysis?.image_quality && (
                          <div style={{ marginBottom: '12px' }}>
                            <div style={{ 
                              fontSize: '6pt', 
                              color: 'rgba(255,255,255,0.3)', 
                              textTransform: 'uppercase',
                              marginBottom: '4px',
                              letterSpacing: '0.5px'
                            }}>IMAGE QUALITY</div>
                            <div style={{ 
                              background: 'rgba(0,0,0,0.3)', 
                              padding: '6px 8px',
                              border: '1px solid rgba(255,255,255,0.1)'
                            }}>
                              <DataRow label="overall_score" value={`${tier1Analysis.image_quality.overall_score}/10`} mono />
                              <DataRow label="focus" value={tier1Analysis.image_quality.focus} mono />
                              <DataRow label="lighting" value={tier1Analysis.image_quality.lighting} mono />
                              <DataRow label="resolution" value={tier1Analysis.image_quality.estimated_resolution} mono />
                              <DataRow label="suitable_for_expert" value={tier1Analysis.image_quality.suitable_for_expert} mono />
                              <DataRow label="sufficient_for_detail" value={tier1Analysis.image_quality.sufficient_for_detail} mono />
                            </div>
                          </div>
                        )}

                        {/* Basic Observations - Full Text */}
                        {tier1Analysis?.basic_observations && (
                          <div style={{ marginBottom: '12px' }}>
                            <div style={{ 
                              fontSize: '6pt', 
                              color: 'rgba(255,255,255,0.3)', 
                              textTransform: 'uppercase',
                              marginBottom: '4px',
                              letterSpacing: '0.5px'
                            }}>BASIC OBSERVATIONS</div>
                            <div style={{ 
                              background: 'rgba(0,0,0,0.3)', 
                              padding: '8px',
                              border: '1px solid rgba(255,255,255,0.1)',
                              fontSize: '8pt',
                              color: 'white',
                              lineHeight: '1.4'
                            }}>
                              {tier1Analysis.basic_observations}
                            </div>
                          </div>
                        )}

                        {/* Processing Metadata */}
                        {imageMetadata?.ai_scan_metadata && (
                          <div style={{ marginBottom: '12px' }}>
                            <div style={{ 
                              fontSize: '6pt', 
                              color: 'rgba(255,255,255,0.3)', 
                              textTransform: 'uppercase',
                              marginBottom: '4px',
                              letterSpacing: '0.5px'
                            }}>PROCESSING</div>
                            <div style={{ 
                              background: 'rgba(0,0,0,0.3)', 
                              padding: '6px 8px',
                              border: '1px solid rgba(255,255,255,0.1)'
                            }}>
                              <DataRow label="scanned_at" value={imageMetadata.ai_scan_metadata.scanned_at} mono />
                              <DataRow label="tier_reached" value={imageMetadata.ai_scan_metadata.processing_tier_reached} mono />
                            </div>
                          </div>
                        )}

                        {/* Legacy Appraiser Data */}
                        {appraiser && (
                          <div style={{ marginBottom: '12px' }}>
                            <div style={{ 
                              fontSize: '6pt', 
                              color: 'rgba(255,255,255,0.3)', 
                              textTransform: 'uppercase',
                              marginBottom: '4px',
                              letterSpacing: '0.5px'
                            }}>APPRAISER (LEGACY)</div>
                            <div style={{ 
                              background: 'rgba(0,0,0,0.3)', 
                              padding: '6px 8px',
                              border: '1px solid rgba(255,255,255,0.1)'
                            }}>
                              <DataRow label="model" value={appraiser.model} mono />
                              <DataRow label="angle" value={appraiser.angle} mono />
                              {appraiser.description && (
                                <div style={{ marginTop: '4px', fontSize: '8pt', color: 'white', lineHeight: '1.4' }}>
                                  {appraiser.description}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                          
                        {/* SPID Sheet Detection */}
                        {imageMetadata?.ai_scan_metadata?.spid_data?.is_spid_sheet && (
                          <div style={{ marginBottom: '12px' }}>
                            <div style={{ 
                              fontSize: '6pt', 
                              color: '#4ade80', 
                              textTransform: 'uppercase',
                              marginBottom: '4px',
                              letterSpacing: '0.5px'
                            }}>SPID SHEET DETECTED</div>
                            <div style={{ 
                              background: 'rgba(34,197,94,0.1)', 
                              padding: '6px 8px',
                              border: '1px solid rgba(34,197,94,0.3)'
                            }}>
                              <DataRow label="confidence" value={`${imageMetadata.ai_scan_metadata.spid_data.confidence}%`} mono />
                              {imageMetadata.ai_scan_metadata.spid_data.extracted_data && (
                                <>
                                  <DataRow label="vin" value={imageMetadata.ai_scan_metadata.spid_data.extracted_data.vin} mono />
                                  <DataRow label="paint_code" value={imageMetadata.ai_scan_metadata.spid_data.extracted_data.paint_code_exterior} mono />
                                  <DataRow label="rpo_codes" value={imageMetadata.ai_scan_metadata.spid_data.extracted_data.rpo_codes} mono />
                                </>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Raw JSON Button */}
                        {imageMetadata?.ai_scan_metadata && (
                          <button
                            onClick={() => {
                              const jsonStr = JSON.stringify(imageMetadata.ai_scan_metadata, null, 2);
                              navigator.clipboard?.writeText(jsonStr);
                              alert('Full ai_scan_metadata:\n\n' + jsonStr);
                            }}
                            style={{
                              width: '100%',
                              padding: '6px',
                              fontSize: '7pt',
                              backgroundColor: 'rgba(255,255,255,0.05)',
                              color: 'rgba(255,255,255,0.5)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              cursor: 'pointer',
                              textTransform: 'uppercase'
                            }}
                          >
                            VIEW RAW JSON
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {/* Appraiser Brain Checklist */}
                  {imageMetadata?.ai_scan_metadata?.appraiser && (
                    <div className="mb-4 p-3 bg-white/5 rounded border border-white/10">
                      <div className="space-y-2 text-xs">
                        {Object.entries(imageMetadata.ai_scan_metadata.appraiser).map(([key, value]) => {
                          if (key === 'raw_analysis') return null; // Skip raw text
                          
                          const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                          let displayValue = value;
                          let colorClass = 'text-gray-300';

                          if (typeof value === 'boolean') {
                            displayValue = value ? 'Yes' : 'No';
                            // Context-aware coloring
                            if (key.includes('damage') || key.includes('rust') || key.includes('leak') || key.includes('crack')) {
                              colorClass = value ? 'text-red-400 font-bold' : 'text-green-400';
                            } else if (key.includes('clean') || key.includes('good') || key.includes('stock')) {
                              colorClass = value ? 'text-green-400' : 'text-yellow-400';
                            }
                          } else {
                            // Enums
                             if (String(value).includes('poor') || String(value).includes('heavy')) colorClass = 'text-red-400';
                             if (String(value).includes('good') || String(value).includes('clean')) colorClass = 'text-green-400';
                          }

                          return (
                            <div key={key} className="flex justify-between items-center border-b border-white/5 pb-1 last:border-0">
                              <span className="text-gray-400">{label}</span>
                              <span className={colorClass}>{String(displayValue)}</span>
                            </div>
                          );
                        })}
                      </div>
        </div>
      )}
      

                  {/* Action Buttons - At bottom of info tab */}
                  {canEdit && (
                    <div className="pt-6 mt-6 border-t-2 border-white/20 space-y-2">
                      <button
                        onClick={setAsPrimary}
                        disabled={imageMetadata?.is_primary}
                        className={`w-full py-3 border-2 text-[10px] font-bold uppercase tracking-wide transition-all duration-150 ${
                          imageMetadata?.is_primary
                            ? 'bg-green-900/30 border-green-700/50 text-green-400 cursor-not-allowed'
                            : 'bg-transparent border-white/30 text-white hover:border-white hover:bg-white/10 hover:translate-y-[-2px]'
                        }`}
                        style={{ fontFamily: 'Arial, sans-serif' }}
                        title="Set as vehicle's primary/lead image"
                      >
                        {imageMetadata?.is_primary ? 'PRIMARY IMAGE' : 'SET AS PRIMARY'}
                      </button>

                      <button
                        onClick={deleteImage}
                        className="w-full py-3 bg-transparent border-2 border-red-600/50 text-red-400 text-[10px] font-bold uppercase tracking-wide hover:border-red-500 hover:bg-red-600/10 hover:translate-y-[-2px] transition-all duration-150"
                        style={{ fontFamily: 'Arial, sans-serif' }}
                        title="Delete this image permanently"
                      >
                        DELETE
                      </button>
                    </div>
                  )}
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
                          <div key={c.id} className="bg-white/5 p-3 rounded">
                            <div className="flex justify-between items-center mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-blue-400">{c.user?.full_name || 'Unknown'}</span>
                                {isOwner && (
                                  <span className="text-[9px] px-1.5 py-0.5 bg-green-900/50 text-green-300 rounded border border-green-700">
                                    OWNER
                                  </span>
                                )}
                                {isPreviousOwner && !isOwner && (
                                  <span className="text-[9px] px-1.5 py-0.5 bg-yellow-900/50 text-yellow-300 rounded border border-yellow-700">
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
                      className="w-full bg-[#1a1a1a] border-2 border-white/30 text-white text-[10px] p-3 mb-3 transition-all duration-150 focus:border-white focus:outline-none focus:shadow-[0_0_0_3px_rgba(255,255,255,0.1)] placeholder:text-white/40"
                      style={{ fontFamily: 'Arial, sans-serif' }}
                      placeholder="Add a comment..."
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addComment()}
                    />
                    <button 
                      onClick={addComment}
                      disabled={!newComment.trim()}
                      className="w-full py-2.5 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-wide hover:bg-white/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 hover:translate-y-[-2px] hover:shadow-[0_0_0_3px_rgba(255,255,255,0.2)]"
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
                      <div key={tag.id} className="flex justify-between items-center bg-white/5 p-2 rounded hover:bg-white/10 cursor-pointer">
                        <span className="text-sm">{tag.tag_name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded ${tag.verified ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
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
    </div>,
    document.body
  );
};

export default ImageLightbox;
