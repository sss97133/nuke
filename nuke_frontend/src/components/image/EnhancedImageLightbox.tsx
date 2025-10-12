import React, { useState, useCallback } from 'react';
import { ImageLightbox } from './ImageLightbox';
import EnhancedTagOverlay from '../pro-image-viewer/components/EnhancedTagOverlay';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import '../../styles/windows95.css';

// Enhanced interface that extends the basic ImageLightbox
interface EnhancedImageLightboxProps {
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
  // Enhanced tagging props
  enableEnhancedTagging?: boolean;
  onAIAnalysis?: () => Promise<void>;
}

interface EnhancedSpatialTag {
  id: string;
  x: number;
  y: number;
  text: string;
  type: 'product' | 'damage' | 'location' | 'modification' | 'brand' | 'part' | 'tool' | 'fluid';
  isEditing?: boolean;
  created_by?: string;
  created_at?: string;
  // Enhanced fields
  severity_level?: 'minor' | 'moderate' | 'severe' | 'critical';
  estimated_cost_cents?: number;
  service_status?: 'needed' | 'quoted' | 'approved' | 'in_progress' | 'completed' | 'failed';
  product_name?: string;
  service_name?: string;
  technician_name?: string;
  shop_name?: string;
  automated_confidence?: number;
  source_type?: 'manual' | 'ai_detected' | 'exif' | 'imported';
}

