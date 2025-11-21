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
  const [isTagging, setIsTagging] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [showTagInput, setShowTagInput] = useState(false);
  const [currentSelection, setCurrentSelection] = useState<{x: number, y: number, width: number, height: number} | null>(null);
  const [dragStart, setDragStart] = useState<{x: number, y: number} | null>(null);
  const [tagName, setTagName] = useState('');
  const [rotation, setRotation] = useState(0);
  const [showProTagger, setShowProTagger] = useState(false);
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

  // Tagging Logic
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTagging || !imageRef.current) return;
    
    const rect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    // Only process if click is within image bounds
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    
    setDragStart({ x, y });
    setCurrentSelection({ x, y, width: 0, height: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTagging || !dragStart || !imageRef.current) return;
    
    const rect = imageRef.current.getBoundingClientRect();
    const currentX = ((e.clientX - rect.left) / rect.width) * 100;
    const currentY = ((e.clientY - rect.top) / rect.height) * 100;
    
    const width = Math.abs(currentX - dragStart.x);
    const height = Math.abs(currentY - dragStart.y);
    const x = Math.min(dragStart.x, currentX);
    const y = Math.min(dragStart.y, currentY);
    
    setCurrentSelection({ x, y, width, height });
  };

  const handleMouseUp = () => {
    if (!isTagging || !dragStart || !currentSelection) return;
    
    // If it's just a point click (no drag), still show input
    if (currentSelection.width < 1 && currentSelection.height < 1) {
      // Make it a small point marker
      setCurrentSelection({
        x: dragStart.x - 1,
        y: dragStart.y - 1,
        width: 2,
        height: 2
      });
    }
    
    setShowTagInput(true);
    setDragStart(null);
  };

  const createTag = async () => {
    if (!currentSelection || !tagName.trim() || !imageId || !vehicleId) return;
    
    try {
      await createTagFn(vehicleId, {
        tag_name: tagName.trim(),
        tag_type: 'part',
        x_position: currentSelection.x,
        y_position: currentSelection.y,
        width: currentSelection.width,
        height: currentSelection.height
      });
      
      // Success - clear state and reload tags
      setTagName('');
      setShowTagInput(false);
      setCurrentSelection(null);
      setIsTagging(false);
      
      // Reload tags to show the new one
      await loadTags();
    } catch (error) {
      console.error('Error creating tag:', error);
      alert('Failed to create tag. Please try again.');
    }
  };

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
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    };
    
    // Use scroll wheel for image navigation
    const handleWheel = (e: WheelEvent) => {
      // Only navigate if not in tagging mode and not typing in input
      if (isTagging || showTagInput || showProTagger) return;
      
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
  }, [onClose, onPrev, onNext, isTagging, showTagInput, showProTagger]);

  if (!isOpen) return null;

  // If Pro Tagger is open, show it fullscreen
  if (showProTagger) {
    return createPortal(
      <div className="fixed inset-0 z-[10000] bg-black">
        <IntelligentImageTagger
          imageUrl={imageUrl}
          imageId={imageId}
          vehicleId={vehicleId}
          onClose={() => {
            setShowProTagger(false);
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
    <div className="fixed inset-0 z-[10000] bg-black/95 flex flex-col text-white font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/50 border-b border-white/10">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕ Close</button>
          <span className="text-sm text-gray-400">
            {title || 'Image Viewer'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {onPrev && <button onClick={onPrev} className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-xs">← Prev</button>}
          {onNext && <button onClick={onNext} className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-xs">Next →</button>}
          
          {canEdit && (
            <>
              <button
                onClick={() => setShowProTagger(true)}
                className="px-3 py-1 rounded text-xs font-medium border bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
                title="Professional annotation tools with intelligent selection"
              >
                PRO TAG
              </button>
              <button
                onClick={() => setIsTagging(!isTagging)}
                className={`px-3 py-1 rounded text-xs font-medium border ${isTagging ? 'bg-green-500 text-black border-green-500' : 'bg-transparent border-white/30 text-white hover:bg-white/10'}`}
                title="Quick tagging mode"
              >
                {isTagging ? 'TAGGING' : 'QUICK TAG'}
              </button>
            </>
        )}

          <button 
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="px-3 py-1 bg-transparent border border-white/30 text-white hover:bg-white/10 rounded text-xs"
            title="Rotate Image"
          >
            ↻ Rotate
          </button>
          <button 
            onClick={async () => {
              if (!imageUrl || !vehicleId) return;
              const result = await triggerAIAnalysis(imageUrl, timelineEventId, vehicleId);
              if (result.success) {
                // Reload tags and metadata after analysis
                setTimeout(() => {
                  loadTags();
                  loadImageMetadata();
                }, 2000);
              }
            }}
            disabled={analyzing || !imageUrl || !vehicleId}
            className={`px-3 py-1 rounded text-xs font-medium border ${analyzing ? 'bg-gray-600 text-gray-300 border-gray-600 cursor-not-allowed' : 'bg-transparent border-white/30 text-white hover:bg-white/10'}`}
            title="Run AI Analysis"
          >
            {analyzing ? `AI ${analysisProgress ? `(${analysisProgress})` : '...'}` : 'AI'}
          </button>
          <button 
            onClick={() => setShowSidebar(!showSidebar)}
            className={`px-3 py-1 rounded text-xs font-medium border ${showSidebar ? 'bg-white text-black border-white' : 'bg-transparent border-white/30 text-white hover:bg-white/10'}`}
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
            cursor: isTagging ? 'crosshair' : 'default',
            maxWidth: '100%',
            maxHeight: '100%'
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Vehicle"
            onLoad={() => setImageLoaded(true)}
            className="max-w-full max-h-full object-contain select-none"
            style={{ 
              pointerEvents: 'none',
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
          
          {/* Selection Box */}
          {currentSelection && (
            <div style={{
              position: 'absolute',
              left: `${currentSelection.x}%`,
              top: `${currentSelection.y}%`,
              width: `${currentSelection.width}%`,
              height: `${currentSelection.height}%`,
              border: '2px solid rgba(255, 255, 255, 0.9)',
              background: 'rgba(255, 255, 255, 0.1)',
              pointerEvents: 'none',
              boxShadow: '0 0 20px rgba(255, 255, 255, 0.4), inset 0 0 20px rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(2px)'
            }} />
          )}

          {/* Tag Input Popup */}
          {showTagInput && currentSelection && (
            <div 
              style={{
                position: 'absolute',
                left: `${currentSelection.x + currentSelection.width / 2}%`,
                top: `${currentSelection.y + currentSelection.height + 2}%`,
                transform: 'translateX(-50%)',
                zIndex: 10002
              }}
              className="bg-[#0a0a0a] p-4 rounded-lg border-2 border-white/20 shadow-2xl w-72"
            >
              <h4 className="text-white text-sm font-bold mb-3 tracking-tight">Label this area</h4>
              <input
                autoFocus
                className="w-full border-2 border-white/30 bg-black/50 p-2.5 text-white text-sm mb-3 rounded focus:border-white focus:outline-none transition-all duration-150 placeholder:text-gray-500"
                placeholder="e.g. Front Bumper, Rust Spot, Dent"
                value={tagName}
                onChange={e => setTagName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && tagName.trim()) {
                    createTag();
                  } else if (e.key === 'Escape') {
                    setShowTagInput(false);
                    setCurrentSelection(null);
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <button 
                  onClick={() => { 
                    setShowTagInput(false); 
                    setCurrentSelection(null);
                    setTagName('');
                  }}
                  className="px-4 py-2 text-xs text-white/60 hover:text-white font-medium transition-all duration-150"
                >Cancel</button>
                <button 
                  onClick={createTag}
                  disabled={!tagName.trim()}
                  className="px-4 py-2 bg-white text-black text-xs rounded font-bold hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 border-2 border-white"
                >Save Tag</button>
              </div>
            </div>
          )}
        </div>
      </div>

        {/* Sidebar */}
        {showSidebar && (
          <div className="w-80 bg-[#111] border-l border-white/10 flex flex-col animate-slide-in-right">
            {/* Tabs */}
            <div className="flex border-b border-white/10">
              <button 
                onClick={() => setActiveTab('info')}
                className={`flex-1 py-3 text-xs font-medium ${activeTab === 'info' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}`}
              >
                Details
              </button>
              <button 
                onClick={() => setActiveTab('comments')}
                className={`flex-1 py-3 text-xs font-medium ${activeTab === 'comments' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}`}
              >
                Comments ({comments.length})
              </button>
              <button 
                onClick={() => setActiveTab('tags')}
                className={`flex-1 py-3 text-xs font-medium ${activeTab === 'tags' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}`}
              >
                Tags ({tags.length})
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
                  <div className="mt-auto pt-4 border-t border-white/10">
                    <input
                      className="w-full bg-black/50 border border-white/20 rounded p-2 text-sm text-white mb-2"
                      placeholder="Add a comment..."
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addComment()}
                    />
                    <button 
                      onClick={addComment}
                      disabled={!newComment.trim()}
                      className="w-full py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                      Post Comment
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
