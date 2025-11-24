import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';

export type AIProvider = 'openai' | 'anthropic' | 'custom';

export { AIProvider };

interface AIModel {
  provider: AIProvider;
  modelName: string;
  displayName: string;
  icon?: string;
  enabled: boolean;
}

interface AIModelSelectorProps {
  onModelSelect?: (provider: AIProvider, modelName: string, enabled: boolean) => void;
  selectedProvider?: AIProvider;
}

const AIModelSelector: React.FC<AIModelSelectorProps> = ({
  onModelSelect,
  selectedProvider
}) => {
  const [availableModels, setAvailableModels] = useState<AIModel[]>([
    { provider: 'openai', modelName: 'gpt-4o', displayName: 'GPT-4o', icon: '', enabled: false },
    { provider: 'anthropic', modelName: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5', icon: '', enabled: false },
    { provider: 'custom', modelName: 'custom', displayName: 'Custom', icon: '', enabled: false }
  ]);
  const [userProviders, setUserProviders] = useState<any[]>([]);
  const [session, setSession] = useState<any>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadUserProviders();
  }, []);

  useEffect(() => {
    // Close dropdown on outside click
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

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
            icon: '',
            enabled: false
          }));
        setAvailableModels(prev => [...prev.filter(m => m.provider !== 'custom'), ...customModels]);
      }
    } catch (error) {
      console.error('Error loading user AI providers:', error);
    }
  };

  const handleToggle = (provider: AIProvider, modelName: string, enabled: boolean) => {
    setAvailableModels(prev => prev.map(m => 
      m.provider === provider && m.modelName === modelName 
        ? { ...m, enabled: !m.enabled }
        : { ...m, enabled: false } // Only one can be enabled at a time
    ));
    
    if (onModelSelect) {
      onModelSelect(provider, modelName, !enabled);
    }
  };

  const enabledModel = availableModels.find(m => m.enabled);
  const buttonText = enabledModel ? enabledModel.displayName.substring(0, 3).toUpperCase() : 'MOD';

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Small Button */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        style={{
          padding: '0px 4px',
          fontSize: '6pt',
          border: '1px solid var(--border)',
          background: enabledModel ? 'var(--primary-dim)' : 'var(--white)',
          cursor: 'pointer',
          borderRadius: '2px',
          minWidth: '24px',
          height: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 'bold',
          lineHeight: '1'
        }}
        title="Model"
      >
        {buttonText}
      </button>

      {/* Dropdown Menu */}
      {showDropdown && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: '180px',
            background: 'var(--white)',
            border: '2px solid var(--border)',
            borderRadius: '4px',
            boxShadow: '2px 2px 8px rgba(0,0,0,0.2)',
            zIndex: 10000,
            padding: '4px'
          }}
        >
          {availableModels.map(model => (
            <div
              key={`${model.provider}-${model.modelName}`}
              style={{
                padding: '6px 8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                fontSize: '8pt',
                borderBottom: '1px solid var(--border-light)'
              }}
              onClick={() => handleToggle(model.provider, model.modelName, model.enabled)}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-100)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>{model.displayName}</span>
              </div>
              <div style={{
                width: '16px',
                height: '16px',
                border: '1px solid var(--border)',
                borderRadius: '2px',
                background: model.enabled ? 'var(--primary)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10pt'
              }}>
                {model.enabled && '✓'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AIModelSelector;

