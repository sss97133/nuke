import React, { memo, useState, useCallback } from 'react';
import { SpatialTag, TagType, getTagColor, TAG_TYPES } from '../constants';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { SimpleSelect } from '../../ui/select';
import { Textarea } from '../../ui/textarea';
import '../../../styles/windows95.css';
import {
  Settings,
  Trash2,
  Save,
  Plus,
  Sparkles,
  MapPin,
  Wrench,
  AlertTriangle,
  Package,
  ChevronDown,
  X
} from 'lucide-react';

interface EnhancedSpatialTag extends SpatialTag {
  // Enhanced fields from backend SpatialTag
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

interface EnhancedTagOverlayProps {
  tags: EnhancedSpatialTag[];
  activeTagId?: string | null;
  tagText?: string;
  selectedTagType?: TagType;
  tagSaving: boolean;
  showAISuggestions?: boolean;
  onTagSave: (tagId: string) => void;
  onTagDelete: (tagId: string) => void;
  onTagTextChange: (text: string) => void;
  onTagTypeChange: (type: TagType) => void;
  onRunAIAnalysis?: () => void;
  onTagClick?: (tag: EnhancedSpatialTag) => void;
}

const EnhancedTagOverlay: React.FC<EnhancedTagOverlayProps> = memo(({
  tags,
  activeTagId,
  tagText = '',
  selectedTagType = 'product',
  tagSaving,
  showAISuggestions = true,
  onTagSave,
  onTagDelete,
  onTagTextChange,
  onTagTypeChange,
  onRunAIAnalysis,
  onTagClick
}) => {
  const [expandedTagId, setExpandedTagId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const getTagIcon = (tagType: TagType) => {
    switch (tagType) {
      case 'damage': return AlertTriangle;
      case 'modification': return Wrench;
      case 'location': return MapPin;
      case 'product': return Package;
      default: return Settings;
    }
  };

  const getSeverityColor = (severity?: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500';
      case 'severe': return 'bg-orange-500';
      case 'moderate': return 'bg-yellow-500';
      case 'minor': return 'bg-green-500';
      default: return 'bg-gray-400';
    }
  };

  const formatCost = (cents?: number) => {
    if (!cents) return null;
    return `$${(cents / 100).toLocaleString()}`;
  };

  const renderTagMarker = useCallback((tag: EnhancedSpatialTag) => {
    const TagIcon = getTagIcon(tag.type);
    const isActive = tag.id === activeTagId;
    const isExpanded = tag.id === expandedTagId;
    const isEditing = tag.isEditing && isActive;

    return (
      <div
        key={tag.id}
        className={`tag-marker group relative transition-all duration-200 ${isActive ? 'z-30' : 'z-10'}`}
        style={{
          position: 'absolute',
          left: `${tag.x}%`,
          top: `${tag.y}%`,
          transform: 'translate(-50%, -50%)'
        }}
      >
        {/* Enhanced Tag Dot - Windows 95 Style */}
        <div
          className={`win95-tag-dot ${isActive ? 'active' : ''}`}
          onClick={() => {
            onTagClick?.(tag);
            setExpandedTagId(isExpanded ? null : tag.id);
          }}
        >
          <TagIcon
            size={10}
            className=""
          />

          {/* AI Confidence Indicator - Windows 95 Style */}
          {tag.source_type === 'ai_detected' && tag.automated_confidence && (
            <div className="absolute -top-1 -right-1">
              <div className={`w-3 h-3 border flex items-center justify-center ${
                tag.automated_confidence > 0.8 ? 'win95-confidence-high' :
                tag.automated_confidence > 0.6 ? 'win95-confidence-medium' : 'win95-confidence-low'
              }`} style={{ backgroundColor: 'var(--win95-gray)', fontSize: '6px' }}>
                AI
              </div>
            </div>
          )}

          {/* Severity Indicator - Windows 95 Style */}
          {tag.severity_level && (
            <div className={`absolute -bottom-1 -right-1 w-2 h-2 win95-severity-${tag.severity_level}`} style={{ border: '1px solid var(--win95-black)' }} />
          )}
        </div>

        {/* Quick Info Tooltip - Windows 95 Style */}
        {!isEditing && !isExpanded && tag.text && (
          <div className="win95-tooltip absolute left-1/2 -top-12 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="win95-text-body">{tag.text}</div>
            {(tag.product_name || tag.service_name) && (
              <div className="win95-text-small mt-1">
                {tag.product_name || tag.service_name}
              </div>
            )}
          </div>
        )}

        {/* Expanded Info Panel - Windows 95 Style */}
        {isExpanded && !isEditing && (
          <div className="win95-tag-panel absolute left-1/2 -top-2 transform -translate-x-1/2 -translate-y-full w-80">
            <div className="win95-tag-panel-header">
              <div className="flex items-center gap-2">
                <span className="win95-text-title">{TAG_TYPES.find(t => t.value === tag.type)?.label}</span>
                {tag.source_type === 'ai_detected' && (
                  <span className="win95-badge win95-badge-info">
                    <Sparkles size={8} className="mr-1" />
                    AI {Math.round((tag.automated_confidence || 0) * 100)}%
                  </span>
                )}
              </div>
              <button
                className="win95-close"
                onClick={() => setExpandedTagId(null)}
              >
                ×
              </button>
            </div>
            <div className="win95-tag-panel-body">
              <h4 className="win95-text-title mb-2">{tag.text}</h4>

              {/* Enhanced Details - Windows 95 Style */}
              <div className="space-y-2">
                {tag.product_name && (
                  <div className="flex justify-between">
                    <span className="win95-text-body">Product:</span>
                    <span className="win95-text-body font-bold">{tag.product_name}</span>
                  </div>
                )}

                {tag.service_name && (
                  <div className="flex justify-between">
                    <span className="win95-text-body">Service:</span>
                    <span className="win95-text-body font-bold">{tag.service_name}</span>
                  </div>
                )}

                {tag.estimated_cost_cents && (
                  <div className="flex justify-between">
                    <span className="win95-text-body">Est. Cost:</span>
                    <span className="win95-text-body font-bold" style={{ color: 'var(--win95-green)' }}>{formatCost(tag.estimated_cost_cents)}</span>
                  </div>
                )}

                {tag.severity_level && (
                  <div className="flex justify-between">
                    <span className="win95-text-body">Severity:</span>
                    <span className={`win95-badge win95-severity-${tag.severity_level}`}>
                      {tag.severity_level}
                    </span>
                  </div>
                )}

                {tag.service_status && (
                  <div className="flex justify-between">
                    <span className="win95-text-body">Status:</span>
                    <span className="win95-badge">
                      {tag.service_status.replace('_', ' ')}
                    </span>
                  </div>
                )}
              </div>

              {/* Quick Actions - Windows 95 Style */}
              <div className="flex gap-2 mt-4 pt-2" style={{ borderTop: '1px solid var(--win95-dark-gray)' }}>
                <button
                  className="win95-button flex-1"
                  onClick={() => {
                    onTagTextChange(tag.text);
                    onTagTypeChange(tag.type);
                    setExpandedTagId(null);
                  }}
                >
                  Edit
                </button>
                <button
                  className="win95-button"
                  onClick={() => onTagDelete(tag.id)}
                  style={{ color: 'var(--win95-red)' }}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Enhanced Edit Form - Windows 95 Style */}
        {isEditing && tag.id === activeTagId && (
          <div className="win95-tag-panel absolute left-1/2 -top-2 transform -translate-x-1/2 -translate-y-full w-96">
            <div className="win95-tag-panel-header">
              <span className="win95-text-title">Edit Tag</span>
              <button
                className="win95-close"
                onClick={() => setExpandedTagId(null)}
              >
                ×
              </button>
            </div>
            <div className="win95-tag-form">
              <div className="space-y-4">

                {/* Basic Fields - Windows 95 Style */}
                <div className="space-y-3">
                  <div className="win95-form-group">
                    <label className="win95-label">
                      Description *
                    </label>
                    <input
                      className="win95-input w-full"
                      value={tagText}
                      onChange={(e) => onTagTextChange(e.target.value)}
                      placeholder="Describe what you see..."
                      autoFocus
                    />
                  </div>

                  <div className="win95-form-group">
                    <label className="win95-label">
                      Tag Type *
                    </label>
                    <select
                      className="win95-select w-full"
                      value={selectedTagType}
                      onChange={(e) => onTagTypeChange(e.target.value as TagType)}
                    >
                      {TAG_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Advanced Fields Toggle - Windows 95 Style */}
                <button
                  className="win95-button w-full justify-between"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  Advanced Options
                  <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                </button>

                {/* Advanced Fields - Windows 95 Style */}
                {showAdvanced && (
                  <div className="space-y-3 pt-2" style={{ borderTop: '1px solid var(--win95-dark-gray)' }}>
                    {selectedTagType === 'damage' && (
                      <div className="win95-form-group">
                        <label className="win95-label">
                          Severity Level
                        </label>
                        <select
                          className="win95-select w-full"
                          defaultValue="moderate"
                        >
                          <option value="minor">Minor</option>
                          <option value="moderate">Moderate</option>
                          <option value="severe">Severe</option>
                          <option value="critical">Critical</option>
                        </select>
                      </div>
                    )}

                    <div className="win95-form-group">
                      <label className="win95-label">
                        Estimated Cost ($)
                      </label>
                      <input
                        className="win95-input w-full"
                        type="number"
                        placeholder="0.00"
                      />
                    </div>

                    <div className="win95-form-group">
                      <label className="win95-label">
                        Additional Notes
                      </label>
                      <textarea
                        className="win95-input w-full"
                        placeholder="Any additional details..."
                        rows={3}
                      />
                    </div>
                  </div>
                )}

                {/* Action Buttons - Windows 95 Style */}
                <div className="flex gap-2 pt-2">
                  <button
                    className="win95-button"
                    onClick={() => onTagDelete(tag.id)}
                    disabled={tagSaving}
                    style={{ color: 'var(--win95-red)' }}
                  >
                    <Trash2 size={10} className="mr-1" />
                    Delete
                  </button>

                  <button
                    className={`win95-button flex-1 ${tagSaving || !tagText.trim() ? '' : 'win95-button-primary'}`}
                    onClick={() => onTagSave(tag.id)}
                    disabled={tagSaving || !tagText.trim()}
                  >
                    <Save size={10} className="mr-1" />
                    {tagSaving ? 'Saving...' : 'Save Tag'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }, [activeTagId, expandedTagId, tagText, selectedTagType, tagSaving, showAdvanced, onTagClick, onTagTextChange, onTagTypeChange, onTagSave, onTagDelete]);

  return (
    <div className="tag-overlay absolute inset-0 pointer-events-none">
      {/* AI Analysis Button - Windows 95 Style */}
      {showAISuggestions && onRunAIAnalysis && (
        <div className="absolute top-4 right-4 pointer-events-auto">
          <button
            onClick={onRunAIAnalysis}
            className="win95-ai-button"
          >
            <Sparkles size={10} className="mr-1" />
            AI Analysis
          </button>
        </div>
      )}

      {/* Enhanced Tag Markers */}
      {tags.map(renderTagMarker)}

      {/* Tag Count Badge - Windows 95 Style */}
      {tags.length > 0 && (
        <div className="absolute bottom-4 left-4 pointer-events-auto">
          <div className="win95-tag-count">
            {tags.length} tag{tags.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
});

EnhancedTagOverlay.displayName = 'EnhancedTagOverlay';

export default EnhancedTagOverlay;