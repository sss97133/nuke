import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { useImageTags } from '../../hooks/useImageTags';
import { useImageAnalysis } from '../../hooks/useImageAnalysis';
import SpatialPartPopup from '../parts/SpatialPartPopup';
import PartCheckoutModal from '../parts/PartCheckoutModal';
import PartEnrichmentModal from '../parts/PartEnrichmentModal';
import { ManualAnnotationViewer } from './ManualAnnotationViewer';
import { ClickablePartModal } from '../parts/ClickablePartModal';
import IntelligentImageTagger from './IntelligentImageTagger';
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
  
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'absolute',
        left: `${tag.x_position}%`,
        top: `${tag.y_position}%`,
        transform: 'translate(-50%, -50%)',
      width: isHovered ? '16px' : '12px',
      height: isHovered ? '16px' : '12px',
        background: isShoppable ? '#00ff00' : '#ffffff',
        border: '2px solid #000000',
        borderRadius: '50%',
      cursor: 'pointer',
        boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
        transition: 'all 0.12s ease',
        zIndex: isHovered ? 10001 : 10000,
        pointerEvents: 'auto'
      }}
    >
      {isHovered && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: '8px',
          background: 'rgba(0, 0, 0, 0.9)',
          color: 'white',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 'bold',
          whiteSpace: 'nowrap',
          pointerEvents: 'none'
        }}>
          {tag.tag_name}
          {isShoppable && ' 🛒'}
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

  const [imageLoaded, setImageLoaded] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [rotation, setRotation] = useState(0);
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

  // Modals
  const [spatialPopupOpen, setSpatialPopupOpen] = useState(false);
  const [selectedSpatialTag, setSelectedSpatialTag] = useState<any>(null);
  const [clickablePartModalOpen, setClickablePartModalOpen] = useState(false);
  const [selectedPartName, setSelectedPartName] = useState<string | null>(null);
  const [selectedPart, setSelectedPart] = useState<any>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);

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
      
      // Load uploader profile separately if user_id exists
      if (imgData.user_id) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, full_name, username')
          .eq('id', imgData.user_id)
          .single();
        
        setAttribution({
          uploader: profileData || null,
          source: imgData.source,
          created_at: imgData.created_at
        });
      } else {
        setAttribution({
          uploader: null,
          source: imgData.source,
          created_at: imgData.created_at
        });
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
      <div className="fixed inset-0 z-[10000] bg-[#0a0a0a]">
        <IntelligentImageTagger
          imageUrl={imageUrl}
          imageId={imageId}
          vehicleId={vehicleId}
          onClose={() => {
            setShowTagger(false);
            loadTags();
          }}
          onTagsUpdate={() => {
            loadTags();
            loadImageMetadata();
          }}
        />
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-[#0a0a0a] flex flex-col text-white" style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Header - Cursor Style */}
      <div className="flex items-center justify-between px-6 py-3 bg-[#111] border-b-2 border-white/20">
        <div className="flex items-center gap-6">
          <button 
            onClick={onClose}
            className="text-white/60 hover:text-white text-[11px] font-semibold transition-all duration-150 hover:translate-y-[-1px]"
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            CLOSE
          </button>
          <div className="h-4 w-[2px] bg-white/20"></div>
          <span className="text-[10px] text-white/50 font-medium tracking-wide uppercase">
            {title || 'IMAGE VIEWER'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Navigation - Prominent Cursor Style */}
          {onPrev && (
            <button 
              onClick={onPrev}
              className="px-4 py-2 bg-[#1a1a1a] border-2 border-white/30 text-white text-[10px] font-bold uppercase tracking-wide hover:border-white hover:bg-white/10 transition-all duration-150 hover:translate-y-[-2px] hover:shadow-[0_0_0_3px_rgba(255,255,255,0.1)]"
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              ← PREV
            </button>
          )}
          {onNext && (
            <button 
              onClick={onNext}
              className="px-4 py-2 bg-[#1a1a1a] border-2 border-white/30 text-white text-[10px] font-bold uppercase tracking-wide hover:border-white hover:bg-white/10 transition-all duration-150 hover:translate-y-[-2px] hover:shadow-[0_0_0_3px_rgba(255,255,255,0.1)]"
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              NEXT →
            </button>
          )}
          
          {canEdit && (
            <>
              <div className="h-6 w-[2px] bg-white/20 mx-1"></div>
              <button
                onClick={() => setShowTagger(true)}
                className="px-4 py-2 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-wide hover:bg-white/90 transition-all duration-150 hover:translate-y-[-2px] hover:shadow-[0_0_0_3px_rgba(255,255,255,0.2)]"
                style={{ fontFamily: 'Arial, sans-serif' }}
                title="Professional annotation tools with intelligent selection"
              >
                TAG
              </button>
            </>
          )}

          <div className="h-6 w-[2px] bg-white/20 mx-1"></div>
          
          <button 
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="px-4 py-2 bg-transparent border-2 border-white/30 text-white text-[10px] font-bold uppercase tracking-wide hover:border-white hover:bg-white/10 transition-all duration-150 hover:translate-y-[-2px] hover:shadow-[0_0_0_3px_rgba(255,255,255,0.1)]"
            style={{ fontFamily: 'Arial, sans-serif' }}
            title="Rotate Image"
          >
            ROTATE
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
            className={`px-4 py-2 border-2 text-[10px] font-bold uppercase tracking-wide transition-all duration-150 ${
              analyzing 
                ? 'bg-[#2a2a2a] text-white/40 border-white/10 cursor-not-allowed' 
                : 'bg-transparent border-white/30 text-white hover:border-white hover:bg-white/10 hover:translate-y-[-2px] hover:shadow-[0_0_0_3px_rgba(255,255,255,0.1)]'
            }`}
            style={{ fontFamily: 'Arial, sans-serif' }}
            title="Run AI Analysis"
          >
            {analyzing ? `AI ${analysisProgress ? `(${analysisProgress})` : '...'}` : 'AI'}
          </button>
          
          <button 
            onClick={() => setShowSidebar(!showSidebar)}
            className={`px-4 py-2 border-2 text-[10px] font-bold uppercase tracking-wide transition-all duration-150 hover:translate-y-[-2px] ${
              showSidebar 
                ? 'bg-white text-black border-white hover:shadow-[0_0_0_3px_rgba(255,255,255,0.2)]' 
                : 'bg-transparent border-white/30 text-white hover:border-white hover:bg-white/10 hover:shadow-[0_0_0_3px_rgba(255,255,255,0.1)]'
            }`}
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            INFO
          </button>
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
              transition: 'transform 0.3s ease',
              display: 'block'
            }}
          />

          {/* Markers */}
          {imageLoaded && tags.map(tag => (
            <SpatialTagMarker
              key={tag.id}
              tag={tag}
              isShoppable={!!tag.is_shoppable}
              onClick={() => {
                if (tag.tag_name) {
                  setSelectedPartName(tag.tag_name);
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
          {description && (
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Description</h4>
                      <p className="text-sm text-gray-200">{description}</p>
                    </div>
          )}

                  {attribution && (
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Source</h4>
                      <div className="text-sm text-gray-300">
                        <div>Imported by: {attribution.uploader?.full_name || 'Unknown'}</div>
                        {attribution.source && <div>Source: {attribution.source}</div>}
                        <div className="text-xs text-gray-500 mt-1">{new Date(attribution.created_at).toLocaleString()}</div>
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
                        
                        {/* Who - Photo Taker */}
                        {attribution?.uploader && (
                          <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
                            <span>Who:</span>
                            <span className="text-white">{attribution.uploader.full_name || 'Unknown'}</span>
                          </div>
                        )}
                        
                        {/* What - Subject Matter - Always show if we have metadata */}
                        {imageMetadata && (() => {
                          // Determine image type: progress vs finished
                          let imageType = null;
                          
                          // First check appraiser metadata
                          if (imageMetadata?.ai_scan_metadata?.appraiser) {
                            const appraiser = imageMetadata.ai_scan_metadata.appraiser;
                            imageType = appraiser.work_stage || appraiser.image_type || appraiser.process_stage;
                          }
                          
                          // Check process_stage directly from image metadata
                          if (!imageType && imageMetadata?.process_stage) {
                            imageType = imageMetadata.process_stage;
                          }
                          
                          // Check category
                          if (!imageType && imageMetadata?.category) {
                            if (['in_progress', 'progress', 'work_in_progress'].includes(imageMetadata.category.toLowerCase())) {
                              imageType = 'Progress Image';
                            } else if (['completed', 'finished', 'presentation', 'showcase'].includes(imageMetadata.category.toLowerCase())) {
                              imageType = 'Finished Presentation';
                            }
                          }
                          
                          // If GPS location suggests workspace, assume progress
                          // TODO: Define workspace locations (e.g., 676 Wells Rd)
                          if (!imageType && imageMetadata?.latitude && imageMetadata?.longitude) {
                            // Check if location matches known workspace coordinates
                            // For now, assume images with GPS at workspace are progress images
                            imageType = 'Progress Image (workspace)';
                          }
                          
                          // Default fallback - always show something
                          if (!imageType) {
                            imageType = 'General Documentation';
                          }
                          
                          return (
                            <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
                              <span>What:</span>
                              <span className="text-white">{imageType}</span>
                            </div>
                          );
                        })()}
                        
                        {/* Where - Location */}
                        {imageMetadata?.location_name && (
                          <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
                            <span>Where:</span>
                            <span className="text-white">{imageMetadata.location_name}</span>
                          </div>
                        )}
                        {imageMetadata?.latitude && imageMetadata?.longitude && !imageMetadata?.location_name && (
                          <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
                            <span>Where:</span>
                            <span className="text-white">{imageMetadata.latitude.toFixed(4)}, {imageMetadata.longitude.toFixed(4)}</span>
                          </div>
                        )}
                        
                        {/* When - Date Taken */}
                        {imageMetadata?.taken_at && (
                          <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
                            <span>When:</span>
                            <span className="text-white">{new Date(imageMetadata.taken_at).toLocaleDateString()}</span>
                          </div>
                        )}
                        
                        {/* Why - Context */}
                        {imageMetadata?.ai_scan_metadata?.appraiser?.context && (
                          <div className="flex flex-col border-t border-white/10 pt-2 mt-2">
                            <span className="mb-1">Why:</span>
                            <span className="text-white text-xs">{imageMetadata.ai_scan_metadata.appraiser.context}</span>
                          </div>
                        )}
                        {imageMetadata?.caption && (
                          <div className="flex flex-col border-t border-white/10 pt-2 mt-2">
                            <span className="mb-1">Context:</span>
                            <span className="text-white text-xs">{imageMetadata.caption}</span>
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
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                        {Object.entries(imageMetadata.exif_data).slice(0, 6).map(([k, v]) => (
                          <div key={k}>
                            <span className="block text-gray-600">{k}</span>
                            <span className="text-gray-300">{String(v).slice(0, 20)}</span>
                          </div>
                        ))}
                      </div>
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
