import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface EnhancedImageTaggerProps {
  imageUrl: string;
  vehicleId: string;
  imageId?: string;
  onTagAdded?: (tag: any) => void;
  onTagValidated?: (tagId: string, action: 'approve' | 'reject' | 'correct') => void;
}

interface Tag {
  id: string;
  tag_name: string;
  x_position: number;
  y_position: number;
  width?: number;
  height?: number;
  confidence?: number;
  source_type: 'manual' | 'ai' | 'corrected';
  verified?: boolean;
  validation_status?: 'pending' | 'approved' | 'rejected';
  ai_detection_data?: any;
  parent_tag_id?: string;
}

interface TagSuggestion {
  label: string;
  category: 'issue' | 'part' | 'process' | 'tool' | 'brand' | 'custom';
  description: string;
}

const AUTOMOTIVE_TAG_SUGGESTIONS: TagSuggestion[] = [
  // Issues & Problems
  { label: 'Body Panel Rust', category: 'issue', description: 'Rust on body panels, fenders, doors' },
  { label: 'Frame Rust', category: 'issue', description: 'Structural frame corrosion' },
  { label: 'Paint Damage', category: 'issue', description: 'Scratches, chips, fading' },
  { label: 'Dent', category: 'issue', description: 'Body panel denting' },
  { label: 'Oil Leak', category: 'issue', description: 'Engine/transmission oil seepage' },
  { label: 'Coolant Leak', category: 'issue', description: 'Cooling system leak' },
  { label: 'Tire Wear', category: 'issue', description: 'Tire tread wear patterns' },
  { label: 'Brake Wear', category: 'issue', description: 'Worn brake components' },
  { label: 'Suspension Damage', category: 'issue', description: 'Shock, strut, spring issues' },
  { label: 'Seat Damage', category: 'issue', description: 'Seat wear, tears, stains' },

  // Parts & Components
  { label: 'Engine Block', category: 'part', description: 'Main engine assembly' },
  { label: 'Radiator', category: 'part', description: 'Cooling system radiator' },
  { label: 'Battery', category: 'part', description: 'Vehicle battery' },
  { label: 'Air Filter', category: 'part', description: 'Engine air filtration' },
  { label: 'Brake Disc', category: 'part', description: 'Brake rotor/disc' },
  { label: 'Brake Caliper', category: 'part', description: 'Brake caliper assembly' },
  { label: 'Brake Pads', category: 'part', description: 'Brake pad condition' },
  { label: 'Brake Line', category: 'part', description: 'Hydraulic brake lines' },
  { label: 'Wheel Hub', category: 'part', description: 'Wheel bearing hub' },
  { label: 'Wheel Bearing', category: 'part', description: 'Wheel bearing assembly' },
  { label: 'Dashboard', category: 'part', description: 'Interior dashboard area' },
  { label: 'Console', category: 'part', description: 'Center console area' },
  { label: 'Gauge Cluster', category: 'part', description: 'Instrument panel' },
  { label: 'Differential', category: 'part', description: 'Differential assembly' },
  { label: 'Exhaust System', category: 'part', description: 'Exhaust pipes, muffler' },
  { label: 'Frame Member', category: 'part', description: 'Structural frame components' },

  // Tools & Equipment
  { label: 'Jack', category: 'tool', description: 'Hydraulic or mechanical jack' },
  { label: 'Wrench', category: 'tool', description: 'Hand tool for turning bolts' },
  { label: 'Socket Set', category: 'tool', description: 'Socket wrench set' },
  { label: 'Multimeter', category: 'tool', description: 'Electrical testing device' },
  { label: 'Torque Wrench', category: 'tool', description: 'Precision tightening tool' },

  // Processes & Work
  { label: 'Rust Removal', category: 'process', description: 'Process of removing corrosion' },
  { label: 'Paint Prep', category: 'process', description: 'Surface preparation for painting' },
  { label: 'Brake Service', category: 'process', description: 'Brake system maintenance' },
  { label: 'Oil Change', category: 'process', description: 'Engine oil replacement' },
  { label: 'Inspection', category: 'process', description: 'Visual or mechanical inspection' },

  // Brands (examples for your K5)
  { label: 'Chevrolet', category: 'brand', description: 'Vehicle manufacturer' },
  { label: 'K5 Blazer', category: 'brand', description: 'Specific model designation' },
  { label: 'GM', category: 'brand', description: 'General Motors' },
];

