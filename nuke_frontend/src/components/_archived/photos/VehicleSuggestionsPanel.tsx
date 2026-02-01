/**
 * Vehicle Suggestions Panel
 * 
 * Displays AI-suggested vehicle groupings for user review
 * User can accept (creates vehicle profile), edit, or reject
 */

import React, { useState } from 'react';
import { VehicleSuggestion } from '../../services/personalPhotoLibraryService';

interface VehicleSuggestionsPanelProps {
  suggestions: VehicleSuggestion[];
  onAccept: (suggestion: VehicleSuggestion) => void;
  onReject: (suggestionId: string) => void;
}

export const VehicleSuggestionsPanel: React.FC<VehicleSuggestionsPanelProps> = ({
  suggestions,
  onAccept,
  onReject
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (suggestions.length === 0) {
    return (
      <div className="card">
        <div className="card-body" style={{
          textAlign: 'center',
          padding: '60px 20px'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>AI</div>
          <div className="text font-bold" style={{ fontSize: '14px', marginBottom: '8px' }}>No AI Suggestions Yet</div>
          <div className="text text-small text-muted">
            Upload photos and AI will automatically group them by vehicle
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-body">
          <div className="text font-bold" style={{ marginBottom: '6px' }}>
            AI Found {suggestions.length} Vehicle{suggestions.length !== 1 ? 's' : ''} in Your Photos
          </div>
          <div className="text text-small text-muted">
            Review each suggestion and confirm to create vehicle profiles automatically
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {suggestions.map(suggestion => {
          const expanded = expandedId === suggestion.id;
          const confidencePercent = Math.round(suggestion.confidence * 100);
          const confidenceColor = 
            confidencePercent >= 80 ? 'var(--success)' :
            confidencePercent >= 50 ? '#ff9d00' :
            '#dc2626';

          return (
            <div
              key={suggestion.id}
              className="card"
            >
              {/* Header */}
              <div
                onClick={() => setExpandedId(expanded ? null : suggestion.id)}
                className="card-body"
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  background: expanded ? 'var(--grey-100)' : 'var(--white)',
                  transition: 'background 0.12s ease',
                  borderBottom: expanded ? '1px solid var(--border-light)' : 'none'
                }}
              >
                {/* Sample Images Preview */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  {suggestion.sample_images?.slice(0, 3).map((img, idx) => (
                    <img
                      key={img.id}
                      src={img.variants?.thumbnail || img.image_url}
                      alt=""
                      style={{
                        width: '48px',
                        height: '48px',
                        objectFit: 'cover',
                        border: '1px solid var(--border-medium)'
                      }}
                    />
                  ))}
                </div>

                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div className="text font-bold" style={{ marginBottom: '2px' }}>
                    {suggestion.suggested_year} {suggestion.suggested_make} {suggestion.suggested_model}
                  </div>
                  <div className="text text-small text-muted">
                    {suggestion.image_count} photos • Confidence: {confidencePercent}%
                  </div>
                  {suggestion.suggested_vin && (
                    <div className="text text-small" style={{ 
                      marginTop: '2px',
                      color: 'var(--primary)',
                      fontFamily: 'monospace'
                    }}>
                      VIN: {suggestion.suggested_vin}
                    </div>
                  )}
                </div>

                {/* Confidence Badge */}
                <div style={{
                  padding: '6px 12px',
                  background: 'var(--grey-200)',
                  color: confidenceColor,
                  fontSize: '11px',
                  fontWeight: '700',
                  border: '1px solid var(--border-medium)'
                }}>
                  {confidencePercent}%
                </div>

                {/* Expand Arrow */}
                <div className="text text-muted" style={{ fontSize: '16px' }}>
                  {expanded ? '▼' : '▶'}
                </div>
              </div>

              {/* Expanded Content */}
              {expanded && (
                <div className="card-body" style={{ background: 'var(--grey-50)' }}>
                  {/* Detection Method */}
                  <div style={{ marginBottom: '16px' }}>
                    <div className="text text-small text-muted" style={{ marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Detection Method
                    </div>
                    <div className="text text-small">
                      {suggestion.detection_method === 'visual_analysis' && 'Visual Analysis'}
                      {suggestion.detection_method === 'vin_detection' && 'VIN Detection'}
                      {suggestion.detection_method === 'exif_clustering' && 'EXIF Clustering'}
                      {suggestion.detection_method === 'user_pattern' && 'Usage Pattern'}
                    </div>
                  </div>

                  {/* AI Reasoning */}
                  {suggestion.reasoning && (
                    <div style={{ marginBottom: '16px' }}>
                      <div className="text text-small text-muted" style={{ marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        AI Reasoning
                      </div>
                      <div className="text text-small" style={{ lineHeight: '1.4' }}>
                        {suggestion.reasoning}
                      </div>
                    </div>
                  )}

                  {/* All Sample Images */}
                  {suggestion.sample_images && suggestion.sample_images.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div className="text text-small text-muted" style={{ marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Sample Photos
                      </div>
                      <div style={{ 
                        display: 'grid',
                        gridTemplateColumns: 'repeat(5, 1fr)',
                        gap: '6px'
                      }}>
                        {suggestion.sample_images.map(img => (
                          <div
                            key={img.id}
                            style={{
                              paddingBottom: '100%',
                              position: 'relative',
                              border: '1px solid var(--border-medium)',
                              overflow: 'hidden'
                            }}
                          >
                            <img
                              src={img.variants?.small || img.image_url}
                              alt=""
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover'
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                    <button
                      onClick={() => onAccept(suggestion)}
                      className="button button-primary"
                      style={{
                        flex: 1,
                        padding: '10px',
                        fontSize: '11px'
                      }}
                    >
                      Accept & Create Vehicle Profile
                    </button>
                    <button
                      onClick={() => onReject(suggestion.id)}
                      className="button button-secondary"
                      style={{
                        padding: '10px 20px',
                        fontSize: '11px'
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

