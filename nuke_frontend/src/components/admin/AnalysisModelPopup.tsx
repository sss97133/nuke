/**
 * AnalysisModelPopup - Clickable analysis model reference that shows what it searches for and outputs
 * Usage: Wrap any analysis model name with this component
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface AnalysisModelPopupProps {
  modelName: string;
  children: React.ReactNode;
  className?: string;
}

interface ModelInfo {
  name: string;
  description: string;
  searchesFor: string[];
  outputs: string[];
  tier?: string;
  cost?: string;
}

// Model definitions - what each model searches for and outputs
const MODEL_DEFINITIONS: Record<string, ModelInfo> = {
  'gemini-1.5-flash': {
    name: 'Gemini 1.5 Flash',
    description: 'Fast, free tier model for basic image analysis',
    searchesFor: [
      'Vehicle angle (front, side, rear, interior)',
      'Primary visual elements',
      'Basic context (location, environment)',
      'Image quality and presentation'
    ],
    outputs: [
      'Angle classification',
      'Primary label',
      'Description',
      'Context extraction (environment, presentation, care assessment)',
      'Basic metadata'
    ],
    tier: 'free',
    cost: '$0.00 per image'
  },
  'gemini-2.0-flash': {
    name: 'Gemini 2.0 Flash',
    description: 'Enhanced version with better accuracy',
    searchesFor: [
      'Vehicle angle and perspective',
      'Visual elements and components',
      'Context and environment',
      'Presentation quality',
      'Care indicators'
    ],
    outputs: [
      'Angle classification',
      'Primary label',
      'Detailed description',
      'Context extraction',
      'Enhanced metadata'
    ],
    tier: 'free',
    cost: '$0.00 per image'
  },
  'gpt-4o': {
    name: 'GPT-4o',
    description: 'Tier 2 expert analysis with reference context',
    searchesFor: [
      'Component identifications',
      'Damage and defects',
      'Modifications and aftermarket parts',
      'Reference document matches',
      'Knowledge gaps'
    ],
    outputs: [
      'Confirmed findings (with citations)',
      'Inferred findings',
      'Unknown items',
      'Research queue',
      'Handoff notes',
      'Confidence scores'
    ],
    tier: 'premium',
    cost: '~$0.01-0.05 per image'
  },
  'claude-3-haiku': {
    name: 'Claude 3 Haiku',
    description: 'Fast analysis model',
    searchesFor: [
      'Basic visual elements',
      'Vehicle characteristics',
      'Context information'
    ],
    outputs: [
      'Angle classification',
      'Description',
      'Basic metadata'
    ],
    tier: 'free',
    cost: '~$0.00 per image'
  },
  'claude-3-sonnet': {
    name: 'Claude 3 Sonnet',
    description: 'Balanced performance and accuracy',
    searchesFor: [
      'Detailed visual analysis',
      'Component identification',
      'Context and environment'
    ],
    outputs: [
      'Comprehensive description',
      'Component details',
      'Context extraction'
    ],
    tier: 'premium',
    cost: '~$0.003 per image'
  },
  'claude-3-opus': {
    name: 'Claude 3 Opus',
    description: 'Highest accuracy, most expensive',
    searchesFor: [
      'Deep visual analysis',
      'Complex component identification',
      'Detailed context',
      'Expert-level insights'
    ],
    outputs: [
      'Expert-level analysis',
      'Detailed findings',
      'Comprehensive metadata'
    ],
    tier: 'premium',
    cost: '~$0.015 per image'
  }
};

export const AnalysisModelPopup: React.FC<AnalysisModelPopupProps> = ({
  modelName,
  children,
  className = ''
}) => {
  const [showPopup, setShowPopup] = useState(false);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [usageStats, setUsageStats] = useState<{ count: number; lastUsed?: string } | null>(null);

  useEffect(() => {
    // Get model info from definitions
    const info = MODEL_DEFINITIONS[modelName.toLowerCase()] || {
      name: modelName,
      description: 'Analysis model',
      searchesFor: ['Visual elements', 'Context information'],
      outputs: ['Analysis results', 'Metadata']
    };
    setModelInfo(info);

    // Load usage stats
    loadUsageStats();
  }, [modelName]);

  const loadUsageStats = async () => {
    try {
      // Count images extracted with this model
      const { data: images, error } = await supabase
        .from('vehicle_images')
        .select('ai_scan_metadata, created_at')
        .not('ai_scan_metadata', 'is', null)
        .limit(1000); // Sample to get stats

      if (error) throw error;

      let count = 0;
      let lastUsed: string | undefined;

      images?.forEach(img => {
        const meta = img.ai_scan_metadata;
        if (meta?.extractions) {
          Object.keys(meta.extractions).forEach(model => {
            if (model.toLowerCase() === modelName.toLowerCase()) {
              count++;
              const extracted = meta.extractions[model];
              if (extracted?.extracted_at) {
                const extractedAt = new Date(extracted.extracted_at);
                if (!lastUsed || extractedAt > new Date(lastUsed)) {
                  lastUsed = extracted.extracted_at;
                }
              }
            }
          });
        } else if (meta?.appraiser?.model?.toLowerCase() === modelName.toLowerCase()) {
          count++;
          if (meta.appraiser.extracted_at) {
            const extractedAt = new Date(meta.appraiser.extracted_at);
            if (!lastUsed || extractedAt > new Date(lastUsed)) {
              lastUsed = meta.appraiser.extracted_at;
            }
          }
        }
      });

      setUsageStats({ count, lastUsed });
    } catch (error) {
      console.error('Error loading usage stats:', error);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowPopup(true);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!modelInfo) return <>{children}</>;

  return (
    <>
      <span
        className={className}
        onClick={handleClick}
        style={{
          cursor: 'pointer',
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          color: 'var(--accent)'
        }}
      >
        {children}
      </span>

      {showPopup && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10001,
            width: '90%',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflowY: 'auto',
            backgroundColor: 'var(--white)',
            border: '2px solid var(--border-medium)',
            borderRadius: '0px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            padding: 'var(--space-4)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'var(--space-4)' }}>
            <div>
              <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
                {modelInfo.name}
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                {modelInfo.description}
              </div>
            </div>
            <button
              onClick={() => setShowPopup(false)}
              style={{
                fontSize: '8pt',
                padding: 'var(--space-1) var(--space-2)',
                border: '2px solid var(--border-light)',
                backgroundColor: 'var(--bg)',
                cursor: 'pointer'
              }}
            >
              CLOSE
            </button>
          </div>

          {/* Usage Stats */}
          {usageStats && (
            <div style={{
              padding: 'var(--space-2)',
              backgroundColor: 'var(--bg)',
              border: '1px solid var(--border-light)',
              marginBottom: 'var(--space-4)',
              fontSize: '8pt'
            }}>
              <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>Usage Statistics</div>
              <div style={{ color: 'var(--text-muted)' }}>
                Used for {usageStats.count} image{usageStats.count !== 1 ? 's' : ''}
                {usageStats.lastUsed && (
                  <span> • Last used: {formatDate(usageStats.lastUsed)}</span>
                )}
              </div>
            </div>
          )}

          {/* Model Tier & Cost */}
          {(modelInfo.tier || modelInfo.cost) && (
            <div style={{
              padding: 'var(--space-2)',
              backgroundColor: modelInfo.tier === 'premium' ? 'var(--warning-dim)' : 'var(--success-dim)',
              border: '1px solid var(--border-light)',
              marginBottom: 'var(--space-4)',
              fontSize: '8pt'
            }}>
              <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                Tier: {modelInfo.tier === 'premium' ? 'Premium' : 'Free'}
              </div>
              {modelInfo.cost && (
                <div style={{ color: 'var(--text-muted)' }}>
                  Cost: {modelInfo.cost}
                </div>
              )}
            </div>
          )}

          {/* Searches For */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              What This Model Searches For
            </div>
            <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: '8pt', color: 'var(--text)' }}>
              {modelInfo.searchesFor.map((item, idx) => (
                <li key={idx} style={{ marginBottom: 'var(--space-1)' }}>{item}</li>
              ))}
            </ul>
          </div>

          {/* Outputs */}
          <div>
            <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              What This Model Outputs
            </div>
            <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: '8pt', color: 'var(--text)' }}>
              {modelInfo.outputs.map((item, idx) => (
                <li key={idx} style={{ marginBottom: 'var(--space-1)' }}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Backdrop */}
      {showPopup && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.3)',
            zIndex: 10000
          }}
          onClick={() => setShowPopup(false)}
        />
      )}
    </>
  );
};