export default function EnhancedImageTagger({
  imageUrl,
  vehicleId,
  imageId,
  onTagAdded,
  onTagValidated
}: EnhancedImageTaggerProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isTagging, setIsTagging] = useState(false);
  const [newTagText, setNewTagText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<TagSuggestion[]>([]);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [currentBbox, setCurrentBbox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Load existing tags
  useEffect(() => {
    loadTags();
  }, [vehicleId, imageUrl, imageId]);

  // Filter suggestions based on input
  useEffect(() => {
    if (newTagText.length > 0) {
      const filtered = AUTOMOTIVE_TAG_SUGGESTIONS.filter(suggestion =>
        suggestion.label.toLowerCase().includes(newTagText.toLowerCase()) ||
        suggestion.description.toLowerCase().includes(newTagText.toLowerCase())
      );
      setFilteredSuggestions(filtered);
      setShowSuggestions(true);
    } else {
      setFilteredSuggestions(AUTOMOTIVE_TAG_SUGGESTIONS);
      setShowSuggestions(false);
    }
  }, [newTagText]);

  const loadTags = async () => {
    try {
      let query = supabase
        .from('image_tags')
        .select('*')
        .eq('vehicle_id', vehicleId);

      // If we have imageId, filter by that, otherwise filter by image URL
      if (imageId) {
        query = query.eq('image_id', imageId);
      } else {
        // Need to join with vehicle_images to filter by URL
        const { data: imageRecord } = await supabase
          .from('vehicle_images')
          .select('id')
          .eq('image_url', imageUrl)
          .eq('vehicle_id', vehicleId)
          .single();

        if (imageRecord) {
          query = query.eq('image_id', imageRecord.id);
        }
      }

      const { data: imageTags, error } = await query.order('created_at', { ascending: true });

      if (error) {
        console.error('Error loading tags:', error);
        return;
      }

      if (imageTags) {
        setTags(imageTags.map(tag => ({
          id: tag.id,
          tag_name: tag.tag_name,
          x_position: tag.x_position || 0,
          y_position: tag.y_position || 0,
          width: tag.width,
          height: tag.height,
          confidence: tag.confidence,
          source_type: tag.source_type || 'manual',
          verified: tag.verified,
          validation_status: tag.validation_status,
          ai_detection_data: tag.ai_detection_data,
          parent_tag_id: tag.parent_tag_id
        })));
      }
    } catch (err) {
      console.error('Failed to load tags:', err);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTagging) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setDragStart({ x, y });
    setCurrentBbox({ x, y, width: 0, height: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTagging || !dragStart) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const currentX = ((e.clientX - rect.left) / rect.width) * 100;
    const currentY = ((e.clientY - rect.top) / rect.height) * 100;

    const width = Math.abs(currentX - dragStart.x);
    const height = Math.abs(currentY - dragStart.y);
    const x = Math.min(dragStart.x, currentX);
    const y = Math.min(dragStart.y, currentY);

    setCurrentBbox({ x, y, width, height });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTagging || !dragStart || !currentBbox) return;

    // If it's just a click (no drag), set point position
    if (currentBbox.width < 2 && currentBbox.height < 2) {
      setPendingPosition({ x: dragStart.x, y: dragStart.y });
      setCurrentBbox(null);
    } else {
      // It's a bounding box selection
      setPendingPosition({
        x: currentBbox.x + currentBbox.width / 2,
        y: currentBbox.y + currentBbox.height / 2
      });
    }

    setDragStart(null);
  };

  const handleAddTag = async () => {
    if (!newTagText.trim() || !pendingPosition) return;

    try {
      // Get or create the vehicle_images record
      let targetImageId = imageId;

      if (!targetImageId) {
        const { data: imageRecord, error: imgError } = await supabase
          .from('vehicle_images')
          .select('id')
          .eq('image_url', imageUrl)
          .eq('vehicle_id', vehicleId)
          .single();

        if (imgError || !imageRecord) {
          // Create vehicle_images record if it doesn't exist
          const { data: newImageRecord, error: createError } = await supabase
            .from('vehicle_images')
            .insert({
              vehicle_id: vehicleId,
              image_url: imageUrl,
              area: 'manual_tag',
              created_at: new Date().toISOString()
            })
            .select('id')
            .single();

          if (createError || !newImageRecord) {
            throw new Error('Failed to create image record');
          }

          targetImageId = newImageRecord.id;
        } else {
          targetImageId = imageRecord.id;
        }
      }

      // Create the tag record
      const tagData = {
        vehicle_id: vehicleId,
        image_id: targetImageId,
        tag_name: newTagText.trim(),
        text: newTagText.trim(), // Required field
        tag_type: selectedCategory || 'custom',
        source_type: 'manual',
        x_position: pendingPosition.x,
        y_position: pendingPosition.y,
        width: currentBbox?.width || 5, // Default small width for point tags
        height: currentBbox?.height || 5, // Default small height for point tags
        confidence: 100, // Manual tags are 100% confident
        verified: true,
        validation_status: 'approved',
        created_at: new Date().toISOString()
      };

      const { data: savedTag, error } = await supabase
        .from('image_tags')
        .insert(tagData)
        .select()
        .single();

      if (error) {
        throw error;
      }

      // Add to local state
      const newTag: Tag = {
        id: savedTag.id,
        tag_name: savedTag.tag_name,
        x_position: savedTag.x_position,
        y_position: savedTag.y_position,
        width: savedTag.width,
        height: savedTag.height,
        confidence: savedTag.confidence,
        source_type: 'manual',
        verified: true,
        validation_status: 'approved'
      };

      setTags(prev => [...prev, newTag]);
      onTagAdded?.(newTag);

      // Reset form
      resetTaggingState();

      // Trigger image refresh to update AI analysis
      window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
        detail: { vehicleId }
      }));

    } catch (err) {
      console.error('Error saving tag:', err);
      alert('Failed to save tag. Please try again.');
    }
  };

  const resetTaggingState = () => {
    setNewTagText('');
    setSelectedCategory('');
    setPendingPosition(null);
    setCurrentBbox(null);
    setIsTagging(false);
    setShowSuggestions(false);
    setDragStart(null);
  };

  const handleValidateTag = async (tagId: string, action: 'approve' | 'reject' | 'correct') => {
    try {
      const updates: any = {};

      switch (action) {
        case 'approve':
          updates.verified = true;
          updates.validation_status = 'approved';
          break;
        case 'reject':
          updates.verified = false;
          updates.validation_status = 'rejected';
          break;
        case 'correct':
          // This would open a correction dialog
          const correctedLabel = prompt('Enter correct label:');
          if (correctedLabel) {
            updates.tag_name = correctedLabel;
            updates.verified = true;
            updates.validation_status = 'approved';
            updates.manual_override = true;
          }
          break;
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from('image_tags')
          .update(updates)
          .eq('id', tagId);

        if (error) throw error;

        // Update local state
        setTags(prev => prev.map(tag =>
          tag.id === tagId ? { ...tag, ...updates } : tag
        ));

        onTagValidated?.(tagId, action);
      }
    } catch (err) {
      console.error('Error validating tag:', err);
      alert('Failed to validate tag. Please try again.');
    }
  };

  const removeTag = async (tagId: string) => {
    try {
      const { error } = await supabase
        .from('image_tags')
        .delete()
        .eq('id', tagId);

      if (error) throw error;

      setTags(prev => prev.filter(tag => tag.id !== tagId));
    } catch (err) {
      console.error('Error removing tag:', err);
      alert('Failed to remove tag. Please try again.');
    }
  };

  const selectSuggestion = (suggestion: TagSuggestion) => {
    setNewTagText(suggestion.label);
    setSelectedCategory(suggestion.category);
    setShowSuggestions(false);
  };

  const getTagColor = (tag: Tag) => {
    if (tag.source_type === 'ai') {
      return tag.verified ? '#28a745' : '#fd7e14'; // Green if verified, orange if unverified
    } else if (tag.source_type === 'manual') {
      return '#007bff'; // Blue for manual
    } else if (tag.source_type === 'corrected') {
      return '#6f42c1'; // Purple for corrected
    }
    return '#6c757d'; // Gray default
  };

  return (
    <div className="enhanced-image-tagger">
      <div
        className={`image-container ${isTagging ? 'tagging-mode' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{ position: 'relative', display: 'inline-block', cursor: isTagging ? 'crosshair' : 'default' }}
      >
        <img
          src={imageUrl}
          alt="Vehicle"
          style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
          draggable={false}
        />

        {/* Existing Tags */}
        {tags.map(tag => (
          <div key={tag.id} className="tag-overlay">
            {/* Bounding Box */}
            {tag.width && tag.height && tag.width > 5 && tag.height > 5 && (
              <div
                className="tag-bbox"
                style={{
                  position: 'absolute',
                  left: `${tag.x_position}%`,
                  top: `${tag.y_position}%`,
                  width: `${tag.width}%`,
                  height: `${tag.height}%`,
                  border: `2px solid ${getTagColor(tag)}`,
                  backgroundColor: `${getTagColor(tag)}20`,
                  pointerEvents: 'none'
                }}
              />
            )}

            {/* Tag Label */}
            <div
              className="tag-label"
              style={{
                position: 'absolute',
                left: `${tag.x_position}%`,
                top: `${tag.y_position - 3}%`,
                transform: 'translate(-50%, -100%)',
                backgroundColor: getTagColor(tag),
                color: 'white',
                padding: '1px 3px',
                borderRadius: '0',
                fontSize: '8pt',
                fontFamily: '"MS Sans Serif", sans-serif',
                whiteSpace: 'nowrap',
                zIndex: 10,
                cursor: 'pointer'
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (tag.source_type === 'ai' && !tag.verified) {
                  // Show validation options for unverified AI tags
                  const action = window.confirm(`Validate "${tag.tag_name}"?\n\nOK = Approve, Cancel = Options`);
                  if (action) {
                    handleValidateTag(tag.id, 'approve');
                  } else {
                    const choice = window.prompt('Enter: "reject" to reject, "correct" to correct, or cancel');
                    if (choice === 'reject') {
                      handleValidateTag(tag.id, 'reject');
                    } else if (choice === 'correct') {
                      handleValidateTag(tag.id, 'correct');
                    }
                  }
                } else if (tag.source_type === 'manual') {
                  if (window.confirm(`Remove manual tag "${tag.tag_name}"?`)) {
                    removeTag(tag.id);
                  }
                }
              }}
            >
              {tag.source_type === 'ai' && 'A:'}
              {tag.source_type === 'manual' && 'M:'}
              {tag.source_type === 'corrected' && 'C:'}
              {tag.tag_name}
              {tag.confidence && ` ${Math.round(tag.confidence)}%`}
            </div>
          </div>
        ))}

        {/* Current Bounding Box */}
        {currentBbox && (
          <div
            style={{
              position: 'absolute',
              left: `${currentBbox.x}%`,
              top: `${currentBbox.y}%`,
              width: `${currentBbox.width}%`,
              height: `${currentBbox.height}%`,
              border: '2px dashed #007bff',
              backgroundColor: 'rgba(0, 123, 255, 0.2)',
              pointerEvents: 'none'
            }}
          />
        )}

        {/* Pending Tag Position */}
        {pendingPosition && (
          <div
            style={{
              position: 'absolute',
              left: `${pendingPosition.x}%`,
              top: `${pendingPosition.y}%`,
              transform: 'translate(-50%, -50%)',
              width: '12px',
              height: '12px',
              background: '#ff4444',
              borderRadius: '50%',
              border: '2px solid white',
              zIndex: 10
            }}
          />
        )}
      </div>

      {/* Minimal Controls */}
      <div className="tagger-controls">
        {!isTagging && !pendingPosition ? (
          <button onClick={() => setIsTagging(true)} className="tag-btn">
            Tag
          </button>
        ) : pendingPosition ? (
          <div className="tag-input">
            <input
              type="text"
              value={newTagText}
              onChange={(e) => setNewTagText(e.target.value)}
              className="tag-field"
              autoFocus
              onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
            />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="tag-field"
            >
              <option value="">Type</option>
              <option value="issue">Issue</option>
              <option value="part">Part</option>
              <option value="process">Process</option>
              <option value="tool">Tool</option>
              <option value="brand">Brand</option>
              <option value="custom">Custom</option>
            </select>
            <button onClick={handleAddTag} disabled={!newTagText.trim()} className="tag-btn">Add</button>
            <button onClick={resetTaggingState} className="tag-btn">X</button>
          </div>
        ) : (
          <button onClick={resetTaggingState} className="tag-btn">Cancel</button>
        )}
      </div>

      {tags.length > 0 && (
        <div className="tag-counts">
          {tags.filter(t => t.source_type === 'manual').length}M {tags.filter(t => t.source_type === 'ai').length}A
        </div>
      )}

      <style jsx>{`
        .enhanced-image-tagger {
          position: relative;
          font-family: "MS Sans Serif", sans-serif;
          font-size: 8pt;
        }

        .image-container.tagging-mode {
          user-select: none;
        }

        .tagger-controls {
          margin-top: 2px;
        }

        .tag-input {
          display: flex;
          gap: 2px;
          align-items: center;
        }

        .tag-btn {
          background: #c0c0c0;
          border: 1px outset #c0c0c0;
          padding: 1px 6px;
          font-size: 8pt;
          font-family: "MS Sans Serif", sans-serif;
          cursor: pointer;
        }

        .tag-btn:active {
          border: 1px inset #c0c0c0;
        }

        .tag-btn:disabled {
          color: #808080;
        }

        .tag-field {
          border: 1px inset #c0c0c0;
          padding: 1px 3px;
          font-size: 8pt;
          font-family: "MS Sans Serif", sans-serif;
          background: #ffffff;
        }

        .tag-counts {
          font-size: 8pt;
          color: #000000;
          margin-top: 2px;
        }

        .tag-count.pending {
          background: #ffc10720;
          color: #ffc107;
        }
      `}</style>
    </div>
  );
}