export const EnhancedImageLightbox: React.FC<EnhancedImageLightboxProps> = ({
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
  description,
  enableEnhancedTagging = true,
  onAIAnalysis
}) => {
  const [tags, setTags] = useState<EnhancedSpatialTag[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [tagText, setTagText] = useState('');
  const [selectedTagType, setSelectedTagType] = useState<EnhancedSpatialTag['type']>('product');
  const [tagSaving, setTagSaving] = useState(false);
  const [showEnhancedMode, setShowEnhancedMode] = useState(false);

  // Handle tag operations
  const handleTagSave = useCallback(async (tagId: string) => {
    setTagSaving(true);
    try {
      // In a real implementation, this would call your API
      const response = await fetch(`/api/spatial-tags/${tagId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          text: tagText,
          type: selectedTagType
        })
      });

      if (response.ok) {
        // Update local state
        setTags(prev => prev.map(tag =>
          tag.id === tagId
            ? { ...tag, text: tagText, type: selectedTagType, isEditing: false }
            : tag
        ));
        setActiveTagId(null);
        setTagText('');
      }
    } catch (error) {
      console.error('Error saving tag:', error);
    } finally {
      setTagSaving(false);
    }
  }, [tagText, selectedTagType]);

  const handleTagDelete = useCallback(async (tagId: string) => {
    try {
      const response = await fetch(`/api/spatial-tags/${tagId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        setTags(prev => prev.filter(tag => tag.id !== tagId));
      }
    } catch (error) {
      console.error('Error deleting tag:', error);
    }
  }, []);

  const handleTagClick = useCallback((tag: EnhancedSpatialTag) => {
    setActiveTagId(tag.id);
    setTagText(tag.text);
    setSelectedTagType(tag.type);

    // Set tag to editing mode
    setTags(prev => prev.map(t => ({
      ...t,
      isEditing: t.id === tag.id
    })));
  }, []);

  const handleRunAIAnalysis = useCallback(async () => {
    if (onAIAnalysis) {
      await onAIAnalysis();
      // Reload tags after AI analysis
      // In real implementation, fetch updated tags from API
    }
  }, [onAIAnalysis]);

  if (!isOpen) return null;

  return (
    <div className="win95-lightbox">
      <div className="win95-lightbox-window relative max-w-7xl max-h-screen w-full h-full flex flex-col">
        {/* Header - Windows 95 Style */}
        <div className="win95-titlebar">
          <div className="flex items-center gap-4">
            {title && <span className="win95-text-title">{title}</span>}
            {enableEnhancedTagging && (
              <div className="flex items-center gap-2">
                <span className="win95-badge win95-badge-info">
                  Enhanced Tagging
                </span>
                <button
                  className="win95-button"
                  onClick={() => setShowEnhancedMode(!showEnhancedMode)}
                >
                  {showEnhancedMode ? 'Basic Mode' : 'Enhanced Mode'}
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onPrev && (
              <button className="win95-button" onClick={onPrev}>
                ← Previous
              </button>
            )}
            {onNext && (
              <button className="win95-button" onClick={onNext}>
                Next →
              </button>
            )}
            <button className="win95-close" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* Main Content - Windows 95 Style */}
        <div className="win95-lightbox-content flex-1 flex gap-4">
          {/* Image Container */}
          <div className="flex-1 relative win95-panel overflow-hidden" style={{ backgroundColor: 'var(--win95-black)' }}>
            <img
              src={imageUrl}
              alt={title || 'Vehicle image'}
              className="w-full h-full object-contain"
            />

            {/* Tag Overlay */}
            {enableEnhancedTagging && showEnhancedMode ? (
              <EnhancedTagOverlay
                tags={tags}
                activeTagId={activeTagId}
                tagText={tagText}
                selectedTagType={selectedTagType}
                tagSaving={tagSaving}
                showAISuggestions={true}
                onTagSave={handleTagSave}
                onTagDelete={handleTagDelete}
                onTagTextChange={setTagText}
                onTagTypeChange={setSelectedTagType}
                onRunAIAnalysis={handleRunAIAnalysis}
                onTagClick={handleTagClick}
              />
            ) : (
              /* Fallback to basic tagging mode - Windows 95 Style */
              <div className="absolute top-4 right-4">
                <button
                  className="win95-button-primary"
                  onClick={() => setShowEnhancedMode(true)}
                >
                  Enable Enhanced Tagging
                </button>
              </div>
            )}
          </div>

          {/* Sidebar Info - Windows 95 Style */}
          {description && (
            <div className="win95-panel w-80 p-4">
              <div className="space-y-4">
                <div>
                  <h3 className="win95-text-title mb-2">Image Details</h3>
                  <p className="win95-text-body">{description}</p>
                </div>

                {enableEnhancedTagging && tags.length > 0 && (
                  <div>
                    <h3 className="win95-text-title mb-2">
                      Tags ({tags.length})
                    </h3>
                    <div className="space-y-2 max-h-60 win95-scrollbar" style={{ overflowY: 'auto' }}>
                      {tags.map((tag) => (
                        <div
                          key={tag.id}
                          className="win95-panel flex items-center justify-between p-2 cursor-pointer"
                          onClick={() => handleTagClick(tag)}
                          style={{ marginBottom: '2px' }}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3"
                              style={{
                                backgroundColor: tag.type === 'damage' ? 'var(--win95-red)' :
                                               tag.type === 'product' ? 'var(--win95-green)' :
                                               tag.type === 'modification' ? 'var(--win95-yellow)' :
                                               'var(--win95-blue)',
                                border: '1px solid var(--win95-black)'
                              }}
                            />
                            <span className="win95-text-body">{tag.text}</span>
                          </div>
                          {tag.automated_confidence && (
                            <span className="win95-badge win95-badge-info">
                              AI {Math.round(tag.automated_confidence * 100)}%
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {showEnhancedMode && (
                  <div className="pt-4" style={{ borderTop: '1px solid var(--win95-dark-gray)' }}>
                    <h3 className="win95-text-title mb-2">Enhanced Features</h3>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2" style={{ backgroundColor: 'var(--win95-green)', border: '1px solid var(--win95-black)' }}></span>
                        <span className="win95-text-body">AI-powered tag detection</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2" style={{ backgroundColor: 'var(--win95-blue)', border: '1px solid var(--win95-black)' }}></span>
                        <span className="win95-text-body">Severity level tracking</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2" style={{ backgroundColor: 'var(--win95-purple)', border: '1px solid var(--win95-black)' }}></span>
                        <span className="win95-text-body">Cost estimation</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2" style={{ backgroundColor: 'var(--win95-yellow)', border: '1px solid var(--win95-black)' }}></span>
                        <span className="win95-text-body">Service integration</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};