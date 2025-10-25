import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { useImageTags } from '../../hooks/useImageTags';
import type { Tag } from '../../services/tagService';
import { MobileImageControls, MobileFloatingActions } from './MobileImageControls';
import ShoppablePartTag from '../parts/ShoppablePartTag';
import PartCheckoutModal from '../parts/PartCheckoutModal';
import PartEnrichmentModal from '../parts/PartEnrichmentModal';
import '../../design-system.css';

interface ImageTag {
  id: string;
  tag_name: string;
  text?: string;
  x_position: number;
  y_position: number;
  width: number;
  height: number;
  tag_type: 'part' | 'tool' | 'brand' | 'process' | 'issue' | 'custom';
  confidence: number;
  created_by: string;
  verified: boolean;
  inserted_at: string;
  ai_detection_data?: any;
  metadata?: {
    ai_supervised?: boolean;
    part_number?: string;
    brand?: string;
    size_spec?: string;
    category?: string;
    estimated_cost?: number;
    work_session?: string;
    user_notes?: string;
    confidence_score?: number;
    connected_receipt_id?: string;
    receipt_vendor?: string;
    receipt_amount?: number;
    match_score?: number;
    vendor_links?: Array<{
      vendor: string;
      url: string;
      price?: number;
    }>;
  };
  source_type?: 'manual' | 'ai';
  sellable?: boolean;
  
  // Parts Marketplace Fields
  oem_part_number?: string;
  aftermarket_part_numbers?: string[];
  part_description?: string;
  fits_vehicles?: string[];
  suppliers?: Array<{
    supplier_id: string;
    supplier_name: string;
    price_cents: number;
    url: string;
    in_stock: boolean;
    shipping_days?: number;
  }>;
  lowest_price_cents?: number;
  highest_price_cents?: number;
  price_last_updated?: string;
  is_shoppable?: boolean;
  affiliate_links?: any[];
  condition?: 'new' | 'used' | 'remanufactured' | 'unknown';
  warranty_info?: string;
  install_difficulty?: 'easy' | 'moderate' | 'hard' | 'expert';
  estimated_install_time_minutes?: number;
}

interface ImageLightboxProps {
  imageUrl: string;
  imageId?: string;
  timelineEventId?: string;
  vehicleId?: string;
  isOpen: boolean;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  canEdit?: boolean;
  title?: string;
  description?: string;
}

