import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface SimplePhotoTaggerProps {
  imageUrl: string;
  vehicleId: string;
  onTagAdded?: (tag: { text: string; x: number; y: number }) => void;
}

interface Tag {
  id: string;
  text: string;
  x: number;
  y: number;
}

export default function SimplePhotoTagger({
  imageUrl,
  vehicleId,
  onTagAdded
}: SimplePhotoTaggerProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isTagging, setIsTagging] = useState(false);
  const [newTagText, setNewTagText] = useState('');
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTagging) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100; // Percentage
    const y = ((e.clientY - rect.top) / rect.height) * 100; // Percentage

    setPendingPosition({ x, y });
  };

  const handleAddTag = async () => {
    if (!newTagText.trim() || !pendingPosition) return;

    const newTag: Tag = {
      id: `temp_${Date.now()}`,
      text: newTagText.trim(),
      x: pendingPosition.x,
      y: pendingPosition.y
    };

    try {
      // Save to database using timeline_events as photo tags
      const { data, error } = await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: vehicleId,
          event_type: 'photo_tag',
          title: `Photo Tag: ${newTag.text}`,
          description: `Tagged "${newTag.text}" in vehicle photo`,
          event_date: new Date().toISOString().split('T')[0],
          metadata: {
            tag_text: newTag.text,
            x_position: newTag.x,
            y_position: newTag.y,
            image_url: imageUrl,
            tag_type: 'user_manual'
          }
        })
        .select()
        .single();

      if (!error && data) {
        // Update the tag with the database ID
        const savedTag = { ...newTag, id: data.id };
        setTags(prev => [...prev, savedTag]);
        onTagAdded?.(savedTag);
      } else {
        // Fallback to localStorage if database fails
        console.debug('Database save failed, using localStorage fallback');
        const storageKey = `photo_tags_${vehicleId}`;
        const existingTags = JSON.parse(localStorage.getItem(storageKey) || '[]');
        const updatedTags = [...existingTags, { ...newTag, imageUrl }];
        localStorage.setItem(storageKey, JSON.stringify(updatedTags));

        setTags(prev => [...prev, newTag]);
        onTagAdded?.(newTag);
      }

      // Reset form
      setNewTagText('');
      setPendingPosition(null);
      setIsTagging(false);

    } catch (err) {
      console.error('Error saving tag:', err);
      alert('Failed to save tag. Please try again.');
    }
  };

  const removeTag = async (tagId: string) => {
    try {
      // Try to delete from database first (if it's a real database ID)
      if (!tagId.startsWith('temp_')) {
        await supabase
          .from('timeline_events')
          .delete()
          .eq('id', tagId)
          .eq('event_type', 'photo_tag');
      }

      // Update local state
      setTags(prev => prev.filter(tag => tag.id !== tagId));

      // Also clean up localStorage fallback
      const storageKey = `photo_tags_${vehicleId}`;
      const existingTags = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const updatedTags = existingTags.filter((tag: any) => tag.id !== tagId);
      localStorage.setItem(storageKey, JSON.stringify(updatedTags));

    } catch (err) {
      console.error('Error removing tag:', err);
      // Still remove from local state even if database delete fails
      setTags(prev => prev.filter(tag => tag.id !== tagId));
    }
  };

  // Load tags from database on mount
  React.useEffect(() => {
    const loadTags = async () => {
      try {
        // Load from database first
        const { data: events, error } = await supabase
          .from('timeline_events')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .eq('event_type', 'photo_tag')
          .not('metadata', 'is', null);

        if (!error && events) {
          const imageTags = events
            .filter(event => event.metadata?.image_url === imageUrl)
            .map(event => ({
              id: event.id,
              text: event.metadata.tag_text,
              x: event.metadata.x_position,
              y: event.metadata.y_position
            }));

          setTags(imageTags);
          return;
        }
      } catch (err) {
        console.debug('Failed to load tags from database, trying localStorage');
      }

      // Fallback to localStorage if database fails
      const storageKey = `photo_tags_${vehicleId}`;
      const existingTags = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const imageTags = existingTags.filter((tag: any) => tag.imageUrl === imageUrl);
      setTags(imageTags);
    };

    loadTags();
  }, [vehicleId, imageUrl]);

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          position: 'relative',
          display: 'inline-block',
          cursor: isTagging ? 'crosshair' : 'default',
          maxWidth: '100%'
        }}
        onClick={handleImageClick}
      >
        <img
          src={imageUrl}
          alt="Vehicle"
          style={{
            maxWidth: '100%',
            height: 'auto',
            display: 'block'
          }}
        />

        {/* Existing Tags */}
        {tags.map(tag => (
          <div
            key={tag.id}
            style={{
              position: 'absolute',
              left: `${tag.x}%`,
              top: `${tag.y}%`,
              transform: 'translate(-50%, -50%)',
              background: 'rgba(0, 123, 255, 0.9)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              whiteSpace: 'nowrap',
              zIndex: 10,
              cursor: 'pointer'
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Remove tag "${tag.text}"?`)) {
                removeTag(tag.id);
              }
            }}
          >
            {tag.text}
          </div>
        ))}

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

      {/* Controls */}
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {!isTagging && !pendingPosition ? (
          <button
            onClick={() => setIsTagging(true)}
            className="button button-secondary button-small"
          >
            Add Tag
          </button>
        ) : pendingPosition ? (
          <>
            <input
              type="text"
              placeholder="Enter tag text (e.g., 'Engine Bay', 'Rust Spot')"
              value={newTagText}
              onChange={(e) => setNewTagText(e.target.value)}
              className="form-input"
              style={{ flex: 1, minWidth: '200px' }}
              autoFocus
              onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
            />
            <button
              onClick={handleAddTag}
              disabled={!newTagText.trim()}
              className="button button-primary button-small"
            >
              Add
            </button>
            <button
              onClick={() => {
                setPendingPosition(null);
                setNewTagText('');
                setIsTagging(false);
              }}
              className="button button-secondary button-small"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="text-small text-muted">Click on the image to place a tag</span>
            <button
              onClick={() => setIsTagging(false)}
              className="button button-secondary button-small"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {/* Tag Count */}
      {tags.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <span className="text-small text-muted">
            {tags.length} tag{tags.length !== 1 ? 's' : ''} •
            <span style={{ color: '#28a745', fontWeight: 'bold' }}> +{tags.length * 2} data quality points</span>
          </span>
        </div>
      )}
    </div>
  );
}