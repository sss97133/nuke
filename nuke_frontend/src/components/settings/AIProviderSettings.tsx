import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../hooks/useToast';

interface AIProvider {
  id?: string;
  provider: 'openai' | 'anthropic' | 'google' | 'gemini' | 'custom';
  api_key_encrypted?: string;
  model_name: string;
  is_default: boolean;
  is_active: boolean;
  cost_per_request_cents?: number;
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

  const handleSave = async (provider: AIProvider, apiKey?: string) => {
    if (!session?.user) {
      showToast('Not authenticated', 'error');
      return;
    }

    if (!provider.model_name.trim()) {
      showToast('Model name is required', 'warning');
      return;
    }

    try {
      // Store API key as base64 encoded (simple obfuscation)
      // In production, use proper encryption
      let encryptedKey = provider.api_key_encrypted || '';
      if (apiKey && apiKey.trim()) {
        // Only update key if a new one was provided
        encryptedKey = btoa(apiKey.trim());
      } else if (!encryptedKey) {
        showToast('API key is required', 'warning');
        return;
      }

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
    { provider: 'openai' as const, modelName: 'gpt-4o', displayName: 'GPT-4o (Recommended)' },
    { provider: 'openai' as const, modelName: 'gpt-4o-mini', displayName: 'GPT-4o Mini (Cheaper)' },
    { provider: 'openai' as const, modelName: 'gpt-4-turbo', displayName: 'GPT-4 Turbo' },
    { provider: 'anthropic' as const, modelName: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet (Recommended)' },
    { provider: 'anthropic' as const, modelName: 'claude-3-haiku-20240307', displayName: 'Claude 3 Haiku (Cheaper)' },
    { provider: 'anthropic' as const, modelName: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus (Best)' },
    { provider: 'google' as const, modelName: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro (Recommended)' },
    { provider: 'google' as const, modelName: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash (Cheaper)' }
  ];

  if (loading) {
    return <div className="text text-muted">Loading AI providers...</div>;
  }

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 className="heading-3">AI Provider API Keys</h3>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="button button-primary"
          style={{ fontSize: '8pt', padding: '6px 12px' }}
        >
          + Add Key
        </button>
      </div>
      <div className="card-body">
        {showAddForm && (
          <div style={{ marginBottom: '12px', padding: '12px', background: '#f5f5f5', border: '1px solid #e0e0e0' }}>
            <div className="text font-bold" style={{ marginBottom: '8px', fontSize: '9pt' }}>Add API Key</div>
            <ProviderForm
              provider={{
                provider: 'openai',
                model_name: '',
                is_default: providers.length === 0,
                is_active: true,
                cost_per_request_cents: 0
              }}
              onSave={(p, key) => {
                handleSave(p, key);
                setShowAddForm(false);
              }}
              onCancel={() => setShowAddForm(false)}
              defaultModels={defaultModels}
            />
          </div>
        )}

        {providers.length === 0 && !showAddForm && (
          <div style={{ textAlign: 'center', padding: '24px', background: '#fafafa', border: '1px dashed #ccc' }}>
            <div style={{ fontSize: '24pt', marginBottom: '8px' }}>🔑</div>
            <div className="text font-bold" style={{ marginBottom: '4px', fontSize: '9pt' }}>No API Keys</div>
            <div className="text text-small text-muted" style={{ fontSize: '8pt' }}>
              Click "+ Add Key" to configure OpenAI, Anthropic, or Google.<br/>
              Or leave empty to use system keys automatically.
            </div>
          </div>
        )}

        {providers.map(provider => (
          <div key={provider.id} style={{ marginBottom: '8px', padding: '12px', background: '#fff', border: '1px solid #e0e0e0' }}>
            {editingProvider?.id === provider.id ? (
              <ProviderForm
                provider={provider}
                onSave={(p, key) => {
                  handleSave(p, key);
                  setEditingProvider(null);
                }}
                onCancel={() => setEditingProvider(null)}
                defaultModels={defaultModels}
              />
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                    {provider.provider === 'openai' && '🤖 '}
                    {provider.provider === 'anthropic' && '🧠 '}
                    {provider.provider === 'google' && '🔷 '}
                    {provider.provider === 'gemini' && '🔷 '}
                    {provider.provider === 'custom' && '⚙️ '}
                    {provider.provider.toUpperCase()}
                    {provider.is_default && ' (PRIMARY)'}
                  </div>
                  <div style={{ fontSize: '8pt', color: '#666', fontFamily: 'monospace' }}>
                    {(() => {
                      if (!provider.api_key_encrypted) return '••••••••';
                      try {
                        const decoded = atob(provider.api_key_encrypted);
                        return decoded.length >= 8 ? `${decoded.substring(0,4)}••••${decoded.slice(-4)}` : '••••••••';
                      } catch {
                        const raw = provider.api_key_encrypted;
                        return raw.length >= 8 ? `${raw.substring(0,4)}••••${raw.slice(-4)}` : '••••••••';
                      }
                    })()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={() => setEditingProvider(provider)} className="button button-secondary" style={{ fontSize: '8pt', padding: '4px 8px' }}>
                    Edit
                  </button>
                  <button onClick={() => provider.id && handleDelete(provider.id)} className="button button-secondary" style={{ fontSize: '8pt', padding: '4px 8px' }}>
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

interface ProviderFormProps {
  provider: AIProvider;
  onSave: (provider: AIProvider, apiKey?: string) => void;
  onCancel: () => void;
  defaultModels: Array<{ provider: 'openai' | 'anthropic' | 'google' | 'custom'; modelName: string; displayName: string }>;
}

const ProviderForm: React.FC<ProviderFormProps> = ({ provider, onSave, onCancel, defaultModels }) => {
  const [formData, setFormData] = useState<AIProvider>(provider);
  const [apiKey, setApiKey] = useState('');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
      <div>
        <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: '4px' }}>Provider</label>
        <select value={formData.provider} onChange={(e) => setFormData({ ...formData, provider: e.target.value as any })} className="form-select" style={{ width: '100%', fontSize: '9pt', padding: '4px' }}>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google</option>
        </select>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: '4px' }}>Model</label>
        <select value={formData.model_name} onChange={(e) => setFormData({ ...formData, model_name: e.target.value })} className="form-select" style={{ width: '100%', fontSize: '9pt', padding: '4px' }}>
          {defaultModels.filter(m => m.provider === formData.provider).map(m => (
            <option key={m.modelName} value={m.modelName}>{m.displayName}</option>
          ))}
        </select>
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: '4px' }}>API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); setFormData({ ...formData, api_key_encrypted: e.target.value }); }}
          placeholder={provider.api_key_encrypted ? "Enter new key" : "sk-..."}
          className="form-input"
          style={{ width: '100%', fontSize: '9pt', padding: '6px' }}
        />
      </div>

      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input type="checkbox" checked={formData.is_default} onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })} id={`default-${provider.id || 'new'}`} />
        <label htmlFor={`default-${provider.id || 'new'}`} style={{ fontSize: '8pt' }}>Set as primary</label>
      </div>

      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button onClick={() => onSave(formData, apiKey)} className="button button-primary" style={{ fontSize: '8pt', padding: '6px 12px' }}>Save</button>
        <button onClick={onCancel} className="button button-secondary" style={{ fontSize: '8pt', padding: '6px 12px' }}>Cancel</button>
      </div>
    </div>
  );
};

export default AIProviderSettings;

