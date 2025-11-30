import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';
import { InputDialog } from '../common/InputDialog';

interface Tag {
  id: string;
  tag_name: string;
  tag_type: 'part' | 'tool' | 'brand' | 'process' | 'issue' | 'custom';
  source_type: 'manual' | 'ai' | 'expert';
  x_position: number;
  y_position: number;
  width: number;
  height: number;
  confidence: number;
  automated_confidence?: number;
  verified: boolean;
  validation_status: string;
  ai_detection_data?: any;
  created_by?: string;
}

interface EnhancedImageTaggerProps {
  imageUrl: string;
  vehicleId: string;
  timelineEventId?: string;
  onTagsUpdate?: (tags: Tag[]) => void;
  readonly?: boolean;
}

const EnhancedImageTagger: React.FC<EnhancedImageTaggerProps> = ({
  imageUrl,
  vehicleId,
  timelineEventId,
  onTagsUpdate,
  readonly = false
}) => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTagging, setIsTagging] = useState(false);
  const [newTagText, setNewTagText] = useState('');
  const [newTagType, setNewTagType] = useState<Tag['tag_type']>('part');
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [selectedTag, setSelectedTag] = useState<Tag | null>(null);
  const [showAITags, setShowAITags] = useState(true);
  const [showManualTags, setShowManualTags] = useState(true);
  const [correctionDialog, setCorrectionDialog] = useState<{ isOpen: boolean; tag: Tag | null }>({ isOpen: false, tag: null });

  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadTags();
  }, [imageUrl, vehicleId]);

  const loadTags = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('image_tags')
        .select('*')
        .eq('image_url', imageUrl)
        .eq('vehicle_id', vehicleId)
        .order('inserted_at', { ascending: false });

      if (error) {
        console.error('Error loading tags:', error);
        return;
      }

      const formattedTags: Tag[] = data.map(tag => ({
        id: tag.id,
        tag_name: tag.tag_name || tag.text, // Handle legacy text column
        tag_type: tag.tag_type || 'custom',
        source_type: tag.source_type || 'manual',
        x_position: tag.x_position,
        y_position: tag.y_position,
        width: tag.width || 10,
        height: tag.height || 10,
        confidence: tag.confidence || 100,
        automated_confidence: tag.automated_confidence,
        verified: tag.verified || false,
        validation_status: tag.validation_status || 'pending',
        ai_detection_data: tag.ai_detection_data,
        created_by: tag.created_by
      }));

      setTags(formattedTags);
      onTagsUpdate?.(formattedTags);

    } catch (error) {
      console.error('Error in loadTags:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTagging || readonly) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setPendingPosition({ x, y, width: 10, height: 10 });
  };

  const handleAddTag = async () => {
    if (!newTagText.trim() || !pendingPosition) return;

    try {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user?.id;

      const newTag = {
        image_url: imageUrl,
        vehicle_id: vehicleId,
        timeline_event_id: timelineEventId,
        tag_name: newTagText.trim(),
        tag_type: newTagType,
        source_type: 'manual' as const,
        x_position: pendingPosition.x,
        y_position: pendingPosition.y,
        width: pendingPosition.width,
        height: pendingPosition.height,
        confidence: 100,
        verified: true,
        validation_status: 'approved',
        created_by: userId
      };

      const { data, error } = await supabase
        .from('image_tags')
        .insert([newTag])
        .select()
        .single();

      if (error) {
        console.error('Error adding tag:', error);
        alert('Error adding tag: ' + error.message);
        return;
      }

      // Reset form
      setNewTagText('');
      setPendingPosition(null);
      setIsTagging(false);

      // Reload tags
      await loadTags();

    } catch (error) {
      console.error('Error in handleAddTag:', error);
      alert('Error adding tag: ' + error.message);
    }
  };

  const handleValidateAITag = async (tag: Tag, action: 'approve' | 'reject' | 'correct') => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user?.id;

      if (action === 'approve') {
        const { error } = await supabase
          .from('image_tags')
          .update({
            verified: true,
            validation_status: 'approved',
            verified_at: new Date().toISOString()
          })
          .eq('id', tag.id);

        if (error) throw error;

      } else if (action === 'reject') {
        const { error } = await supabase
          .from('image_tags')
          .update({
            validation_status: 'rejected',
            verified_at: new Date().toISOString()
          })
          .eq('id', tag.id);

        if (error) throw error;

      } else if (action === 'correct') {
        // Open correction dialog
        setCorrectionDialog({ isOpen: true, tag });
        return;
      }

      await loadTags();

    } catch (error) {
      console.error('Error validating tag:', error);
      alert('Error validating tag: ' + error.message);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    if (!confirm('Delete this tag?')) return;

    try {
      const { error } = await supabase
        .from('image_tags')
        .delete()
        .eq('id', tagId);

      if (error) throw error;

      await loadTags();
    } catch (error) {
      console.error('Error deleting tag:', error);
      alert('Error deleting tag: ' + error.message);
    }
  };

  const filteredTags = tags.filter(tag => {
    if (!showAITags && tag.source_type === 'ai') return false;
    if (!showManualTags && tag.source_type === 'manual') return false;
    return true;
  });

  const getTagColor = (tag: Tag) => {
    if (tag.source_type === 'ai' && !tag.verified) return '#ff9900'; // Orange for unverified AI
    if (tag.source_type === 'ai' && tag.verified) return '#0066cc'; // Blue for verified AI
    if (tag.validation_status === 'rejected') return '#cc0000'; // Red for rejected
    if (tag.validation_status === 'disputed') return '#9900cc'; // Purple for disputed
    return '#00aa00'; // Green for manual/approved
  };

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center', fontSize: '11px' }}>Loading tags...</div>;
  }

  return (
    <div style={{
      position: 'relative',
      border: '2px inset #c0c0c0',
      background: '#ffffff',
      fontFamily: 'MS Sans Serif, sans-serif',
      fontSize: '11px'
    }}>

      {/* Controls */}
      <div style={{
        background: '#c0c0c0',
        padding: '8px',
        borderBottom: '1px solid #808080',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap'
      }}>

        {/* Tagging Mode Toggle */}
        {!readonly && (
          <button
            onClick={() => setIsTagging(!isTagging)}
            style={{
              background: isTagging ? '#0066cc' : '#e0e0e0',
              color: isTagging ? 'white' : 'black',
              border: '2px outset #c0c0c0',
              padding: '4px 8px',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            {isTagging ? '✏️ Stop Tagging' : '🏷️ Add Tag'}
          </button>
        )}

        {/* Tag Type Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>Show:</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <input
              type="checkbox"
              checked={showAITags}
              onChange={e => setShowAITags(e.target.checked)}
            />
            <span style={{ color: '#ff9900' }}>AI Tags</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <input
              type="checkbox"
              checked={showManualTags}
              onChange={e => setShowManualTags(e.target.checked)}
            />
            <span style={{ color: '#00aa00' }}>Manual Tags</span>
          </label>
        </div>

        {/* Tag Count */}
        <div style={{ marginLeft: 'auto', fontSize: '10px', color: '#666' }}>
          {tags.filter(t => t.source_type === 'ai').length} AI •
          {tags.filter(t => t.source_type === 'manual').length} Manual •
          {tags.filter(t => t.verified).length} Verified
        </div>
      </div>

      {/* Image Container */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          cursor: isTagging ? 'crosshair' : 'default',
          overflow: 'hidden'
        }}
        onClick={handleImageClick}
      >
        <img
          ref={imageRef}
          src={imageUrl}
          alt="Taggable content"
          style={{
            width: '100%',
            height: 'auto',
            display: 'block'
          }}
          onLoad={() => {
            // Auto-trigger analysis on first load if no tags exist
            if (tags.length === 0 && !readonly) {
              triggerAutoAnalysis();
            }
          }}
        />

        {/* Existing Tags */}
        {filteredTags.map((tag) => (
          <div
            key={tag.id}
            style={{
              position: 'absolute',
              left: `${tag.x_position}%`,
              top: `${tag.y_position}%`,
              width: `${tag.width}%`,
              height: `${tag.height}%`,
              border: `2px solid ${getTagColor(tag)}`,
              background: `${getTagColor(tag)}20`,
              cursor: 'pointer',
              minWidth: '20px',
              minHeight: '20px'
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedTag(tag);
            }}
          />
        ))}

        {/* Pending Tag */}
        {pendingPosition && (
          <div
            style={{
              position: 'absolute',
              left: `${pendingPosition.x}%`,
              top: `${pendingPosition.y}%`,
              width: `${pendingPosition.width}%`,
              height: `${pendingPosition.height}%`,
              border: '2px dashed #0066cc',
              background: '#0066cc20',
              minWidth: '20px',
              minHeight: '20px'
            }}
          />
        )}

        {/* Tag Labels */}
        {filteredTags.map((tag) => (
          <div
            key={`label-${tag.id}`}
            style={{
              position: 'absolute',
              left: `${tag.x_position}%`,
              top: `${Math.max(tag.y_position - 5, 0)}%`,
              background: getTagColor(tag),
              color: 'white',
              padding: '2px 4px',
              fontSize: '9px',
              whiteSpace: 'nowrap',
              borderRadius: '2px',
              pointerEvents: 'none',
              maxWidth: '150px',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {tag.tag_name}
            {tag.source_type === 'ai' && ` (${tag.confidence}%)`}
          </div>
        ))}
      </div>

      {/* Add Tag Form */}
      {pendingPosition && isTagging && !readonly && (
        <div style={{
          background: '#f0f0f0',
          border: '2px inset #c0c0c0',
          padding: '8px',
          margin: '8px'
        }}>
          <div style={{ marginBottom: '6px', fontWeight: 'bold' }}>Add New Tag</div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
            <input
              type="text"
              value={newTagText}
              onChange={(e) => setNewTagText(e.target.value)}
              placeholder="Tag name (e.g., Engine, Brake Disc)"
              style={{
                flex: 1,
                padding: '2px 4px',
                border: '2px inset #c0c0c0',
                fontSize: '11px'
              }}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleAddTag();
                }
              }}
            />

            <select
              value={newTagType}
              onChange={(e) => setNewTagType(e.target.value as Tag['tag_type'])}
              style={{
                padding: '2px',
                border: '2px inset #c0c0c0',
                fontSize: '11px'
              }}
            >
              <option value="part">Part</option>
              <option value="tool">Tool</option>
              <option value="issue">Issue</option>
              <option value="process">Process</option>
              <option value="brand">Brand</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={handleAddTag}
              disabled={!newTagText.trim()}
              style={{
                background: '#0066cc',
                color: 'white',
                border: '2px outset #c0c0c0',
                padding: '4px 12px',
                fontSize: '11px',
                cursor: newTagText.trim() ? 'pointer' : 'not-allowed'
              }}
            >
              Add Tag
            </button>

            <button
              onClick={() => {
                setPendingPosition(null);
                setNewTagText('');
              }}
              style={{
                background: '#e0e0e0',
                color: 'black',
                border: '2px outset #c0c0c0',
                padding: '4px 12px',
                fontSize: '11px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Selected Tag Details */}
      {selectedTag && (
        <div style={{
          background: '#f9f9f9',
          border: '2px inset #c0c0c0',
          padding: '8px',
          margin: '8px'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
            Tag Details: {selectedTag.tag_name}
          </div>

          <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px' }}>
            Type: {selectedTag.tag_type} •
            Source: {selectedTag.source_type} •
            Confidence: {selectedTag.confidence}%
            {selectedTag.automated_confidence && ` (AI: ${selectedTag.automated_confidence}%)`} •
            Status: {selectedTag.validation_status}
          </div>

          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>

            {selectedTag.source_type === 'ai' && !selectedTag.verified && !readonly && (
              <>
                <button
                  onClick={() => handleValidateAITag(selectedTag, 'approve')}
                  style={{
                    background: '#00aa00',
                    color: 'white',
                    border: '2px outset #c0c0c0',
                    padding: '2px 6px',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  ✓ Approve
                </button>

                <button
                  onClick={() => handleValidateAITag(selectedTag, 'reject')}
                  style={{
                    background: '#cc0000',
                    color: 'white',
                    border: '2px outset #c0c0c0',
                    padding: '2px 6px',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  ✗ Reject
                </button>

                <button
                  onClick={() => handleValidateAITag(selectedTag, 'correct')}
                  style={{
                    background: '#ff9900',
                    color: 'white',
                    border: '2px outset #c0c0c0',
                    padding: '2px 6px',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  ✏️ Correct
                </button>
              </>
            )}

            {!readonly && (
              <button
                onClick={() => handleDeleteTag(selectedTag.id)}
                style={{
                  background: '#cc0000',
                  color: 'white',
                  border: '2px outset #c0c0c0',
                  padding: '2px 6px',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                🗑️ Delete
              </button>
            )}

            <button
              onClick={() => setSelectedTag(null)}
              style={{
                background: '#e0e0e0',
                color: 'black',
                border: '2px outset #c0c0c0',
                padding: '2px 6px',
                fontSize: '10px',
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const handleCorrectionConfirm = async (correctedName: string) => {
    if (!correctedName.trim() || !correctionDialog.tag) return;
    
    const tag = correctionDialog.tag;
    setCorrectionDialog({ isOpen: false, tag: null });
    
    try {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user?.id;

      // Create corrected version
      const correctedTag = {
        image_url: imageUrl,
        vehicle_id: vehicleId,
        timeline_event_id: timelineEventId,
        tag_name: correctedName.trim(),
        tag_type: tag.tag_type,
        source_type: 'manual' as const,
        x_position: tag.x_position,
        y_position: tag.y_position,
        width: tag.width,
        height: tag.height,
        confidence: 100,
        verified: true,
        validation_status: 'approved',
        parent_tag_id: tag.id,
        created_by: userId
      };

      const { error: insertError } = await supabase
        .from('image_tags')
        .insert([correctedTag]);

      if (insertError) throw insertError;

      // Mark original as disputed
      const { error: updateError } = await supabase
        .from('image_tags')
        .update({
          validation_status: 'disputed',
          manual_override: true
        })
        .eq('id', tag.id);

      if (updateError) throw updateError;

      await loadTags();
    } catch (error) {
      console.error('Error correcting tag:', error);
      alert('Error correcting tag: ' + (error as any).message);
    }
  };

  async function triggerAutoAnalysis() {
    try {
      const { data, error } = await supabase.functions.invoke('auto-analyze-upload', {
        body: {
          image_url: imageUrl,
          vehicle_id: vehicleId,
          timeline_event_id: timelineEventId,
          trigger_source: 'manual'
        }
      });

      if (error) {
        console.error('Auto-analysis error:', error);
        return;
      }

      console.log('Auto-analysis completed:', data);

      // Reload tags to show AI results
      setTimeout(() => loadTags(), 2000);

    } catch (error) {
      console.error('Error triggering auto-analysis:', error);
    }
  }

  return (
    <>
      <div style={{
        position: 'relative',
        border: '2px inset #c0c0c0',
        background: '#ffffff',
        fontFamily: 'MS Sans Serif, sans-serif',
        fontSize: '11px'
      }}>

        {/* Controls */}
        <div style={{
          background: '#c0c0c0',
          padding: '8px',
          borderBottom: '1px solid #808080',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap'
        }}>

          {/* Tagging Mode Toggle */}
          {!readonly && (
            <button
              onClick={() => setIsTagging(!isTagging)}
              style={{
                background: isTagging ? '#0066cc' : '#e0e0e0',
                color: isTagging ? 'white' : 'black',
                border: '2px outset #c0c0c0',
                padding: '4px 8px',
                fontSize: '11px',
                cursor: 'pointer'
              }}
            >
              {isTagging ? '✏️ Stop Tagging' : '🏷️ Add Tag'}
            </button>
          )}

          {/* Tag Type Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Show:</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              <input
                type="checkbox"
                checked={showAITags}
                onChange={e => setShowAITags(e.target.checked)}
              />
              <span style={{ color: '#ff9900' }}>AI Tags</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              <input
                type="checkbox"
                checked={showManualTags}
                onChange={e => setShowManualTags(e.target.checked)}
              />
              <span style={{ color: '#00aa00' }}>Manual Tags</span>
            </label>
          </div>

          {/* Tag Count */}
          <div style={{ marginLeft: 'auto', fontSize: '10px', color: '#666' }}>
            {tags.filter(t => t.source_type === 'ai').length} AI •
            {tags.filter(t => t.source_type === 'manual').length} Manual •
            {tags.filter(t => t.verified).length} Verified
          </div>
        </div>

        {/* Image Container */}
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            cursor: isTagging ? 'crosshair' : 'default',
            overflow: 'hidden'
          }}
          onClick={handleImageClick}
        >
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Taggable content"
            style={{
              width: '100%',
              height: 'auto',
              display: 'block'
            }}
            onLoad={() => {
              // Auto-trigger analysis on first load if no tags exist
              if (tags.length === 0 && !readonly) {
                triggerAutoAnalysis();
              }
            }}
          />

          {/* Existing Tags */}
          {filteredTags.map((tag) => (
            <div
              key={tag.id}
              style={{
                position: 'absolute',
                left: `${tag.x_position}%`,
                top: `${tag.y_position}%`,
                width: `${tag.width}%`,
                height: `${tag.height}%`,
                border: `2px solid ${getTagColor(tag)}`,
                background: `${getTagColor(tag)}20`,
                cursor: 'pointer',
                minWidth: '20px',
                minHeight: '20px'
              }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedTag(tag);
              }}
            />
          ))}

          {/* Pending Tag */}
          {pendingPosition && (
            <div
              style={{
                position: 'absolute',
                left: `${pendingPosition.x}%`,
                top: `${pendingPosition.y}%`,
                width: `${pendingPosition.width}%`,
                height: `${pendingPosition.height}%`,
                border: '2px dashed #0066cc',
                background: '#0066cc20',
                minWidth: '20px',
                minHeight: '20px'
              }}
            />
          )}

          {/* Tag Labels */}
          {filteredTags.map((tag) => (
            <div
              key={`label-${tag.id}`}
              style={{
                position: 'absolute',
                left: `${tag.x_position}%`,
                top: `${Math.max(tag.y_position - 5, 0)}%`,
                background: getTagColor(tag),
                color: 'white',
                padding: '2px 4px',
                fontSize: '9px',
                whiteSpace: 'nowrap',
                borderRadius: '2px',
                pointerEvents: 'none',
                maxWidth: '150px',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {tag.tag_name}
              {tag.source_type === 'ai' && ` (${tag.confidence}%)`}
            </div>
          ))}
        </div>

        {/* Add Tag Form */}
        {pendingPosition && isTagging && !readonly && (
          <div style={{
            background: '#f0f0f0',
            border: '2px inset #c0c0c0',
            padding: '8px',
            margin: '8px'
          }}>
            <div style={{ marginBottom: '6px', fontWeight: 'bold' }}>Add New Tag</div>

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
              <input
                type="text"
                value={newTagText}
                onChange={(e) => setNewTagText(e.target.value)}
                placeholder="Tag name (e.g., Engine, Brake Disc)"
                style={{
                  flex: 1,
                  padding: '2px 4px',
                  border: '2px inset #c0c0c0',
                  fontSize: '11px'
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleAddTag();
                  }
                }}
              />

              <select
                value={newTagType}
                onChange={(e) => setNewTagType(e.target.value as Tag['tag_type'])}
                style={{
                  padding: '2px',
                  border: '2px inset #c0c0c0',
                  fontSize: '11px'
                }}
              >
                <option value="part">Part</option>
                <option value="tool">Tool</option>
                <option value="issue">Issue</option>
                <option value="process">Process</option>
                <option value="brand">Brand</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={handleAddTag}
                disabled={!newTagText.trim()}
                style={{
                  background: '#0066cc',
                  color: 'white',
                  border: '2px outset #c0c0c0',
                  padding: '4px 12px',
                  fontSize: '11px',
                  cursor: newTagText.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                Add Tag
              </button>

              <button
                onClick={() => {
                  setPendingPosition(null);
                  setNewTagText('');
                }}
                style={{
                  background: '#e0e0e0',
                  color: 'black',
                  border: '2px outset #c0c0c0',
                  padding: '4px 12px',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Selected Tag Details */}
        {selectedTag && (
          <div style={{
            background: '#f9f9f9',
            border: '2px inset #c0c0c0',
            padding: '8px',
            margin: '8px'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
              Tag Details: {selectedTag.tag_name}
            </div>

            <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px' }}>
              Type: {selectedTag.tag_type} •
              Source: {selectedTag.source_type} •
              Confidence: {selectedTag.confidence}%
              {selectedTag.automated_confidence && ` (AI: ${selectedTag.automated_confidence}%)`} •
              Status: {selectedTag.validation_status}
            </div>

            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>

              {selectedTag.source_type === 'ai' && !selectedTag.verified && !readonly && (
                <>
                  <button
                    onClick={() => handleValidateAITag(selectedTag, 'approve')}
                    style={{
                      background: '#00aa00',
                      color: 'white',
                      border: '2px outset #c0c0c0',
                      padding: '2px 6px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                  >
                    ✓ Approve
                  </button>

                  <button
                    onClick={() => handleValidateAITag(selectedTag, 'reject')}
                    style={{
                      background: '#cc0000',
                      color: 'white',
                      border: '2px outset #c0c0c0',
                      padding: '2px 6px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                  >
                    ✗ Reject
                  </button>

                  <button
                    onClick={() => handleValidateAITag(selectedTag, 'correct')}
                    style={{
                      background: '#ff9900',
                      color: 'white',
                      border: '2px outset #c0c0c0',
                      padding: '2px 6px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                  >
                    ✏️ Correct
                  </button>
                </>
              )}

              {!readonly && (
                <button
                  onClick={() => handleDeleteTag(selectedTag.id)}
                  style={{
                    background: '#cc0000',
                    color: 'white',
                    border: '2px outset #c0c0c0',
                    padding: '2px 6px',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  🗑️ Delete
                </button>
              )}

              <button
                onClick={() => setSelectedTag(null)}
                style={{
                  background: '#e0e0e0',
                  color: 'black',
                  border: '2px outset #c0c0c0',
                  padding: '2px 6px',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Correction Dialog */}
      <InputDialog
        isOpen={correctionDialog.isOpen}
        title="Correct Tag Name"
        message="Enter the correct label for this tag:"
        defaultValue={correctionDialog.tag?.tag_name || ''}
        onConfirm={handleCorrectionConfirm}
        onCancel={() => setCorrectionDialog({ isOpen: false, tag: null })}
        confirmLabel="Correct"
        required
      />
    </>
  );
};

export default EnhancedImageTagger;