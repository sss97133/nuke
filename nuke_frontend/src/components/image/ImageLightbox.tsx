import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useImageTags } from '../../hooks/useImageTags';
import type { Tag } from '../../services/tagService';
import { MobileImageControls, MobileFloatingActions } from './MobileImageControls';
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
    canEdit: userCanEdit
  } = useImageTags(imageId);

  const [imageLoaded, setImageLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
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

  // Get session for manual tagging
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

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

  // Tag filtering: Off / AI (unverified) / Manual (verified) / All
  const filterTag = (t: ImageTag) => {
    if (tagView === 'off') return false;
    if (tagView === 'ai') return t.verified === false;
    if (tagView === 'manual') return t.verified === true;
    return true;
  };
  const visibleTags = tags.filter(filterTag);

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

      const { data, error } = await supabase
        .from('image_tags')
        .insert([{
          image_id: imageId,
          vehicle_id: vehicleId,
          timeline_event_id: timelineEventId,
          tag_name: tagData.tag_name,
          tag_type: tagData.tag_type,
          x_position: tagData.x_position,
          y_position: tagData.y_position,
          width: tagData.width,
          height: tagData.height,
          source_type: 'manual',
          confidence: 100,
          verified: true,
          created_by: session.user.id,
          metadata: {}
        }])
        .select()
        .single();

      if (!error && data) {
        // Reload tags to show new one
        const { tags: refreshedTags } = await import('../../hooks/useImageTags');
        
        // Reset form
        setTagName('');
        setShowTagInput(false);
        setCurrentSelection(null);
        
        // Show success feedback
        if (navigator.vibrate) {
          navigator.vibrate(20);
        }
      } else {
        console.error('Error creating tag:', error);
        alert('Failed to create tag. Please try again.');
      }
    } catch (error) {
      console.error('Error creating tag:', error);
      alert('Failed to create tag. Please try again.');
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
          .from('timeline_events')
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
        setTags(prev => prev.filter(tag => tag.id !== tagId));

        if (timelineEventId) {
          await updateTimelineEventTags(timelineEventId);
        }
      }
    } catch (error) {
      console.error('Error deleting tag:', error);
    }
  };

  const getTagColor = (type: string) => {
    switch (type) {
      case 'part': return '#3b82f6';
      case 'tool': return '#f59e0b';
      case 'brand': return '#10b981';
      case 'process': return '#8b5cf6';
      case 'issue': return '#ef4444';
      default: return '#6b7280';
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

  return (
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
              style={{ color: 'white', background: 'rgba(255, 255, 255, 0.1)' }}
            >
              ← Previous
            </button>
          )}
          {onNext && (
            <button
              onClick={onNext}
              className="button button-secondary"
              style={{ color: 'white', background: 'rgba(255, 255, 255, 0.1)' }}
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
                background: isTagging ? '#424242' : 'rgba(255, 255, 255, 0.1)',
                color: isTagging ? 'white' : 'white',
                border: '1px solid rgba(255, 255, 255, 0.3)',
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
                background: analyzing ? '#666' : 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.3)',
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
              background: 'rgba(255,255,255,0.1)',
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
            border: '2px dashed #3b82f6',
            background: 'rgba(59, 130, 246, 0.2)',
            pointerEvents: 'none'
          }} />
        )}
      </div>

      {/* Tags Sidebar - Windows 95 Style - ALWAYS SHOW */}
      <div style={{
        position: 'absolute',
        right: '20px',
        top: '80px',
        width: '300px',
        background: '#c0c0c0',
        border: '2px outset #ffffff',
        borderRight: '2px solid #808080',
        borderBottom: '2px solid #808080',
        padding: '2px',
        zIndex: 10002,
        maxHeight: 'calc(100vh - 160px)',
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
            </div>
          ) : (
            tags.map(tag => (
              <div key={tag.id} style={{
                background: tag.verified ? '#c0c0c0' : '#ffffff',
                border: '1px solid #808080',
                padding: '4px',
                marginBottom: '4px',
                fontSize: '11px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                  <span style={{
                    display: 'inline-block',
                    width: '10px',
                    height: '10px',
                    background: tag.source_type === 'ai' ? '#000080' : '#008080',
                    border: '1px solid #000000'
                  }} />
                  <span style={{ fontWeight: 'bold', color: '#000000' }}>
                    {tag.tag_name}
                  </span>
                  {tag.verified && (
                    <span style={{ 
                      background: '#008000',
                      color: '#ffffff',
                      padding: '0 3px',
                      fontSize: '9px',
                      fontWeight: 'bold'
                    }}>OK</span>
                  )}
                </div>
                    
                {/* Part Details */}
                {(tag.metadata?.part_number || tag.metadata?.brand) && (
                  <div style={{ color: '#000000', fontSize: '10px', marginBottom: '2px' }}>
                    {tag.metadata?.part_number && `Part#: ${tag.metadata.part_number}`}
                    {tag.metadata?.part_number && tag.metadata?.brand && ' | '}
                    {tag.metadata?.brand}
                  </div>
                )}
                
                {/* Cost */}
                {tag.metadata?.estimated_cost && (
                  <div style={{ color: '#008000', fontSize: '10px', fontWeight: 'bold' }}>
                    ${tag.metadata.estimated_cost}
                  </div>
                )}
                
                {/* Vendor Links */}
                {tag.metadata?.vendor_links && tag.metadata.vendor_links.length > 0 && (
                  <div style={{ marginTop: '4px', display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
                    {tag.metadata.vendor_links.map((link: any, idx: number) => (
                      <a
                        key={idx}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          padding: '1px 4px',
                          background: '#c0c0c0',
                          color: '#000000',
                          textDecoration: 'none',
                          fontSize: '9px',
                          border: '1px outset #ffffff',
                          fontFamily: '"MS Sans Serif", sans-serif'
                        }}
                      >
                        {link.vendor}
                      </a>
                    ))}
                  </div>
                )}
                
                {/* Verify/Reject Buttons - AI tags only */}
                {!tag.verified && tag.source_type === 'ai' && tag.metadata?.ai_supervised === true && (
                  <div style={{ marginTop: '4px', display: 'flex', gap: '2px' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleVerifyTag(tag.id); }}
                      style={{
                        padding: '2px 6px',
                        background: '#c0c0c0',
                        color: '#000000',
                        border: '1px outset #ffffff',
                        fontSize: '10px',
                        cursor: 'pointer',
                        fontFamily: '"MS Sans Serif", sans-serif'
                      }}
                    >
                      Verify
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRejectTag(tag.id); }}
                      style={{
                        padding: '2px 6px',
                        background: '#c0c0c0',
                        color: '#000000',
                        border: '1px outset #ffffff',
                        fontSize: '10px',
                        cursor: 'pointer',
                        fontFamily: '"MS Sans Serif", sans-serif'
                      }}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Image Info */}
      {(title || description) && (
        <div style={{
          position: 'absolute',
          bottom: '20px',
          left: '20px',
          right: '20px',
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '16px',
          borderRadius: '8px',
          maxWidth: '600px',
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
                      borderRadius: '4px',
                      fontSize: '11px'
                    }}
                  >
                    {tag.tag_name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      {isTagging && canEdit && (
        <div style={{
          position: 'absolute',
          top: '80px',
          left: '20px',
          background: 'rgba(59, 130, 246, 0.9)',
          color: 'white',
          padding: '12px',
          borderRadius: '8px',
          fontSize: '14px'
        }}>
          📝 Click and drag to select an area to tag
        </div>
      )}
    </div>
  );
};

export default ImageLightbox;