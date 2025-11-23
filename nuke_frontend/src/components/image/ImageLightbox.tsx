import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { useImageTags } from '../../hooks/useImageTags';
import { useImageAnalysis } from '../../hooks/useImageAnalysis';
import { useAutoTagging } from '../../hooks/useAutoTagging';
import SpatialPartPopup from '../parts/SpatialPartPopup';
import PartCheckoutModal from '../parts/PartCheckoutModal';
import PartEnrichmentModal from '../parts/PartEnrichmentModal';
import { ManualAnnotationViewer } from './ManualAnnotationViewer';
import { ClickablePartModal } from '../parts/ClickablePartModal';
import { AnnotoriousImageTagger } from './AnnotoriousImageTagger';
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
              {isVerified ? '✓ Verified' : `AI ${confidence}%`}
              {isLinkedVehicle && ' • Click to view'}
            </div>
          )}
          {isShoppable && <span> 🛒</span>}
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
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [attribution, setAttribution] = useState<any>(null);
  const [imageMetadata, setImageMetadata] = useState<any>(null);
  const [angleData, setAngleData] = useState<any>(null);
  const [vehicleOwnerId, setVehicleOwnerId] = useState<string | null>(null);
  const [previousOwners, setPreviousOwners] = useState<Set<string>>(new Set());

  // Sidebar State
  const [showSidebar, setShowSidebar] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'comments' | 'tags'>('info');
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [locationDisplay, setLocationDisplay] = useState<'coordinates' | 'city' | 'org'>('city');

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
      
      // 2. Load uploader profile (person who ran the import)
      if (imgData.user_id) {
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
        source: imgData.source,
        created_at: imgData.created_at
      });
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
  }, [loadImageMetadata]);

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
    
    // Use scroll wheel for image navigation
    const handleWheel = (e: WheelEvent) => {
      // Only navigate if not in tagger
      if (showTagger) return;
      
      if (e.deltaY > 0 && onNext) {
        e.preventDefault();
        onNext();
      } else if (e.deltaY < 0 && onPrev) {
        e.preventDefault();
        onPrev();
      }
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
      <div className="fixed inset-0 z-[10000] bg-[#0a0a0a] flex flex-col">
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
    <div className="fixed inset-0 z-[10000] bg-[#0a0a0a] flex flex-col text-white" style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Header - Completely Redesigned for Mobile */}
      <div className="bg-[#111] border-b-2 border-white/20">
        {/* Mobile: Stacked layout */}
        <div className="block sm:hidden">
          {/* Row 1: Close + Date + Info */}
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/10">
            <button 
              onClick={onClose}
              className="px-3 py-1 bg-red-600 border border-white text-white text-[8px] font-bold"
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              ✕
            </button>
            <span className="text-[9px] text-white/70 font-medium flex-1 text-center mx-2">
              {description || title || 'IMAGE'}
            </span>
            <button 
              onClick={() => setShowSidebar(!showSidebar)}
              className={`px-3 py-1 border text-[8px] font-bold ${
                showSidebar ? 'bg-white text-black border-white' : 'bg-transparent border-white/50 text-white'
              }`}
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              INFO
            </button>
          </div>

          {/* Row 2: Navigation arrows (prominent) */}
          <div className="flex items-center justify-center gap-4 py-2">
            {onPrev && (
              <button 
                onClick={onPrev}
                className="px-6 py-2 bg-[#2a2a2a] border-2 border-white/40 text-white text-[14px] font-bold hover:bg-white/10"
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                ←
              </button>
            )}
            {onNext && (
              <button 
                onClick={onNext}
                className="px-6 py-2 bg-[#2a2a2a] border-2 border-white/40 text-white text-[14px] font-bold hover:bg-white/10"
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                →
              </button>
            )}
          </div>

          {/* Row 3: Action buttons (compact grid) */}
          {canEdit && (
            <div className="grid grid-cols-4 gap-1 px-2 py-1.5">
              <button
                onClick={() => setShowTagger(true)}
                className="px-2 py-1.5 bg-white text-black border border-white text-[7px] font-bold"
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                TAG
              </button>
              <button
                onClick={setAsPrimary}
                disabled={imageMetadata?.is_primary}
                className={`px-2 py-1.5 border text-[7px] font-bold ${
                  imageMetadata?.is_primary
                    ? 'bg-green-900/30 border-green-700 text-green-400'
                    : 'bg-transparent border-white/50 text-white'
                }`}
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                PRIMARY
              </button>
              <button 
                onClick={() => {
                  const newRotation = (rotation + 90) % 360;
                  setRotation(newRotation);
                  saveRotation(newRotation);
                }}
                className="px-2 py-1.5 bg-transparent border border-white/50 text-white text-[7px] font-bold"
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                ROTATE
              </button>
              <button 
                onClick={toggleSensitive}
                className={`px-2 py-1.5 border text-[7px] font-bold ${
                  isSensitive 
                    ? 'bg-yellow-600 text-black border-yellow-400' 
                    : 'bg-transparent border-white/50 text-white'
                }`}
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                BLUR
              </button>
            </div>
          )}
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

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Image Canvas */}
      <div
        ref={containerRef}
          className="flex-1 flex items-center justify-center p-4 relative"
      >
        <div
          style={{
            position: 'relative',
            maxWidth: '100%',
            maxHeight: '100%'
          }}
        >
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Vehicle"
            onLoad={() => setImageLoaded(true)}
            className="max-w-full max-h-full object-contain select-none"
            style={{ 
              pointerEvents: 'auto',
              transform: `rotate(${rotation}deg)`,
              transition: 'transform 0.3s ease, filter 0.3s ease',
              display: 'block',
              filter: isSensitive ? 'blur(20px)' : 'none'
            }}
          />

          {/* Markers */}
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
      </div>

        {/* Sidebar - Cursor Style */}
        {showSidebar && (
          <div className="w-80 bg-[#111] border-l-2 border-white/20 flex flex-col">
            {/* Tabs - Cursor Style */}
            <div className="flex border-b-2 border-white/20">
              <button 
                onClick={() => setActiveTab('info')}
                className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wide transition-all duration-150 ${
                  activeTab === 'info' 
                    ? 'text-white border-b-2 border-white bg-white/5' 
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                DETAILS
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
                COMMENTS ({comments.length})
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
                TAGS ({tags.length})
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* Info Tab */}
              {activeTab === 'info' && (
                <div className="space-y-6">
          {/* AI Event Description */}
          {imageMetadata?.ai_scan_metadata?.appraiser?.description && (
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Event Context</h4>
                      <p className="text-sm text-gray-200 leading-relaxed">{imageMetadata.ai_scan_metadata.appraiser.description}</p>
                    </div>
          )}

                  {attribution && (
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Source</h4>
                      <div className="text-sm text-gray-300">
                        {/* Photographer (actual person who took the photo) */}
                        {attribution.photographer ? (
                          <div className="mb-2">
                            <div className="text-xs text-gray-500">Photographer:</div>
                            <div className="text-white">
                              {attribution.photographer.name}
                              {attribution.photographer.camera && (
                                <span className="text-gray-500 text-xs ml-2">
                                  ({attribution.photographer.camera})
                                </span>
                              )}
                            </div>
                          </div>
                        ) : attribution.source === 'dropbox_import' ? (
                          <div className="mb-2">
                            <div className="text-xs text-gray-500">Photographer:</div>
                            <div className="text-gray-400 italic">Unknown (imported from Dropbox)</div>
                          </div>
                        ) : null}
                        
                        {/* Uploader (person who ran the import/uploaded to system) */}
                        <div>
                          <div className="text-xs text-gray-500">
                            {attribution.source === 'dropbox_import' ? 'Imported by:' : 'Uploaded by:'}
                          </div>
                          {attribution.uploader ? (
                            <button
                              onClick={() => {
                                // Show user profile card in toast
                                const profileCard = document.createElement('div');
                                profileCard.className = 'profile-toast';
                                profileCard.innerHTML = `
                                  <div style="position: fixed; top: 20px; right: 20px; z-index: 10000; background: #000; border: 2px solid #fff; padding: 16px; max-width: 300px;">
                                    <div style="color: #fff; font-size: 12px; font-weight: bold; margin-bottom: 8px;">
                                      ${attribution.uploader.full_name || attribution.uploader.username || 'User'}
                                    </div>
                                    <div style="color: #bbb; font-size: 10px; margin-bottom: 8px;">
                                      @${attribution.uploader.username || 'user'}
                                    </div>
                                    <a href="/profile/${attribution.uploader.id}" style="color: #0066cc; font-size: 10px; text-decoration: underline;">
                                      View Full Profile →
                                    </a>
                                    <button onclick="this.parentElement.remove()" style="position: absolute; top: 4px; right: 4px; background: #fff; color: #000; border: none; padding: 2px 6px; font-size: 10px; cursor: pointer;">
                                      ✕
                                    </button>
                                  </div>
                                `;
                                document.body.appendChild(profileCard);
                                setTimeout(() => profileCard.remove(), 5000);
                              }}
                              className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                            >
                              {attribution.uploader.full_name}
                            </button>
                          ) : (
                            <span className="text-gray-400">Unknown</span>
                          )}
                        </div>
                        {attribution.source && <div className="mt-2 text-xs">Source: {attribution.source}</div>}
                      </div>
            </div>
          )}

                  {/* AI Analysis Section - Always show if we have any metadata */}
                  {/* AI Analysis Section - Show if we have ANY metadata */}
                  {(angleData || imageMetadata || attribution) && (
                    <div className="mb-4">
                      <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">AI Analysis</h4>
                      <div className="text-sm text-gray-300 space-y-2">
                        {angleData && (
                          <>
                            <div className="flex justify-between">
                              <span>View:</span>
                              <span className="text-white">{angleData.primary_label}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Confidence:</span>
                              <span className="text-green-400">{angleData.confidence}%</span>
                            </div>
                          </>
                        )}
                        
                        {/* Who - Photographer (from EXIF camera device fingerprint) */}
                        {attribution?.photographer ? (
                          <div className="flex flex-col border-t border-white/10 pt-2 mt-2">
                            <span className="text-gray-500 mb-1">Photographer:</span>
                            <span className="text-white text-xs">
                              {attribution.photographer.name}
                              {attribution.photographer.camera && (
                                <span className="text-gray-500"> • {attribution.photographer.camera}</span>
                              )}
                            </span>
                          </div>
                        ) : attribution?.source === 'dropbox_import' ? (
                          <div className="flex flex-col border-t border-white/10 pt-2 mt-2">
                            <span className="text-gray-500 mb-1">Photographer:</span>
                            <span className="text-gray-400 italic text-xs">Unknown (automated import)</span>
                          </div>
                        ) : null}
                        
                        {/* What - AI-Generated Description */}
                        {imageMetadata?.ai_scan_metadata?.appraiser?.description ? (
                          <div className="flex flex-col border-t border-white/10 pt-2 mt-2">
                            <span className="text-gray-500 mb-1">What:</span>
                            <span className="text-white text-xs leading-relaxed">
                              {imageMetadata.ai_scan_metadata.appraiser.description}
                            </span>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[9px] text-gray-600">
                                AI: {imageMetadata.ai_scan_metadata.appraiser.model || 'GPT-4o'}
                              </span>
                              <button
                                onClick={() => {
                                  const promptInfo = {
                                    model: imageMetadata.ai_scan_metadata.appraiser.model || 'GPT-4o',
                                    context: imageMetadata.ai_scan_metadata.appraiser.context || 'No context',
                                    analyzedAt: imageMetadata.ai_scan_metadata.appraiser.analyzed_at || imageMetadata.created_at,
                                    description: imageMetadata.ai_scan_metadata.appraiser.description
                                  };
                                  alert(JSON.stringify(promptInfo, null, 2));
                                }}
                                className="text-[9px] text-gray-500 hover:text-gray-300 underline"
                                title="View how this description was generated"
                              >
                                ℹ How was this generated?
                              </button>
                            </div>
                          </div>
                        ) : angleData?.primary_label ? (
                          <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
                            <span>What:</span>
                            <span className="text-white">{angleData.primary_label}</span>
                          </div>
                        ) : (
                          <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
                            <span>What:</span>
                            <span className="text-yellow-400">Pending AI analysis</span>
                          </div>
                        )}
                        
                        {/* Where - Location (clickable to toggle format) */}
                        {imageMetadata?.exif_data?.location && (imageMetadata.exif_data.location.city || imageMetadata.exif_data.location.latitude) && (
                          <div 
                            className="flex justify-between border-t border-white/10 pt-2 mt-2 cursor-pointer hover:bg-white/5 -mx-2 px-2 py-2 rounded transition-all"
                            onClick={() => {
                              setLocationDisplay(prev => {
                                if (prev === 'city') return 'coordinates';
                                if (prev === 'coordinates') return 'org';
                                return 'city';
                              });
                            }}
                            title="Click to toggle location format"
                          >
                            <span>Where:</span>
                            <span className="text-white text-right">
                              {locationDisplay === 'city' && imageMetadata.exif_data.location.city && imageMetadata.exif_data.location.state 
                                ? `${imageMetadata.exif_data.location.city}, ${imageMetadata.exif_data.location.state}`
                                : locationDisplay === 'coordinates' && imageMetadata.exif_data.location.latitude
                                  ? `${imageMetadata.exif_data.location.latitude.toFixed(4)}, ${imageMetadata.exif_data.location.longitude.toFixed(4)}`
                                  : locationDisplay === 'org'
                                    ? imageMetadata.exif_data.location.organization_name || imageMetadata.exif_data.location.shop_name || (imageMetadata.exif_data.location.city ? `${imageMetadata.exif_data.location.city}, ${imageMetadata.exif_data.location.state}` : 'Unknown')
                                    : imageMetadata.exif_data.location.city 
                                      ? `${imageMetadata.exif_data.location.city}, ${imageMetadata.exif_data.location.state}`
                                      : imageMetadata.exif_data.location.latitude
                                        ? `${imageMetadata.exif_data.location.latitude.toFixed(4)}, ${imageMetadata.exif_data.location.longitude.toFixed(4)}`
                                        : 'Unknown'
                              }
                            </span>
                          </div>
                        )}
                        
                        {/* Why - Context */}
                        {imageMetadata?.ai_scan_metadata?.appraiser?.context && (
                          <div className="flex flex-col border-t border-white/10 pt-2 mt-2">
                            <span className="mb-1">Why:</span>
                            <span className="text-white text-xs">{imageMetadata.ai_scan_metadata.appraiser.context}</span>
                          </div>
                        )}
                        
                        {/* SPID Sheet Detection */}
                        {imageMetadata?.ai_scan_metadata?.spid_data?.is_spid_sheet && (
                          <div className="border-t border-white/10 pt-2 mt-2">
                            <div className="bg-green-900/30 border border-green-700/50 p-3 rounded">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-green-400 font-bold text-[10px] uppercase">
                                  SPID Sheet Detected
                                </span>
                                <span className="text-green-400 text-[10px]">
                                  {imageMetadata.ai_scan_metadata.spid_data.confidence}% confident
                                </span>
                              </div>
                              
                              {imageMetadata.ai_scan_metadata.spid_data.extracted_data && (
                                <div className="space-y-1 text-[10px]">
                                  {imageMetadata.ai_scan_metadata.spid_data.extracted_data.vin && (
                                    <div className="text-gray-300">
                                      VIN: {imageMetadata.ai_scan_metadata.spid_data.extracted_data.vin}
                                    </div>
                                  )}
                                  {imageMetadata.ai_scan_metadata.spid_data.extracted_data.paint_code_exterior && (
                                    <div className="text-gray-300">
                                      Paint: {imageMetadata.ai_scan_metadata.spid_data.extracted_data.paint_code_exterior}
                                    </div>
                                  )}
                                  {imageMetadata.ai_scan_metadata.spid_data.extracted_data.rpo_codes?.length > 0 && (
                                    <div className="text-gray-300">
                                      RPO Codes: {imageMetadata.ai_scan_metadata.spid_data.extracted_data.rpo_codes.length} extracted
                                    </div>
                                  )}
                                  <button
                                    onClick={() => {
                                      alert(JSON.stringify(imageMetadata.ai_scan_metadata.spid_data.extracted_data, null, 2));
                                    }}
                                    className="text-green-400 underline mt-1 text-[9px]"
                                  >
                                    View All Extracted Data →
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
        </div>
      )}

                  {/* Appraiser Brain Checklist */}
                  {imageMetadata?.ai_scan_metadata?.appraiser && (
                    <div className="mb-4 p-3 bg-white/5 rounded border border-white/10">
                      <h4 className="text-xs font-bold text-blue-400 uppercase mb-2 flex items-center gap-2">
                        <span>🧠</span> Appraiser Notes
                      </h4>
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
      
                  {imageMetadata?.exif_data && (
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">EXIF Data</h4>
                      <div className="space-y-2 text-xs">
                        {/* Camera Info */}
                        {imageMetadata.exif_data.camera && (
                          <div className="border-b border-white/10 pb-2">
                            <span className="block text-gray-500 mb-1">Camera</span>
                            <span className="text-gray-200">
                              {imageMetadata.exif_data.camera.make} {imageMetadata.exif_data.camera.model}
                            </span>
                          </div>
                        )}
                        
                        {/* Photo Date/Time */}
                        {imageMetadata.exif_data.DateTimeOriginal && (
                          <div className="border-b border-white/10 pb-2">
                            <span className="block text-gray-500 mb-1">Photo Taken</span>
                            <span className="text-gray-200">
                              {new Date(imageMetadata.exif_data.DateTimeOriginal).toLocaleString()}
                            </span>
                          </div>
                        )}
                        
                        {/* Technical Settings */}
                        {imageMetadata.exif_data.technical && (
                          <div className="border-b border-white/10 pb-2">
                            <span className="block text-gray-500 mb-1">Camera Settings</span>
                            <div className="text-gray-200 font-mono text-[10px]">
                              {imageMetadata.exif_data.technical.iso && `ISO ${imageMetadata.exif_data.technical.iso}`}
                              {imageMetadata.exif_data.technical.aperture && ` • ${imageMetadata.exif_data.technical.aperture}`}
                              {imageMetadata.exif_data.technical.shutterSpeed && ` • ${imageMetadata.exif_data.technical.shutterSpeed}`}
                              {imageMetadata.exif_data.technical.focalLength && ` • ${imageMetadata.exif_data.technical.focalLength}`}
                            </div>
                          </div>
                        )}
                        
                        {/* Location */}
                        {imageMetadata.exif_data.location && (imageMetadata.exif_data.location.latitude || imageMetadata.exif_data.location.city) && (
                          <div className="border-b border-white/10 pb-2">
                            <span className="block text-gray-500 mb-1">Location</span>
                            <div className="text-gray-200">
                              {imageMetadata.exif_data.location.city && `${imageMetadata.exif_data.location.city}, ${imageMetadata.exif_data.location.state}`}
                              {imageMetadata.exif_data.location.latitude && (
                                <div className="text-[10px] text-gray-400 mt-1">
                                  {imageMetadata.exif_data.location.latitude.toFixed(4)}, {imageMetadata.exif_data.location.longitude.toFixed(4)}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {/* Dimensions */}
                        {imageMetadata.exif_data.dimensions && (
                          <div>
                            <span className="block text-gray-500 mb-1">Dimensions</span>
                            <span className="text-gray-200">
                              {imageMetadata.exif_data.dimensions.width} × {imageMetadata.exif_data.dimensions.height}
                            </span>
                          </div>
                        )}
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
    </div>,
    document.body
  );
};

export default ImageLightbox;
