import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../hooks/useToast';

interface AIProvider {
  id?: string;
  provider: 'openai' | 'anthropic' | 'custom';
  api_key_encrypted?: string;
  model_name: string;
  is_default: boolean;
  is_active: boolean;
  cost_per_request_cents: number;
}

const AIProviderSettings: React.FC = () => {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [session, setSession] = useState<any>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      
      setSession(session);

      const { data, error } = await supabase
        .from('user_ai_providers')
        .select('*')
        .eq('user_id', session.user.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

      // Handle table not existing (404) or other errors gracefully
      if (error) {
        // PGRST301 = table doesn't exist, PGRST116 = relation not found, 42P01 = PostgreSQL relation does not exist
        if (error.code === 'PGRST301' || error.code === 'PGRST116' || error.code === '42P01') {
          // Table doesn't exist yet, just use empty list
          setProviders([]);
          return;
        }
        // For other errors, log but don't throw
        console.warn('Error loading AI providers:', error);
        setProviders([]);
        return;
      }
      
      setProviders(data || []);
    } catch (error) {
      console.warn('Error loading AI providers:', error);
      setProviders([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (provider: AIProvider) => {
    if (!session?.user) {
      showToast('Not authenticated', 'error');
      return;
    }

    if (!provider.model_name.trim()) {
      showToast('Model name is required', 'warning');
      return;
    }

    try {
      // Encrypt API key via Edge Function
      const { data: encryptData, error: encryptError } = await supabase.functions.invoke('encrypt-api-key', {
        body: { api_key: provider.api_key_encrypted || '' }
      });

      if (encryptError) {
        console.warn('Encryption failed, storing as-is:', encryptError);
      }

      const encryptedKey = encryptData?.encrypted_key || provider.api_key_encrypted || '';

      // If setting as default, unset other defaults first
      if (provider.is_default) {
        await supabase
          .from('user_ai_providers')
          .update({ is_default: false })
          .eq('user_id', session.user.id)
          .neq('id', provider.id || '');
      }

      // Upsert provider
      const { error: upsertError } = await supabase
        .from('user_ai_providers')
        .upsert({
          id: provider.id,
          user_id: session.user.id,
          provider: provider.provider,
          api_key_encrypted: encryptedKey,
          model_name: provider.model_name.trim(),
          is_default: provider.is_default,
          is_active: true,
          cost_per_request_cents: provider.cost_per_request_cents || 0,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'id'
        });

      if (upsertError) throw upsertError;

      showToast('AI provider saved successfully', 'success');
      setEditingProvider(null);
      setShowAddForm(false);
      loadProviders();
    } catch (error: any) {
      console.error('Error saving AI provider:', error);
      showToast(error?.message || 'Failed to save AI provider', 'error');
    }
  };

  const handleDelete = async (providerId: string) => {
    if (!confirm('Are you sure you want to delete this AI provider?')) return;

    try {
      const { error } = await supabase
        .from('user_ai_providers')
        .update({ is_active: false })
        .eq('id', providerId);

      if (error) throw error;
      showToast('AI provider deleted', 'success');
      loadProviders();
    } catch (error: any) {
      console.error('Error deleting AI provider:', error);
      showToast(error?.message || 'Failed to delete AI provider', 'error');
    }
  };

  const defaultModels = [
    { provider: 'openai' as const, modelName: 'gpt-4o', displayName: 'GPT-4o' },
    { provider: 'openai' as const, modelName: 'gpt-4-turbo', displayName: 'GPT-4 Turbo' },
    { provider: 'anthropic' as const, modelName: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet' },
    { provider: 'anthropic' as const, modelName: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus' }
  ];

  if (loading) {
    return <div className="text text-muted">Loading AI providers...</div>;
  }

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="heading-3">AI Providers</h3>
        <button
          onClick={() => setShowAddForm(true)}
          className="button button-primary"
          style={{ fontSize: '8pt', padding: '6px 12px' }}
        >
          + Add Provider
        </button>
      </div>
      <div className="card-body">
        {showAddForm && (
          <div style={{
            padding: 'var(--space-3)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            marginBottom: 'var(--space-3)',
            background: 'var(--grey-50)'
          }}>
            <h4 className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>Add AI Provider</h4>
            <ProviderForm
              provider={{
                provider: 'openai',
                model_name: '',
                is_default: providers.length === 0,
                is_active: true,
                cost_per_request_cents: 0
              }}
              onSave={(p) => {
                handleSave(p);
                setShowAddForm(false);
              }}
              onCancel={() => setShowAddForm(false)}
              defaultModels={defaultModels}
            />
          </div>
        )}

        {providers.length === 0 && !showAddForm && (
          <div className="text text-muted" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
            No AI providers configured. Add one to get started.
          </div>
        )}

        {providers.map(provider => (
          <div
            key={provider.id}
            style={{
              padding: 'var(--space-3)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              marginBottom: 'var(--space-2)',
              background: provider.is_default ? 'var(--primary-dim)' : 'var(--white)'
            }}
          >
            {editingProvider?.id === provider.id ? (
              <ProviderForm
                provider={provider}
                onSave={handleSave}
                onCancel={() => setEditingProvider(null)}
                defaultModels={defaultModels}
              />
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                  <div>
                    <div className="text font-bold">
                      {provider.provider === 'openai' && '🤖'}
                      {provider.provider === 'anthropic' && '🧠'}
                      {provider.provider === 'custom' && '⚙️'}
                      {' '}
                      {provider.model_name}
                      {provider.is_default && (
                        <span style={{
                          marginLeft: '8px',
                          padding: '2px 6px',
                          background: 'var(--primary)',
                          color: 'white',
                          fontSize: '7pt',
                          borderRadius: '2px'
                        }}>
                          DEFAULT
                        </span>
                      )}
                    </div>
                    <div className="text text-small text-muted">
                      Provider: {provider.provider} • Cost: ${(provider.cost_per_request_cents / 100).toFixed(2)} per request
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      onClick={() => setEditingProvider(provider)}
                      className="button button-secondary"
                      style={{ fontSize: '8pt', padding: '4px 8px' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => provider.id && handleDelete(provider.id)}
                      className="button button-secondary"
                      style={{ fontSize: '8pt', padding: '4px 8px' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

interface ProviderFormProps {
  provider: AIProvider;
  onSave: (provider: AIProvider) => void;
  onCancel: () => void;
  defaultModels: Array<{ provider: 'openai' | 'anthropic' | 'custom'; modelName: string; displayName: string }>;
}

const ProviderForm: React.FC<ProviderFormProps> = ({ provider, onSave, onCancel, defaultModels }) => {
  const [formData, setFormData] = useState<AIProvider>(provider);
  const [apiKey, setApiKey] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div>
        <label className="text text-small font-bold" style={{ display: 'block', marginBottom: '4px' }}>
          Provider
        </label>
        <select
          value={formData.provider}
          onChange={(e) => setFormData({ ...formData, provider: e.target.value as any })}
          className="form-select"
          style={{ width: '100%', fontSize: '9pt', padding: '6px 8px' }}
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      <div>
        <label className="text text-small font-bold" style={{ display: 'block', marginBottom: '4px' }}>
          Model Name
        </label>
        <select
          value={formData.model_name}
          onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
          className="form-select"
          style={{ width: '100%', fontSize: '9pt', padding: '6px 8px' }}
        >
          {defaultModels
            .filter(m => m.provider === formData.provider)
            .map(m => (
              <option key={m.modelName} value={m.modelName}>{m.displayName}</option>
            ))}
          <option value="">Custom model name...</option>
        </select>
        {formData.model_name === '' && (
          <input
            type="text"
            value={formData.model_name}
            onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
            placeholder="Enter model name"
            className="form-input"
            style={{ width: '100%', fontSize: '9pt', padding: '6px 8px', marginTop: '4px' }}
          />
        )}
      </div>

      <div>
        <label className="text text-small font-bold" style={{ display: 'block', marginBottom: '4px' }}>
          API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setFormData({ ...formData, api_key_encrypted: e.target.value });
          }}
          placeholder={provider.api_key_encrypted ? "Enter new key to update" : "sk-..."}
          className="form-input"
          style={{ width: '100%', fontSize: '9pt', padding: '6px 8px' }}
        />
      </div>

      <div>
        <label className="text text-small font-bold" style={{ display: 'block', marginBottom: '4px' }}>
          Cost per Request (cents)
        </label>
        <input
          type="number"
          value={formData.cost_per_request_cents}
          onChange={(e) => setFormData({ ...formData, cost_per_request_cents: parseInt(e.target.value) || 0 })}
          className="form-input"
          style={{ width: '100%', fontSize: '9pt', padding: '6px 8px' }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="checkbox"
          checked={formData.is_default}
          onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
          id={`default-${provider.id || 'new'}`}
        />
        <label htmlFor={`default-${provider.id || 'new'}`} className="text text-small">
          Set as default provider
        </label>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <button
          onClick={() => onSave(formData)}
          className="button button-primary"
          style={{ fontSize: '9pt', padding: '6px 12px' }}
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="button button-secondary"
          style={{ fontSize: '9pt', padding: '6px 12px' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default AIProviderSettings;

