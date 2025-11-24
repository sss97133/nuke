import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export type AIProvider = 'openai' | 'anthropic' | 'custom';

interface AIModel {
  provider: AIProvider;
  modelName: string;
  displayName: string;
  icon?: string;
}

interface AIModelSelectorProps {
  onModelSelect?: (provider: AIProvider, modelName: string) => void;
  selectedProvider?: AIProvider;
  compact?: boolean;
}

const AIModelSelector: React.FC<AIModelSelectorProps> = ({
  onModelSelect,
  selectedProvider,
  compact = false
}) => {
  const [availableModels, setAvailableModels] = useState<AIModel[]>([
    { provider: 'openai', modelName: 'gpt-4o', displayName: 'GPT-4o', icon: '🤖' },
    { provider: 'anthropic', modelName: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5', icon: '🧠' },
    { provider: 'custom', modelName: 'custom', displayName: 'Custom', icon: '⚙️' }
  ]);
  const [userProviders, setUserProviders] = useState<any[]>([]);
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    loadUserProviders();
  }, []);

  const loadUserProviders = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      
      setSession(session);

      const { data } = await supabase
        .from('user_ai_providers')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('is_active', true)
        .order('is_default', { ascending: false });

      if (data) {
        setUserProviders(data);
        // Add custom models from user's providers
        const customModels = data
          .filter(p => p.provider === 'custom')
          .map(p => ({
            provider: 'custom' as AIProvider,
            modelName: p.model_name,
            displayName: p.model_name,
            icon: '⚙️'
          }));
        setAvailableModels(prev => [...prev.filter(m => m.provider !== 'custom'), ...customModels]);
      }
    } catch (error) {
      console.error('Error loading user AI providers:', error);
    }
  };

  const handleModelClick = (provider: AIProvider, modelName: string) => {
    if (onModelSelect) {
      onModelSelect(provider, modelName);
    }
  };

  if (compact) {
    return (
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {availableModels.map(model => (
          <button
            key={`${model.provider}-${model.modelName}`}
            onClick={() => handleModelClick(model.provider, model.modelName)}
            style={{
              padding: '4px 8px',
              fontSize: '8pt',
              border: selectedProvider === model.provider 
                ? '2px solid var(--primary)' 
                : '1px solid var(--border)',
              background: selectedProvider === model.provider 
                ? 'var(--primary-dim)' 
                : 'var(--white)',
              cursor: 'pointer',
              borderRadius: '4px',
              fontWeight: selectedProvider === model.provider ? 'bold' : 'normal'
            }}
            title={`Use ${model.displayName}`}
          >
            {model.icon} {model.displayName}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      padding: 'var(--space-3)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      background: 'var(--white)'
    }}>
      <div className="text text-small font-bold" style={{ marginBottom: 'var(--space-2)' }}>
        AI Model
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {availableModels.map(model => (
          <button
            key={`${model.provider}-${model.modelName}`}
            onClick={() => handleModelClick(model.provider, model.modelName)}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              textAlign: 'left',
              border: selectedProvider === model.provider 
                ? '2px solid var(--primary)' 
                : '1px solid var(--border)',
              background: selectedProvider === model.provider 
                ? 'var(--primary-dim)' 
                : 'var(--white)',
              cursor: 'pointer',
              borderRadius: '4px',
              fontSize: '9pt',
              fontWeight: selectedProvider === model.provider ? 'bold' : 'normal',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <span>{model.icon}</span>
            <span>{model.displayName}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default AIModelSelector;

