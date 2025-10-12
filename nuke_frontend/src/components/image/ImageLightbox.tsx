import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useImageAnalysis } from '../../hooks/useImageAnalysis';
import '../../design-system.css';

interface ImageTag {
  id: string;
  tag_name: string;
  x_position: number;
  y_position: number;
  width: number;
  height: number;
  tag_type: 'part' | 'tool' | 'brand' | 'process' | 'issue' | 'custom';
  confidence: number;
  created_by: string;
  verified: boolean;
  created_at: string;
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
  const [tags, setTags] = useState<ImageTag[]>([]);
  const [isTagging, setIsTagging] = useState(false);
  const [tagType, setTagType] = useState<'part' | 'tool' | 'brand' | 'process' | 'issue' | 'custom'>('part');
  const [tagName, setTagName] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [dragStart, setDragStart] = useState<{x: number, y: number} | null>(null);
  const [currentSelection, setCurrentSelection] = useState<{x: number, y: number, width: number, height: number} | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [showAITags, setShowAITags] = useState(false);
  const [tagView, setTagView] = useState<'off' | 'ai' | 'manual' | 'all'>('all');
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    analyzing,
    analysisProgress,
    analyzeImage,
    getSuggestedTags,
    verifyAITag,
    rejectAITag
  } = useImageAnalysis();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  useEffect(() => {
    if (isOpen && (imageId || timelineEventId)) {
      loadImageTags();
    }
  }, [isOpen, imageId, timelineEventId, imageUrl]);

  const loadImageTags = async () => {
    try {
      let query = supabase
        .from('image_tags')
        .select(`
          id,
          tag_name,
          x_position,
          y_position,
          width,
          height,
          tag_type,
          confidence,
          created_by,
          verified,
          created_at,
          ai_detection_data
        `);

      if (imageId) {
        query = query.eq('image_id', imageId);
      } else if (timelineEventId) {
        query = query.eq('timeline_event_id', timelineEventId);
      } else {
        query = query.eq('image_url', imageUrl);
      }

      const { data: imageTags, error } = await query.order('created_at', { ascending: false });

      if (!error && imageTags) {
        setTags(imageTags);
      }
    } catch (error) {
      console.error('Error loading image tags:', error);
    }
  };

  const handleAIAnalysis = async () => {
    if (!imageUrl) return;

    try {
      const result = await analyzeImage(imageUrl, timelineEventId, vehicleId);

      if (result.success) {
        // Reload tags to show new AI-generated ones
        await loadImageTags();
        setShowAITags(true);
      } else {
        alert(`AI analysis failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('AI analysis error:', error);
      alert('Failed to analyze image. Please try again.');
    }
  };

  const handleVerifyTag = async (tagId: string) => {
    if (!session?.user) return;

    const success = await verifyAITag(tagId, session.user.id);
    if (success) {
      await loadImageTags(); // Reload to show updated verification status
    }
  };

  const handleRejectTag = async (tagId: string) => {
    const success = await rejectAITag(tagId);
    if (success) {
      await loadImageTags(); // Reload to remove rejected tag
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
    if (!currentSelection || !tagName.trim() || !session?.user) return;

    try {
      const tagData = {
        image_id: imageId,
        timeline_event_id: timelineEventId,
        vehicle_id: vehicleId,
        image_url: imageUrl,
        tag_name: tagName.trim(),
        tag_type: tagType,
        x_position: currentSelection.x,
        y_position: currentSelection.y,
        width: currentSelection.width,
        height: currentSelection.height,
        confidence: 100,
        created_by: session.user.id
      };

      const { error } = await supabase
        .from('image_tags')
        .insert([tagData]);

      if (!error) {
        // Add to local state immediately
        const newTag: ImageTag = {
          id: crypto.randomUUID(),
          ...tagData,
          verified: true,
          created_at: new Date().toISOString()
        };
        setTags(prev => [...prev, newTag]);

        // Reset form
        setTagName('');
        setShowTagInput(false);
        setCurrentSelection(null);
        setIsTagging(false);

        // Update timeline event tags if applicable
        if (timelineEventId) {
          await updateTimelineEventTags(timelineEventId);
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

        {/* Existing Tags */}
        {imageLoaded && visibleTags.map(tag => (
          <div
            key={tag.id}
            style={{
              position: 'absolute',
              left: `${tag.x_position}%`,
              top: `${tag.y_position}%`,
              width: `${tag.width}%`,
              height: `${tag.height}%`,
              border: `2px ${tag.verified ? 'solid' : 'dashed'} ${getTagColor(tag.tag_type)}`,
              background: `${getTagColor(tag.tag_type)}20`,
              pointerEvents: 'auto'
            }}
          >
            {/* Tag Label */}
            <div style={{
              position: 'absolute',
              top: '-24px',
              left: '0',
              background: getTagColor(tag.tag_type),
              color: 'white',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              {tag.tag_name}
              {canEdit && tag.created_by === session?.user?.id && (
                <button
                  onClick={() => deleteTag(tag.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '10px',
                    padding: '0',
                    marginLeft: '4px'
                  }}
                >
                  ✕
                </button>
              )}
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

      {/* Tag Input Modal */}
      {showTagInput && currentSelection && (
        <div style={{
          position: 'absolute',
          right: '20px',
          top: '60px',
          width: '280px',
          background: '#f8f9fa',
          borderRadius: '0px',
          border: '1px solid #bdbdbd',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          padding: '8px',
          zIndex: 10002,
          fontFamily: 'Arial, sans-serif'
        }}>
          <h4 style={{
            margin: '0 0 6px 0',
            fontSize: '8pt',
            fontWeight: '600',
            color: '#424242'
          }}>Image Tagging</h4>

          <button style={{
            width: '100%',
            background: '#424242',
            color: 'white',
            border: 'none',
            padding: '4px 6px',
            borderRadius: '0px',
            fontSize: '8pt',
            fontWeight: '600',
            cursor: 'pointer',
            marginBottom: '6px'
          }}>
            ✓ Tagging Mode ON
          </button>

          <div style={{
            padding: '6px',
            background: '#e7f3ff',
            borderRadius: '0px',
            border: '1px solid #b8daff',
            marginBottom: '6px'
          }}>
            <label style={{
              display: 'block',
              fontSize: '8pt',
              fontWeight: '600',
              color: '#424242',
              marginBottom: '3px'
            }}>
              TAG TYPE
            </label>
            <select
              value={tagType}
              onChange={(e) => setTagType(e.target.value as any)}
              style={{
                width: '100%',
                padding: '3px 4px',
                border: '1px solid #bdbdbd',
                borderRadius: '0px',
                fontSize: '8pt',
                marginBottom: '4px'
              }}
            >
              <option value="part">Part</option>
              <option value="tool">Tool</option>
              <option value="brand">Brand</option>
              <option value="process">Process</option>
              <option value="issue">Damage</option>
              <option value="custom">Modification</option>
            </select>
            <div style={{
              fontSize: '8pt',
              color: '#6c757d',
              fontStyle: 'italic'
            }}>
              Click on the image to place a tag
            </div>
          </div>

          <div>
            <h5 style={{
              margin: '0 0 4px 0',
              fontSize: '8pt',
              fontWeight: '600',
              color: '#424242'
            }}>Tagged Parts ({tags.length})</h5>
            <div style={{
              padding: '6px',
              textAlign: 'center',
              color: '#6c757d',
              fontSize: '8pt'
            }}>
              {tags.length === 0 ? (
                <>No tags yet.<br/>Enable tagging and click on the image.</>
              ) : (
                tags.map(tag => (
                  <div key={tag.id} style={{
                    background: '#f5f5f5',
                    border: '1px solid #e0e0e0',
                    padding: '2px 4px',
                    marginBottom: '2px',
                    fontSize: '8pt'
                  }}>
                    {tag.tag_name}
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ marginTop: '6px' }}>
            <input
              type="text"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="Enter tag name..."
              style={{
                width: '100%',
                padding: '2px 4px',
                border: '1px solid #bdbdbd',
                borderRadius: '0px',
                fontSize: '8pt',
                marginBottom: '4px'
              }}
              autoFocus
              onKeyPress={(e) => {
                if (e.key === 'Enter') createTag();
                if (e.key === 'Escape') {
                  setShowTagInput(false);
                  setCurrentSelection(null);
                }
              }}
            />

            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => {
                  setShowTagInput(false);
                  setCurrentSelection(null);
                }}
                style={{
                  flex: 1,
                  padding: '2px 4px',
                  border: '1px solid #bdbdbd',
                  background: '#f5f5f5',
                  borderRadius: '0px',
                  fontSize: '8pt',
                  cursor: 'pointer'
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
                  border: '1px solid #bdbdbd',
                  background: tagName.trim() ? '#424242' : '#e0e0e0',
                  color: tagName.trim() ? 'white' : '#9e9e9e',
                  borderRadius: '0px',
                  fontSize: '8pt',
                  cursor: tagName.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                Add Tag
              </button>
            </div>
          </div>
        </div>
      )}

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