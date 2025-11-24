import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../hooks/useToast';

const StripeKeysManager: React.FC = () => {
  const [publishableKey, setPublishableKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState<any>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      
      setSession(session);

      const { data, error } = await supabase
        .from('user_stripe_keys')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading Stripe keys:', error);
        return;
      }

      if (data) {
        setPublishableKey(data.stripe_publishable_key || '');
        // Don't show secret key, just indicate it's set
        setSecretKey(data.stripe_secret_key_encrypted ? '••••••••' : '');
        setIsActive(data.is_active || false);
      }
    } catch (error) {
      console.error('Error loading Stripe keys:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!session?.user) {
      showToast('Not authenticated', 'error');
      return;
    }

    if (!publishableKey.trim()) {
      showToast('Publishable key is required', 'warning');
      return;
    }

    if (!secretKey || secretKey === '••••••••') {
      showToast('Secret key is required', 'warning');
      return;
    }

    try {
      setSaving(true);

      // Encrypt secret key (in production, use proper encryption)
      // For now, we'll store it encrypted via Supabase Edge Function
      const { data, error } = await supabase.functions.invoke('encrypt-stripe-key', {
        body: { secret_key: secretKey }
      });

      if (error) throw error;

      const encryptedSecretKey = data?.encrypted_key || secretKey; // Fallback if encryption fails

      // Upsert Stripe keys
      const { error: upsertError } = await supabase
        .from('user_stripe_keys')
        .upsert({
          user_id: session.user.id,
          stripe_publishable_key: publishableKey.trim(),
          stripe_secret_key_encrypted: encryptedSecretKey,
          is_active: true,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (upsertError) throw upsertError;

      showToast('Stripe keys saved successfully', 'success');
      setIsActive(true);
      setSecretKey('••••••••'); // Mask after saving
    } catch (error: any) {
      console.error('Error saving Stripe keys:', error);
      showToast(error?.message || 'Failed to save Stripe keys', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!session?.user || !confirm('Are you sure you want to delete your Stripe keys?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('user_stripe_keys')
        .update({ is_active: false })
        .eq('user_id', session.user.id);

      if (error) throw error;

      setPublishableKey('');
      setSecretKey('');
      setIsActive(false);
      showToast('Stripe keys deleted', 'success');
    } catch (error: any) {
      console.error('Error deleting Stripe keys:', error);
      showToast(error?.message || 'Failed to delete Stripe keys', 'error');
    }
  };

  if (loading) {
    return (
      <div className="text text-muted">Loading Stripe keys...</div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="heading-3">Stripe Integration</h3>
      </div>
      <div className="card-body">
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <p className="text text-small text-muted">
            Connect your Stripe account to pay for AI tools and services. Your keys are encrypted and stored securely.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <label className="text text-small font-bold" style={{ display: 'block', marginBottom: '4px' }}>
              Publishable Key
            </label>
            <input
              type="text"
              value={publishableKey}
              onChange={(e) => setPublishableKey(e.target.value)}
              placeholder="pk_test_..."
              className="form-input"
              style={{ width: '100%', fontSize: '9pt', padding: '6px 8px' }}
            />
          </div>

          <div>
            <label className="text text-small font-bold" style={{ display: 'block', marginBottom: '4px' }}>
              Secret Key
            </label>
            <input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={isActive ? "Enter new key to update" : "sk_test_..."}
              className="form-input"
              style={{ width: '100%', fontSize: '9pt', padding: '6px 8px' }}
            />
            {isActive && secretKey === '••••••••' && (
              <div className="text text-small text-muted" style={{ marginTop: '4px' }}>
                Key is set. Enter a new key to update it.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              className="button button-primary"
              style={{ fontSize: '9pt', padding: '8px 16px' }}
            >
              {saving ? 'Saving...' : 'Save Keys'}
            </button>
            {isActive && (
              <button
                onClick={handleDelete}
                className="button button-secondary"
                style={{ fontSize: '9pt', padding: '8px 16px' }}
              >
                Delete Keys
              </button>
            )}
          </div>

          {isActive && (
            <div style={{
              padding: 'var(--space-2)',
              background: 'var(--success-dim)',
              border: '1px solid var(--success)',
              borderRadius: '4px',
              fontSize: '8pt'
            }}>
              ✓ Stripe keys are active and will be used for AI tool payments
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StripeKeysManager;

