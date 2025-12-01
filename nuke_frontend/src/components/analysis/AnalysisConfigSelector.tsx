/**
 * Analysis Configuration Selector
 * Allows users to select LLM provider, model, and analysis tier
 */

import React, { useState } from 'react';
import { PROVIDER_MODELS, TIER_CONFIGS, type LLMProvider, type AnalysisTier } from '../../services/llmProviderConstants';

interface AnalysisConfigSelectorProps {
  onConfigChange?: (config: AnalysisConfig) => void;
  defaultTier?: AnalysisTier;
  defaultProvider?: LLMProvider;
  defaultModel?: string;
}

export interface AnalysisConfig {
  provider?: LLMProvider;
  model?: string;
  tier?: AnalysisTier;
}

export const AnalysisConfigSelector: React.FC<AnalysisConfigSelectorProps> = ({
  onConfigChange,
  defaultTier = 'expert',
  defaultProvider,
  defaultModel
}) => {
  const [selectedTier, setSelectedTier] = useState<AnalysisTier>(defaultTier);
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider | undefined>(defaultProvider);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(defaultModel);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleTierChange = (tier: AnalysisTier) => {
    setSelectedTier(tier);
    const tierConfig = TIER_CONFIGS[tier];
    setSelectedProvider(tierConfig.provider);
    setSelectedModel(tierConfig.model);
    
    onConfigChange?.({
      tier,
      provider: tierConfig.provider,
      model: tierConfig.model
    });
  };

  const handleProviderChange = (provider: LLMProvider) => {
    setSelectedProvider(provider);
    const models = PROVIDER_MODELS[provider];
    const defaultModel = models[0]?.name;
    setSelectedModel(defaultModel);
    
    onConfigChange?.({
      tier: selectedTier,
      provider,
      model: defaultModel
    });
  };

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    onConfigChange?.({
      tier: selectedTier,
      provider: selectedProvider,
      model
    });
  };

  return (
    <div style={{ 
      border: '1px solid var(--border-medium)', 
      padding: '12px', 
      marginBottom: '12px',
      backgroundColor: 'var(--bg-secondary)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ fontSize: '8pt', fontWeight: 'bold', letterSpacing: '0.5px' }}>
          ANALYSIS CONFIGURATION
        </div>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            fontSize: '7pt',
            padding: '2px 6px',
            border: '1px solid var(--border-medium)',
            background: 'transparent',
            cursor: 'pointer'
          }}
        >
          {showAdvanced ? 'HIDE' : 'ADVANCED'}
        </button>
      </div>

      {/* Tier Selection */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
          ANALYSIS TIER
        </div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {(Object.keys(TIER_CONFIGS) as AnalysisTier[]).map(tier => {
            const config = TIER_CONFIGS[tier];
            const isSelected = selectedTier === tier;
            return (
              <button
                key={tier}
                onClick={() => handleTierChange(tier)}
                style={{
                  fontSize: '7pt',
                  padding: '4px 8px',
                  border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-medium)'}`,
                  background: isSelected ? 'var(--accent-light)' : 'transparent',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  fontWeight: isSelected ? 'bold' : 'normal'
                }}
                title={config.description}
              >
                {tier}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: '6pt', color: 'var(--text-muted)', marginTop: '2px' }}>
          {TIER_CONFIGS[selectedTier].description}
        </div>
      </div>

      {/* Advanced Options */}
      {showAdvanced && (
        <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '8px', marginTop: '8px' }}>
          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
            LLM PROVIDER
          </div>
          <select
            value={selectedProvider || ''}
            onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
            style={{
              fontSize: '7pt',
              padding: '4px',
              width: '100%',
              border: '1px solid var(--border-medium)',
              background: 'var(--bg-primary)'
            }}
          >
            <option value="">Auto (based on tier)</option>
            <option value="google">Google Gemini (Free)</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic Claude</option>
          </select>

          {selectedProvider && (
            <>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '8px', marginBottom: '4px' }}>
                MODEL
              </div>
              <select
                value={selectedModel || ''}
                onChange={(e) => handleModelChange(e.target.value)}
                style={{
                  fontSize: '7pt',
                  padding: '4px',
                  width: '100%',
                  border: '1px solid var(--border-medium)',
                  background: 'var(--bg-primary)'
                }}
              >
                {PROVIDER_MODELS[selectedProvider].map(model => (
                  <option key={model.name} value={model.name}>
                    {model.name} ({model.speed}, {model.quality})
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {/* Current Selection Summary */}
      <div style={{ 
        fontSize: '6pt', 
        color: 'var(--text-muted)', 
        marginTop: '8px',
        padding: '4px',
        backgroundColor: 'var(--bg-tertiary)',
        border: '1px solid var(--border-light)'
      }}>
        <strong>Selected:</strong> {selectedTier.toUpperCase()} → {selectedProvider || 'auto'}/{selectedModel || 'auto'}
      </div>
    </div>
  );
};