const ImageLightbox = ({
  imageUrl,
  imageId,
  timelineEventId,
  vehicleId,
  isOpen,
  onClose,
  onNext,
  onPrev,
  canEdit = true,
  title,
  description
}: ImageLightboxProps) => {
  // Use unified tag system
  const {
    tags,
    loading: tagsLoading,
    verifyTag: verifyTagFn,
    rejectTag: rejectTagFn,
    triggerAIAnalysis: triggerAIAnalysisFn,
    createTag: createTagFn,
    loadTags,
    canEdit: userCanEdit
  } = useImageTags(imageId);

  const [imageLoaded, setImageLoaded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [isTagging, setIsTagging] = useState(false);
  const [tagView, setTagView] = useState<'off' | 'ai' | 'manual' | 'all'>('all');
  const [session, setSession] = useState<any>(null);
  const [showTagInput, setShowTagInput] = useState(false);
  const [currentSelection, setCurrentSelection] = useState<{x: number, y: number, width: number, height: number} | null>(null);
  const [dragStart, setDragStart] = useState<{x: number, y: number} | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagType, setTagType] = useState<'part' | 'tool' | 'brand' | 'process' | 'issue' | 'custom'>('part');
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Get session for manual tagging
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Parts marketplace state
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [enrichmentModalOpen, setEnrichmentModalOpen] = useState(false);
  const [selectedPart, setSelectedPart] = useState<any>(null);
  const [selectedTagForEnrichment, setSelectedTagForEnrichment] = useState<any>(null);

  const handleBuyPart = useCallback((supplier: any, partNumber: string) => {
    setSelectedPart({
      name: partNumber,
      partNumber,
      supplier,
      vehicleId,
      imageTagId: null
    });
    setCheckoutModalOpen(true);
  }, [vehicleId]);

  const handleEnrichPart = useCallback((tagId: string) => {
    const tag = tags.find(t => t.id === tagId);
    if (tag) {
      setSelectedTagForEnrichment({
        id: tag.id,
        tag_name: tag.tag_name,
        vehicle_id: vehicleId
      });
      setEnrichmentModalOpen(true);
    }
  }, [tags, vehicleId]);

  const handlePurchaseSuccess = useCallback((purchaseId: string) => {
    console.log('Purchase successful:', purchaseId);
  }, []);

  const handleEnrichmentSave = useCallback(() => {
    loadTags();
  }, [loadTags]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        // Allow Enter and Escape in inputs
        if (e.key === 'Enter' || e.key === 'Escape') {
          return; // Let input handler deal with it
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (onPrev) onPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (onNext) onNext();
          break;
        case 't':
        case 'T':
          e.preventDefault();
          if (canEdit && session) {
            setIsTagging(prev => !prev);
            setShowTagInput(false);
            setCurrentSelection(null);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onPrev, onNext, canEdit, session]);

  // Simplified handlers using unified service
  const handleVerifyTag = async (tagId: string) => {
    await verifyTagFn(tagId);
  };

  const handleRejectTag = async (tagId: string) => {
    await rejectTagFn(tagId);
  };

  const handleAIAnalysis = async () => {
    if (!imageUrl || !vehicleId) return;
    setAnalyzing(true);
    const result = await triggerAIAnalysisFn(imageUrl, vehicleId);
    setAnalyzing(false);
    if (!result.success) {
      alert(`AI analysis failed: ${result.error || 'Unknown error'}`);
    }
  };

  const getImageCoordinates = (clientX: number, clientY: number) => {
    if (!imageRef.current || !containerRef.current) return null;

    const imageRect = imageRef.current.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();

    // Calculate relative position within the image
    const x = ((clientX - imageRect.left) / imageRect.width) * 100;
    const y = ((clientY - imageRect.top) / imageRect.height) * 100;

    // Ensure coordinates are within bounds
    if (x < 0 || x > 100 || y < 0 || y > 100) return null;

    return { x, y };
  };

  // Tag filtering: Off / AI (unverified) / Manual (verified) / All - Memoized for performance
  const visibleTags = useMemo(() => {
    const filterTag = (t: any) => {
      if (tagView === 'off') return false;
      if (tagView === 'ai') return t.verified === false;
      if (tagView === 'manual') return t.verified === true;
      return true;
    };
    return tags.filter(filterTag);
  }, [tags, tagView]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isTagging || !canEdit) return;

    const coords = getImageCoordinates(e.clientX, e.clientY);
    if (coords) {
      setDragStart(coords);
      setCurrentSelection(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isTagging || !canEdit || !dragStart) return;

    const coords = getImageCoordinates(e.clientX, e.clientY);
    if (coords) {
      const width = Math.abs(coords.x - dragStart.x);
      const height = Math.abs(coords.y - dragStart.y);
      const x = Math.min(coords.x, dragStart.x);
      const y = Math.min(coords.y, dragStart.y);

      setCurrentSelection({ x, y, width, height });
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isTagging || !canEdit || !dragStart || !currentSelection) {
      setDragStart(null);
      setCurrentSelection(null);
      return;
    }

    // Only create a tag if the selection is large enough
    if (currentSelection.width > 2 && currentSelection.height > 2) {
      setShowTagInput(true);
    } else {
      setCurrentSelection(null);
    }

    setDragStart(null);
  };

  const createTag = async () => {
    if (!currentSelection || !tagName.trim() || !session?.user || !imageId || !vehicleId) return;

    try {
      const tagData = {
        tag_name: tagName.trim(),
        tag_type: tagType,
        x_position: currentSelection.x,
        y_position: currentSelection.y,
        width: currentSelection.width,
        height: currentSelection.height
      };

      // Use hook's createTag function
      await createTagFn(vehicleId, tagData);
        
      // Reset form
      setTagName('');
      setShowTagInput(false);
      setCurrentSelection(null);
      
      // Show success feedback
      if (navigator.vibrate) {
        navigator.vibrate(20);
      }
    } catch (error) {
      console.error('Error creating tag:', error);
    }
  };

  // Handle adding tag from quick input (bottom panel)
  const handleAddTag = async (tagNameInput: string) => {
    if (!tagNameInput.trim() || !vehicleId || !imageId) return;

    try {
      // Create non-spatial tag
      await createTagFn(vehicleId, {
        tag_name: tagNameInput.trim(),
        tag_type: 'custom'
      });
    } catch (error) {
      console.error('Error adding tag:', error);
    }
  };

  const updateTimelineEventTags = async (eventId: string) => {
    try {
      // Get all tags for this image
      const { data: allTags } = await supabase
        .from('image_tags')
        .select('tag_name, tag_type')
        .eq('timeline_event_id', eventId);

      if (allTags) {
        const manualTags = allTags.map(tag => tag.tag_name);

        // Update the timeline event with the new tags
        await supabase
          .from('vehicle_timeline_events')
          .update({ manual_tags: manualTags })
          .eq('id', eventId);
      }
    } catch (error) {
      console.error('Error updating timeline event tags:', error);
    }
  };

  const deleteTag = async (tagId: string) => {
    if (!session?.user || !canEdit) return;

    try {
      const { error } = await supabase
        .from('image_tags')
        .delete()
        .eq('id', tagId)
        .eq('created_by', session.user.id); // Only allow deletion of own tags

      if (!error) {
        // Reload tags from hook
        await loadTags();

        if (timelineEventId) {
          await updateTimelineEventTags(timelineEventId);
        }
      }
    } catch (error) {
      console.error('Error deleting tag:', error);
    }
  };

  const setAsPrimary = async () => {
    if (!session?.user || !canEdit || !vehicleId || !imageId) return;

    try {
      // First, remove primary from all images for this vehicle
      await supabase
        .from('vehicle_images')
        .update({ is_primary: false })
        .eq('vehicle_id', vehicleId);

      // Then set this image as primary
      const { error } = await supabase
        .from('vehicle_images')
        .update({ is_primary: true })
        .eq('id', imageId);

      if (!error) {
        console.log('Successfully set as primary image');
        // Could add toast notification here
      }
    } catch (error) {
      console.error('Error setting primary image:', error);
    }
  };

  const getTagColor = (type: string) => {
    switch (type) {
      case 'part': return '#2a2a2a';
      case 'tool': return '#424242';
      case 'brand': return '#008000'; // Win95 green
      case 'process': return '#800080'; // Win95 purple
      case 'issue': return '#ff0000'; // Win95 red
      default: return '#808080'; // Win95 grey
    }
  };

  const suggestedTags = {
    part: ['Engine', 'Transmission', 'Suspension', 'Brakes', 'Exhaust', 'Interior', 'Body Panel'],
    tool: ['Wrench', 'Screwdriver', 'Jack', 'Lift', 'Welder', 'Grinder', 'Drill'],
    brand: ['Snap-On', 'Mac Tools', 'Craftsman', 'Milwaukee', 'DeWalt', 'Proto'],
    process: ['Installation', 'Removal', 'Cleaning', 'Painting', 'Welding', 'Testing'],
    issue: ['Rust', 'Damage', 'Wear', 'Leak', 'Crack', 'Missing'],
    custom: []
  };

  if (!isOpen) return null;

  // Render lightbox as portal at document root to escape parent div constraints
  return createPortal(
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.9)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '20px'
    }}>
      {/* Navigation and Controls */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        right: '20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 10001
      }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {onPrev && (
            <button
              onClick={onPrev}
              className="button button-secondary"
              style={{ color: 'white', background: 'rgba(255, 255, 255, 0.2)' }}
            >
              ← Previous
            </button>
          )}
          {onNext && (
            <button
              onClick={onNext}
              className="button button-secondary"
              style={{ color: 'white', background: 'rgba(255, 255, 255, 0.2)' }}
            >
              Next →
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {canEdit && session && (
          <>
            <button
              onClick={() => {
                setIsTagging(!isTagging);
                setShowTagInput(false);
                setCurrentSelection(null);
              }}
              className="button"
              style={{
                fontSize: '8pt',
                fontFamily: 'Arial, sans-serif',
                background: isTagging ? '#424242' : 'rgba(255, 255, 255, 0.2)',
                color: isTagging ? 'white' : 'white',
                border: '1px solid rgba(255, 255, 255, 0.5)',
                borderRadius: '0px',
                padding: '4px 8px'
              }}
            >
              {isTagging ? '✓ Manual' : '🏷️ Tag'}
            </button>

              <button
              onClick={handleAIAnalysis}
              disabled={analyzing}
              className="button"
              style={{
                fontSize: '8pt',
                fontFamily: 'Arial, sans-serif',
                background: analyzing ? '#666' : 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.5)',
                borderRadius: '0px',
                padding: '4px 8px'
              }}
            >
              {analyzing ? '🔄 AI...' : '🤖 AI Tag'}
            </button>
          </>
        )}

        {/* Tag layer control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'white', fontSize: '10px' }}>Tags:</span>
          <select
            value={tagView}
            onChange={(e) => setTagView(e.target.value as any)}
            style={{
              fontSize: '10px',
              background: 'rgba(255,255,255,0.2)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 0,
              padding: '2px 4px'
            }}
            title="Toggle visible tags"
          >
            <option value="off">Off</option>
            <option value="ai">AI</option>
            <option value="manual">Manual</option>
            <option value="all">All</option>
          </select>
        </div>
        {/* Set as Primary button */}
        {canEdit && session && vehicleId && imageId && (
            <button
              onClick={setAsPrimary}
              className="button button-secondary"
              style={{
                color: 'white',
                background: '#008000',
                border: '1px solid #008000'
              }}
              title="Set as primary image for this vehicle"
            >
              ⭐ Set Primary
            </button>
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          className="button button-secondary"
          style={{ color: 'white', background: 'rgba(255, 255, 255, 0.1)' }}
          title="Close"
        >
          ✕ Close
        </button>
        </div>
      </div>

      {/* Image Container */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isTagging ? 'crosshair' : 'default'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <img
          ref={imageRef}
          src={imageUrl}
          alt="Lightbox"
          onLoad={() => setImageLoaded(true)}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            userSelect: 'none',
            pointerEvents: isTagging ? 'none' : 'auto'
          }}
        />

        {/* Tag Overlays on Image - Windows 95 Style */}
        {imageLoaded && visibleTags.filter(tag => tag.x_position != null && tag.y_position != null).map(tag => (
          <div
            key={tag.id}
            style={{
              position: 'absolute',
              left: `${tag.x_position}%`,
              top: `${tag.y_position}%`,
              width: `${tag.width || 15}%`,
              height: `${tag.height || 15}%`,
              border: tag.verified ? '2px solid #ffff00' : '2px dashed #ff0000',
              background: tag.verified ? 'rgba(255,255,0,0.1)' : 'rgba(255,0,0,0.1)',
              pointerEvents: 'auto',
              cursor: 'pointer'
            }}
          >
            {/* Tag Label - Windows 95 Tooltip Style */}
            <div style={{
              position: 'absolute',
              top: '-22px',
              left: '0',
              background: '#ffffe1',
              color: '#000000',
              padding: '2px 4px',
              border: '1px solid #000000',
              fontSize: '11px',
              fontWeight: 'normal',
              whiteSpace: 'nowrap',
              fontFamily: '"MS Sans Serif", sans-serif',
              boxShadow: '1px 1px 0 #808080'
            }}>
              {tag.tag_name}
              {tag.metadata?.part_number && ` (${tag.metadata.part_number})`}
            </div>
          </div>
        ))}

        {/* Current Selection */}
        {currentSelection && (
          <div style={{
            position: 'absolute',
            left: `${currentSelection.x}%`,
            top: `${currentSelection.y}%`,
            width: `${currentSelection.width}%`,
            height: `${currentSelection.height}%`,
            border: '2px dashed #2a2a2a',
            background: 'rgba(42, 42, 42, 0.2)',
            pointerEvents: 'none'
          }} />
        )}
      </div>

      {/* Tags Sidebar - Windows 95 Style - Responsive */}
      <div style={{
        position: isMobile ? 'fixed' : 'absolute',
        right: isMobile ? '0' : '20px',
        top: isMobile ? 'auto' : '80px',
        bottom: isMobile ? '0' : 'auto',
        left: isMobile ? '0' : 'auto',
        width: isMobile ? '100%' : '300px',
        maxWidth: isMobile ? '100vw' : '300px',
        background: '#c0c0c0',
        border: '2px outset #ffffff',
        borderRight: '2px solid #808080',
        borderBottom: '2px solid #808080',
        padding: '2px',
        zIndex: 10002,
        maxHeight: isMobile ? '40vh' : 'calc(100vh - 160px)',
        fontFamily: '"MS Sans Serif", sans-serif'
      }}>
        {/* Title Bar */}
        <div style={{
          background: '#000080',
          color: '#ffffff',
          padding: '2px 4px',
          fontSize: '11px',
          fontWeight: 'bold',
          marginBottom: '2px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>Tags ({tags.length})</span>
          {canEdit && session && (
            <button
              onClick={() => setIsTagging(!isTagging)}
              style={{
                background: isTagging ? '#ffffff' : 'transparent',
                color: isTagging ? '#000000' : '#ffffff',
                border: 'none',
                padding: '1px 4px',
                fontSize: '10px',
                cursor: 'pointer',
                fontFamily: '"MS Sans Serif", sans-serif'
              }}
            >
              {isTagging ? 'STOP' : 'ADD'}
            </button>
          )}
        </div>
        
        {/* Manual Tagging Instructions */}
        {isTagging && (
          <div style={{
            background: '#ffffe1',
            border: '1px solid #000000',
            padding: '4px',
            fontSize: '10px',
            color: '#000000',
            marginBottom: '2px'
          }}>
            Click and drag on image to tag a region
          </div>
        )}
        
        {/* Current Selection Input */}
        {showTagInput && currentSelection && (
          <div style={{
            background: '#ffffff',
            border: '1px inset #808080',
            padding: '4px',
            marginBottom: '2px'
          }}>
            <div style={{ fontSize: '10px', marginBottom: '2px', fontWeight: 'bold' }}>
              New Tag:
            </div>
            <input
              type="text"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="Enter tag name..."
              autoFocus
              onKeyPress={(e) => {
                if (e.key === 'Enter') createTag();
                if (e.key === 'Escape') {
                  setShowTagInput(false);
                  setCurrentSelection(null);
                }
              }}
              style={{
                width: '100%',
                padding: '2px',
                border: '1px inset #808080',
                fontSize: '11px',
                fontFamily: '"MS Sans Serif", sans-serif',
                marginBottom: '2px'
              }}
            />
            <select
              value={tagType}
              onChange={(e) => setTagType(e.target.value as any)}
              style={{
                width: '100%',
                padding: '2px',
                border: '1px inset #808080',
                fontSize: '11px',
                fontFamily: '"MS Sans Serif", sans-serif',
                marginBottom: '2px'
              }}
            >
              <option value="part">Part</option>
              <option value="tool">Tool</option>
              <option value="brand">Brand</option>
              <option value="process">Process</option>
              <option value="issue">Damage</option>
              <option value="custom">Custom</option>
            </select>
            <div style={{ display: 'flex', gap: '2px' }}>
              <button
                onClick={() => {
                  setShowTagInput(false);
                  setCurrentSelection(null);
                }}
                style={{
                  flex: 1,
                  padding: '2px 4px',
                  background: '#c0c0c0',
                  border: '1px outset #ffffff',
                  fontSize: '10px',
                  cursor: 'pointer',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              >
                Cancel
              </button>
              <button
                onClick={createTag}
                disabled={!tagName.trim()}
                style={{
                  flex: 1,
                  padding: '2px 4px',
                  background: tagName.trim() ? '#c0c0c0' : '#808080',
                  border: tagName.trim() ? '1px outset #ffffff' : '1px inset #808080',
                  fontSize: '10px',
                  cursor: tagName.trim() ? 'pointer' : 'not-allowed',
                  fontFamily: '"MS Sans Serif", sans-serif',
                  color: tagName.trim() ? '#000000' : '#c0c0c0'
                }}
              >
                Save
              </button>
            </div>
          </div>
        )}
          
        {/* AI Analyze Button */}
        {canEdit && session && !tagsLoading && tags.length === 0 && (
          <div style={{ padding: '4px', marginBottom: '2px' }}>
            <button
              onClick={handleAIAnalysis}
              disabled={analyzing}
              style={{
                width: '100%',
                padding: '6px',
                background: analyzing ? '#808080' : '#c0c0c0',
                border: analyzing ? '1px inset #808080' : '1px outset #ffffff',
                fontSize: '11px',
                cursor: analyzing ? 'not-allowed' : 'pointer',
                fontFamily: '"MS Sans Serif", sans-serif',
                color: '#000000',
                fontWeight: 'bold'
              }}
            >
              {analyzing ? 'Analyzing...' : 'AI Analyze'}
            </button>
          </div>
        )}
          
        {/* Tags List */}
        <div style={{ 
          background: '#ffffff',
          border: '1px inset #808080',
          padding: '4px',
          maxHeight: 'calc(100vh - 280px)',
          overflowY: 'auto'
        }}>
          {!session && tags.length > 0 && (
            <div style={{
              background: '#ffffe1',
              border: '1px solid #000000',
              padding: '6px',
              margin: '4px',
              fontSize: '8pt',
              fontFamily: '"MS Sans Serif", sans-serif'
            }}>
              <strong>Login to add/verify tags</strong>
            </div>
          )}
          
          {tags.length === 0 ? (
            <div style={{
              textAlign: 'center',
              color: '#808080',
              fontSize: '10px',
              padding: '12px',
              fontFamily: '"MS Sans Serif", sans-serif'
            }}>
              No tags yet.
              {canEdit && session && <><br/>Click ADD to create tags<br/>or AI Analyze to detect parts.</>}
              {!session && <><br/>Login to create tags</>}
            </div>
          ) : (
            tags.map(tag => (
              <ShoppablePartTag
                key={tag.id}
                tag={tag as any}
                onBuy={handleBuyPart}
                onEnrichPart={handleEnrichPart}
              />
            ))
          )}
        </div>
      </div>

      {/* Image Info */}
      {(title || description) && (
        <div style={{
          position: 'absolute',
          bottom: isMobile ? '42vh' : '20px',
          left: '20px',
          right: isMobile ? '20px' : (tags.length > 0 ? '340px' : '20px'),
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '16px',
          borderRadius: '0px',
          maxWidth: isMobile ? '100%' : '600px',
          margin: '0 auto'
        }}>
          {title && (
            <h4 className="heading-4" style={{ margin: '0 0 8px 0', color: 'white' }}>
              {title}
            </h4>
          )}
          {description && (
            <p className="text" style={{ margin: 0, color: '#e5e7eb' }}>
              {description}
            </p>
          )}

          {tags.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '6px' }}>
                Tags: {tags.length}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {tags.map(tag => (
                  <span
                    key={tag.id}
                    style={{
                      background: getTagColor(tag.tag_type),
                      color: 'white',
                      padding: '2px 6px',
                      borderRadius: '0px',
                      fontSize: '9pt'
                    }}
                  >
                    {tag.tag_name}
                  </span>
                ))}
              </div>

              {/* User Input Area for Tag Quality Improvement - Only show if logged in */}
              {session && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>
                    Add or correct tags to improve data quality:
                  </div>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder="Enter tag name..."
                      style={{
                        flex: 1,
                        padding: '4px 6px',
                        fontSize: '9pt',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        borderRadius: '0px',
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: 'white'
                      }}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          handleAddTag(e.currentTarget.value.trim());
                          e.currentTarget.value = '';
                        }
                      }}
                    />
                    <button
                      style={{
                        padding: '4px 8px',
                        fontSize: '8pt',
                        background: 'rgba(42, 42, 42, 0.8)',
                        border: 'none',
                        borderRadius: '0px',
                        color: 'white',
                        cursor: 'pointer'
                      }}
                      onClick={(e) => {
                        const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                        if (input && input.value.trim()) {
                          handleAddTag(input.value.trim());
                          input.value = '';
                        }
                      }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
              
              {/* Login prompt if not logged in */}
              {!session && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px',
                  background: 'rgba(255, 255, 225, 0.2)',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  fontSize: '8pt',
                  color: '#ffffe1',
                  textAlign: 'center'
                }}>
                  Login to add tags
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      {isTagging && canEdit && !isMobile && (
        <div style={{
          position: 'absolute',
          top: '80px',
          left: '20px',
          background: 'rgba(42, 42, 42, 0.9)',
          color: 'white',
          padding: '12px',
          borderRadius: '0px',
          fontSize: '8pt'
        }}>
          📝 Click and drag to select an area to tag
        </div>
      )}
      
      {/* Loading State */}
      {!imageLoaded && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          color: 'white'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '4px solid rgba(255, 255, 255, 0.3)',
            borderTop: '4px solid white',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 12px'
          }} />
          <p style={{ fontSize: '8pt', margin: 0 }}>Loading image...</p>
        </div>
      )}

      {/* Part Checkout Modal */}
      {checkoutModalOpen && selectedPart && (
        <PartCheckoutModal
          part={selectedPart}
          isOpen={checkoutModalOpen}
          onClose={() => setCheckoutModalOpen(false)}
          onSuccess={handlePurchaseSuccess}
        />
      )}

      {/* Part Enrichment Modal */}
      {enrichmentModalOpen && selectedTagForEnrichment && (
        <PartEnrichmentModal
          tag={selectedTagForEnrichment}
          isOpen={enrichmentModalOpen}
          onClose={() => setEnrichmentModalOpen(false)}
          onSave={handleEnrichmentSave}
        />
      )}
    </div>,
    document.body
  );
};

export default ImageLightbox;