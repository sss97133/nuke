import React, { memo } from 'react';
import { SpatialTag, TagType, getTagColor, TAG_TYPES } from '../constants';

interface TagOverlayProps {
  tags: SpatialTag[];
  activeTagId?: string | null;
  tagText?: string;
  selectedTagType?: TagType;
  tagSaving: boolean;
  onTagSave: (tagId: string) => void;
  onTagDelete: (tagId: string) => void;
  onTagTextChange: (text: string) => void;
  onTagTypeChange: (type: TagType) => void;
}

const TagOverlay: React.FC<TagOverlayProps> = memo(({
  tags,
  activeTagId,
  tagText = '',
  selectedTagType = 'product',
  tagSaving,
  onTagSave,
  onTagDelete,
  onTagTextChange,
  onTagTypeChange
}) => {
  return (
    <div
      className="tag-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none'
      }}
    >
      {tags.map((tag) => (
        <div
          key={tag.id}
          className={`tag-marker ${tag.id === activeTagId ? 'active' : ''}`}
          style={{
            position: 'absolute',
            left: `${tag.x}%`,
            top: `${tag.y}%`,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'auto',
            zIndex: tag.id === activeTagId ? 20 : 10
          }}
        >
          {/* Tag Dot */}
          <div
            className="tag-dot"
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: getTagColor(tag.type),
              border: '2px solid white',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              cursor: 'pointer'
            }}
            onClick={() => {
              // Toggle edit mode for existing tags
              if (!tag.isEditing && tag.id !== activeTagId) {
                // Set as active for viewing
                onTagTextChange(tag.text);
                onTagTypeChange(tag.type);
              }
            }}
          />

          {/* Tag Label (always visible) */}
          {tag.text && !tag.isEditing && (
            <div
              className="tag-label"
              style={{
                position: 'absolute',
                left: '50%',
                top: '-40px',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(0,0,0,0.8)',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                maxWidth: '200px',
                textAlign: 'center'
              }}
            >
              {tag.text}
              <div style={{ fontSize: '10px', opacity: 0.7 }}>
                {TAG_TYPES.find(t => t.value === tag.type)?.label || tag.type}
              </div>
            </div>
          )}

          {/* Edit Form */}
          {tag.isEditing && tag.id === activeTagId && (
            <div
              className="tag-editor"
              style={{
                position: 'absolute',
                left: '50%',
                top: '-120px',
                transform: 'translateX(-50%)',
                backgroundColor: 'white',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                minWidth: '250px',
                zIndex: 30
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Tag Text Input */}
              <div style={{ marginBottom: '8px' }}>
                <input
                  type="text"
                  value={tagText}
                  onChange={(e) => onTagTextChange(e.target.value)}
                  placeholder="Enter tag description..."
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                  autoFocus
                />
              </div>

              {/* Tag Type Selector */}
              <div style={{ marginBottom: '12px' }}>
                <select
                  value={selectedTagType}
                  onChange={(e) => onTagTypeChange(e.target.value as TagType)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}
                >
                  {TAG_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => onTagDelete(tag.id)}
                  disabled={tagSaving}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: 'var(--danger)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Delete
                </button>

                <button
                  onClick={() => onTagSave(tag.id)}
                  disabled={tagSaving || !tagText.trim()}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: tagText.trim() ? 'var(--primary)' : 'var(--muted)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: tagText.trim() ? 'pointer' : 'not-allowed'
                  }}
                >
                  {tagSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
});

TagOverlay.displayName = 'TagOverlay';

export default TagOverlay;