import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';

interface X402Config {
  wallet_address: string | null;
  network: string | null;
  facilitator_url: string | null;
  enabled: boolean;
}

const X402Settings: React.FC = () => {
  const [config, setConfig] = useState<X402Config>({
    wallet_address: null,
    network: null,
    facilitator_url: null,
    enabled: false
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    wallet_address: '',
    network: 'base-sepolia',
    facilitator_url: 'https://facilitator.payai.network'
  });

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      
      // Check x402-payment edge function health to see current config
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (supabaseUrl && anonKey) {
        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/x402-payment/health`, {
            headers: {
              'Authorization': `Bearer ${anonKey}`
            }
          });
          
          if (response.ok) {
            const health = await response.json();
            setConfig({
              wallet_address: health.wallet_address || null,
              network: health.network || null,
              facilitator_url: null, // Not returned by health endpoint
              enabled: health.x402_enabled || false
            });
            
            // Pre-fill form if we have values
            if (health.wallet_address) {
              setFormData(prev => ({
                ...prev,
                wallet_address: health.wallet_address
              }));
            }
            if (health.network) {
              setFormData(prev => ({
                ...prev,
                network: health.network
              }));
            }
          }
        } catch (error) {
          console.error('Failed to check x402 health:', error);
        }
      }
    } catch (error) {
      console.error('Failed to load x402 config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.wallet_address) {
      toast.error('Wallet address is required');
      return;
    }

    if (!formData.wallet_address.startsWith('0x') && formData.network !== 'solana-devnet') {
      toast.error('Wallet address should start with 0x for Ethereum/Base networks');
      return;
    }

    setSaving(true);
    
    try {
      // Show instructions for setting in Supabase Dashboard
      const instructions = `
To complete x402 setup, set these environment variables in Supabase:

1. Go to: https://supabase.com/dashboard/project/YOUR_PROJECT_ID/settings/functions
2. Click "Secrets" or "Environment Variables"
3. Add these secrets:

   X402_WALLET_ADDRESS = ${formData.wallet_address}
   X402_NETWORK = ${formData.network}
   X402_FACILITATOR_URL = ${formData.facilitator_url}

4. After setting, redeploy the x402-payment edge function:
   supabase functions deploy x402-payment

Or use Supabase CLI:
   supabase secrets set X402_WALLET_ADDRESS=${formData.wallet_address}
   supabase secrets set X402_NETWORK=${formData.network}
   supabase secrets set X402_FACILITATOR_URL=${formData.facilitator_url}
      `.trim();

      // Copy to clipboard
      await navigator.clipboard.writeText(instructions);
      
      toast.success('Instructions copied to clipboard! Check the console for details.');
      console.log('x402 Configuration Instructions:', instructions);
      
      // Also show in an alert for visibility
      alert(`Instructions copied to clipboard!\n\n${instructions}`);
      
    } catch (error: any) {
      toast.error(error.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !anonKey) {
        toast.error('Supabase URL or key not configured');
        return;
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/x402-payment/health`, {
        headers: {
          'Authorization': `Bearer ${anonKey}`
        }
      });

      if (response.ok) {
        const health = await response.json();
        if (health.x402_enabled) {
          toast.success(`x402 is configured! Network: ${health.network}`);
          loadConfig(); // Reload to update UI
        } else {
          toast.error('x402 is not configured. Please set environment variables in Supabase.');
        }
      } else {
        toast.error('Failed to check x402 status');
      }
    } catch (error) {
      toast.error('Failed to test connection');
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '10pt' }}>Loading x402 configuration...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ fontSize: '18pt', marginBottom: '8px' }}>x402 Payment Settings</h1>
        <p style={{ fontSize: '9pt', color: '#666' }}>
          Configure blockchain payments via HTTP 402 protocol
        </p>
      </div>

      {/* Status Card */}
      <div style={{ 
        border: '2px solid #000',
        borderRadius: '0px',
        background: '#fff',
        marginBottom: '20px'
      }}>
        <div style={{ 
          padding: '16px', 
          borderBottom: '2px solid #000',
          background: 'var(--surface-light, #f5f5f5)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '12pt', fontWeight: 700 }}>
              x402 Payment Status
            </div>
            <div style={{ fontSize: '8pt', color: '#666', marginTop: '4px' }}>
              {config.enabled ? 'Configured and ready' : 'Not configured'}
            </div>
          </div>
          <div style={{
            padding: '6px 12px',
            borderRadius: '0px',
            background: config.enabled ? '#10b981' : '#ef4444',
            color: '#fff',
            fontSize: '8pt',
            fontWeight: 700
          }}>
            {config.enabled ? '● ENABLED' : '○ DISABLED'}
          </div>
        </div>

        <div style={{ padding: '20px' }}>
          {config.enabled ? (
            <div style={{ 
              padding: '16px', 
              background: '#f0fdf4',
              border: '2px solid #10b981',
              borderRadius: '0px',
              marginBottom: '20px'
            }}>
              <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: '#10b981' }}>
                ✅ x402 Configured
              </div>
              <div style={{ fontSize: '9pt', color: '#666' }}>
                <div>Network: <strong>{config.network}</strong></div>
                {config.wallet_address && (
                  <div style={{ marginTop: '4px' }}>
                    Wallet: <code style={{ fontSize: '8pt', background: '#fff', padding: '2px 4px' }}>
                      {config.wallet_address.substring(0, 10)}...{config.wallet_address.substring(config.wallet_address.length - 8)}
                    </code>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ 
              padding: '16px', 
              background: '#fef2f2',
              border: '2px solid #ef4444',
              borderRadius: '0px',
              marginBottom: '20px'
            }}>
              <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: '#ef4444' }}>
                ⚠️ x402 Not Configured
              </div>
              <div style={{ fontSize: '9pt', color: '#666' }}>
                Set environment variables in Supabase Dashboard to enable x402 payments.
              </div>
            </div>
          )}

          <button
            onClick={handleTestConnection}
            style={{
              padding: '8px 16px',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '0px',
              fontSize: '9pt',
              fontWeight: 700,
              cursor: 'pointer',
              marginBottom: '20px'
            }}
          >
            Test Connection
          </button>
        </div>
      </div>

      {/* Configuration Form */}
      <div style={{ 
        border: '2px solid #000',
        borderRadius: '0px',
        background: '#fff',
        marginBottom: '20px'
      }}>
        <div style={{ 
          padding: '16px', 
          borderBottom: '2px solid #000',
          background: 'var(--surface-light, #f5f5f5)'
        }}>
          <div style={{ fontSize: '12pt', fontWeight: 700 }}>
            Configuration
          </div>
          <div style={{ fontSize: '8pt', color: '#666', marginTop: '4px' }}>
            Enter values below, then set them in Supabase Dashboard
          </div>
        </div>

        <div style={{ padding: '20px' }}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '9pt', 
              fontWeight: 700, 
              marginBottom: '8px' 
            }}>
              Wallet Address *
            </label>
            <input
              type="text"
              value={formData.wallet_address}
              onChange={(e) => setFormData(prev => ({ ...prev, wallet_address: e.target.value }))}
              placeholder="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '2px solid #000',
                borderRadius: '0px',
                fontSize: '9pt',
                fontFamily: 'monospace'
              }}
            />
            <div style={{ fontSize: '8pt', color: '#666', marginTop: '4px' }}>
              Your wallet address where payments will be received. Get from MetaMask, Coinbase Wallet, etc.
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '9pt', 
              fontWeight: 700, 
              marginBottom: '8px' 
            }}>
              Network *
            </label>
            <select
              value={formData.network}
              onChange={(e) => setFormData(prev => ({ ...prev, network: e.target.value }))}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '2px solid #000',
                borderRadius: '0px',
                fontSize: '9pt'
              }}
            >
              <option value="base-sepolia">base-sepolia (Test - Recommended)</option>
              <option value="base">base (Production)</option>
              <option value="solana-devnet">solana-devnet (Test)</option>
              <option value="ethereum">ethereum (Production)</option>
            </select>
            <div style={{ fontSize: '8pt', color: '#666', marginTop: '4px' }}>
              Blockchain network for payments. Use base-sepolia for testing.
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '9pt', 
              fontWeight: 700, 
              marginBottom: '8px' 
            }}>
              Facilitator URL
            </label>
            <input
              type="text"
              value={formData.facilitator_url}
              onChange={(e) => setFormData(prev => ({ ...prev, facilitator_url: e.target.value }))}
              placeholder="https://facilitator.payai.network"
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '2px solid #000',
                borderRadius: '0px',
                fontSize: '9pt'
              }}
            />
            <div style={{ fontSize: '8pt', color: '#666', marginTop: '4px' }}>
              x402 payment facilitator service URL. Default is usually fine.
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !formData.wallet_address}
            style={{
              padding: '10px 20px',
              background: saving ? '#9ca3af' : '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: '0px',
              fontSize: '10pt',
              fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving || !formData.wallet_address ? 0.6 : 1
            }}
          >
            {saving ? 'Saving...' : 'Copy Setup Instructions'}
          </button>
        </div>
      </div>

      {/* Instructions Card */}
      <div style={{ 
        border: '2px solid #000',
        borderRadius: '0px',
        background: '#fff',
        marginBottom: '20px'
      }}>
        <div style={{ 
          padding: '16px', 
          borderBottom: '2px solid #000',
          background: 'var(--surface-light, #f5f5f5)'
        }}>
          <div style={{ fontSize: '12pt', fontWeight: 700 }}>
            Setup Instructions
          </div>
        </div>

        <div style={{ padding: '20px', fontSize: '9pt', lineHeight: 1.8 }}>
          <ol style={{ marginLeft: '20px', color: '#666' }}>
            <li>Fill in the configuration form above</li>
            <li>Click "Copy Setup Instructions" to copy the commands</li>
            <li>Go to <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Supabase Dashboard</a></li>
            <li>Navigate to: <strong>Settings → Edge Functions → Secrets</strong></li>
            <li>Add the three environment variables (X402_WALLET_ADDRESS, X402_NETWORK, X402_FACILITATOR_URL)</li>
            <li>Deploy the x402-payment edge function:
              <pre style={{ 
                background: '#f5f5f5', 
                padding: '8px', 
                marginTop: '8px',
                fontSize: '8pt',
                overflow: 'auto'
              }}>
                supabase functions deploy x402-payment
              </pre>
            </li>
            <li>Click "Test Connection" above to verify</li>
          </ol>

          <div style={{ 
            marginTop: '20px',
            padding: '12px',
            background: '#fffbeb',
            border: '1px solid #f59e0b',
            borderRadius: '0px',
            fontSize: '8pt'
          }}>
            <strong>⚠️ Important:</strong> Environment variables must be set in Supabase Dashboard. 
            The form above only prepares the values - you need to manually set them in Supabase.
          </div>
        </div>
      </div>
    </div>
  );
};

export default X402Settings;


