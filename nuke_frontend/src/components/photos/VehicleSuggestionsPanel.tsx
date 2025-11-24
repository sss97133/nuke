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
      <div style={{
        textAlign: 'center',
        padding: '80px 20px',
        color: '#666'
      }}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>🤖</div>
        <div style={{ fontSize: '18px', marginBottom: '10px' }}>No AI Suggestions Yet</div>
        <div style={{ fontSize: '14px' }}>
          Upload photos and AI will automatically group them by vehicle
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ 
        marginBottom: '30px',
        padding: '20px',
        background: '#1a1a1a',
        border: '2px solid #333',
        borderRadius: '8px'
      }}>
        <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', color: '#fff' }}>
          AI Found {suggestions.length} Vehicle{suggestions.length !== 1 ? 's' : ''} in Your Photos
        </div>
        <div style={{ fontSize: '14px', color: '#888' }}>
          Review each suggestion and confirm to create vehicle profiles automatically
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {suggestions.map(suggestion => {
          const expanded = expandedId === suggestion.id;
          const confidencePercent = Math.round(suggestion.confidence * 100);
          const confidenceColor = 
            confidencePercent >= 80 ? '#00c853' :
            confidencePercent >= 50 ? '#ff9d00' :
            '#ff4444';

          return (
            <div
              key={suggestion.id}
              style={{
                background: '#1a1a1a',
                border: '2px solid #333',
                borderRadius: '8px',
                overflow: 'hidden'
              }}
            >
              {/* Header */}
              <div
                onClick={() => setExpandedId(expanded ? null : suggestion.id)}
                style={{
                  padding: '20px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '20px',
                  background: expanded ? '#222' : 'transparent',
                  transition: 'background 0.12s ease'
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
                        width: '60px',
                        height: '60px',
                        objectFit: 'cover',
                        borderRadius: '4px',
                        border: '2px solid #333'
                      }}
                    />
                  ))}
                </div>

                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px', color: '#fff' }}>
                    {suggestion.suggested_year} {suggestion.suggested_make} {suggestion.suggested_model}
                  </div>
                  <div style={{ fontSize: '14px', color: '#888' }}>
                    {suggestion.image_count} photos • Confidence: {confidencePercent}%
                  </div>
                  {suggestion.suggested_vin && (
                    <div style={{ 
                      marginTop: '4px',
                      fontSize: '12px',
                      color: '#4a9eff',
                      fontFamily: 'monospace'
                    }}>
                      VIN: {suggestion.suggested_vin}
                    </div>
                  )}
                </div>

                {/* Confidence Badge */}
                <div style={{
                  padding: '8px 16px',
                  background: confidenceColor,
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: '600',
                  borderRadius: '6px'
                }}>
                  {confidencePercent}%
                </div>

                {/* Expand Arrow */}
                <div style={{ fontSize: '20px', color: '#666' }}>
                  {expanded ? '▼' : '▶'}
                </div>
              </div>

              {/* Expanded Content */}
              {expanded && (
                <div style={{ padding: '20px', borderTop: '2px solid #333' }}>
                  {/* Detection Method */}
                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      Detection Method
                    </div>
                    <div style={{ fontSize: '14px', color: '#fff' }}>
                      {suggestion.detection_method === 'visual_analysis' && '👁️ Visual Analysis'}
                      {suggestion.detection_method === 'vin_detection' && '🔍 VIN Detection'}
                      {suggestion.detection_method === 'exif_clustering' && '📊 EXIF Clustering'}
                      {suggestion.detection_method === 'user_pattern' && '🎯 Usage Pattern'}
                    </div>
                  </div>

                  {/* AI Reasoning */}
                  {suggestion.reasoning && (
                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                        AI Reasoning
                      </div>
                      <div style={{ fontSize: '14px', color: '#ccc', lineHeight: '1.6' }}>
                        {suggestion.reasoning}
                      </div>
                    </div>
                  )}

                  {/* All Sample Images */}
                  {suggestion.sample_images && suggestion.sample_images.length > 0 && (
                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                        Sample Photos
                      </div>
                      <div style={{ 
                        display: 'grid',
                        gridTemplateColumns: 'repeat(5, 1fr)',
                        gap: '8px'
                      }}>
                        {suggestion.sample_images.map(img => (
                          <img
                            key={img.id}
                            src={img.variants?.small || img.image_url}
                            alt=""
                            style={{
                              width: '100%',
                              paddingBottom: '100%',
                              objectFit: 'cover',
                              borderRadius: '4px',
                              border: '2px solid #333'
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                    <button
                      onClick={() => onAccept(suggestion)}
                      style={{
                        flex: 1,
                        padding: '14px',
                        background: '#00c853',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '15px',
                        fontWeight: '600',
                        transition: 'all 0.12s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#00e160'}
                      onMouseLeave={(e) => e.currentTarget.style.background = '#00c853'}
                    >
                      Accept & Create Vehicle Profile
                    </button>
                    <button
                      onClick={() => onReject(suggestion.id)}
                      style={{
                        padding: '14px 24px',
                        background: '#333',
                        color: '#fff',
                        border: '2px solid #555',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '15px',
                        fontWeight: '600',
                        transition: 'all 0.12s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#ff4444';
                        e.currentTarget.style.borderColor = '#ff4444';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#333';
                        e.currentTarget.style.borderColor = '#555';
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

