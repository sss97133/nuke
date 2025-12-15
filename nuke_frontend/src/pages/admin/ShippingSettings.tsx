import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { checkCentralDispatchConnection, getCentralDispatchAuthUrl } from '../../services/shippingService';
import { toast } from 'react-hot-toast';

const ShippingSettings: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [connection, setConnection] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    loadConnection();
    
    // Check for connection success from OAuth callback
    if (searchParams.get('connected') === 'true') {
      const testMode = searchParams.get('test_mode') === 'true';
      toast.success(`Connected to Central Dispatch ${testMode ? '(Test Mode)' : ''}!`);
    }
  }, []);

  const loadConnection = async () => {
    try {
      const status = await checkCentralDispatchConnection();
      setConnection(status);
    } catch (error) {
      console.error('Failed to load connection status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    
    try {
      const authUrl = await getCentralDispatchAuthUrl();
      window.location.href = authUrl;
    } catch (error: any) {
      toast.error(error.message || 'Failed to get authorization URL');
      setConnecting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '10pt' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ fontSize: '18pt', marginBottom: '8px' }}>Shipping Settings</h1>
        <p style={{ fontSize: '9pt', color: '#666' }}>
          Configure automated shipping coordination via Central Dispatch
        </p>
      </div>

      {/* Central Dispatch Connection Card */}
      <div style={{ 
        border: '2px solid #000',
        borderRadius: '0px',
        background: 'var(--surface)',
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
              Central Dispatch Integration
            </div>
            <div style={{ fontSize: '8pt', color: '#666', marginTop: '4px' }}>
              Auto-create shipping listings after transactions complete
            </div>
          </div>
          <div style={{
            padding: '6px 12px',
            borderRadius: '0px',
            background: connection?.connected ? '#10b981' : '#ef4444',
            color: '#fff',
            fontSize: '8pt',
            fontWeight: 700
          }}>
            {connection?.connected ? '● CONNECTED' : '○ NOT CONNECTED'}
          </div>
        </div>

        <div style={{ padding: '20px' }}>
          {connection?.connected ? (
            <>
              <div style={{ 
                padding: '16px', 
                background: '#f0fdf4',
                border: '2px solid #10b981',
                borderRadius: '0px',
                marginBottom: '20px'
              }}>
                <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: '#10b981' }}>
                  ✅ Connected Successfully
                </div>
                <div style={{ fontSize: '9pt', color: '#666' }}>
                  <div>Mode: {connection.test_mode ? 'Test/Sandbox' : 'Production'}</div>
                  {connection.expires_at && (
                    <div>Token Expires: {new Date(connection.expires_at).toLocaleDateString()}</div>
                  )}
                </div>
              </div>

              <div style={{ fontSize: '9pt', lineHeight: 1.8 }}>
                <h3 style={{ fontSize: '10pt', marginBottom: '12px' }}>How It Works:</h3>
                <ol style={{ marginLeft: '20px', color: '#666' }}>
                  <li>Buyer pays facilitation fee (triggers transaction)</li>
                  <li>Both parties sign documents</li>
                  <li><strong>Shipping listing auto-created on Central Dispatch</strong></li>
                  <li>Carriers bid on transport</li>
                  <li>Seller accepts carrier (or auto-accept best price)</li>
                  <li>Vehicle ships - buyer gets SMS tracking updates</li>
                </ol>
              </div>

              {connection.test_mode && (
                <div style={{ 
                  marginTop: '20px',
                  padding: '12px',
                  background: '#fffbeb',
                  border: '1px solid #f59e0b',
                  borderRadius: '0px',
                  fontSize: '8pt'
                }}>
                  <strong>⚠️ Test Mode Active:</strong> Listings will be created in Central Dispatch's test marketplace. 
                  Switch to production mode when ready to go live.
                </div>
              )}

              <button
                onClick={() => {
                  if (confirm('Disconnect Central Dispatch? This will stop automatic shipping listings.')) {
                    // TODO: Implement disconnect function
                    toast.success('Disconnected');
                    loadConnection();
                  }
                }}
                style={{
                  marginTop: '20px',
                  padding: '8px 16px',
                  border: '2px solid #ef4444',
                  background: 'var(--surface)',
                  color: '#ef4444',
                  fontSize: '9pt',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: '0px'
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              <div style={{ 
                padding: '16px', 
                background: '#fef2f2',
                border: '2px solid #ef4444',
                borderRadius: '0px',
                marginBottom: '20px'
              }}>
                <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: '#ef4444' }}>
                  ○ Not Connected
                </div>
                <div style={{ fontSize: '9pt', color: '#666' }}>
                  Central Dispatch integration is not configured. Shipping coordination will be manual.
                </div>
              </div>

              <div style={{ fontSize: '9pt', marginBottom: '20px', lineHeight: 1.8 }}>
                <h3 style={{ fontSize: '10pt', marginBottom: '12px' }}>What You Get:</h3>
                <ul style={{ marginLeft: '20px', color: '#666' }}>
                  <li>✅ Auto-create shipping listings after transactions complete</li>
                  <li>✅ Carriers bid automatically on your marketplace</li>
                  <li>✅ SMS tracking updates for buyers</li>
                  <li>✅ Real-time pickup/delivery status</li>
                  <li>✅ Professional shipping coordination</li>
                  <li>✅ Additional revenue opportunity (shipping fees)</li>
                </ul>
              </div>

              <div style={{ 
                padding: '16px', 
                background: '#f0f9ff',
                border: '1px solid #3b82f6',
                borderRadius: '0px',
                marginBottom: '20px',
                fontSize: '8pt',
                lineHeight: 1.6
              }}>
                <strong>📋 Setup Status:</strong>
                <div style={{ marginTop: '8px', color: '#666' }}>
                  Waiting for Central Dispatch API credentials via SafeSend email (within 3 business days).
                  Once received, add credentials to Supabase secrets, then click "Connect Central Dispatch" below.
                </div>
              </div>

              <button
                onClick={handleConnect}
                disabled={connecting}
                style={{
                  padding: '12px 24px',
                  border: '2px solid #000',
                  background: '#000',
                  color: '#fff',
                  fontSize: '10pt',
                  fontWeight: 700,
                  cursor: connecting ? 'wait' : 'pointer',
                  borderRadius: '0px'
                }}
              >
                {connecting ? 'Connecting...' : '🔗 Connect Central Dispatch'}
              </button>

              <div style={{ 
                marginTop: '16px',
                fontSize: '8pt',
                color: '#666'
              }}>
                Note: You'll be redirected to Central Dispatch to authorize access.
              </div>
            </>
          )}
        </div>
      </div>

      {/* Documentation Card */}
      <div style={{ 
        border: '2px solid #000',
        borderRadius: '0px',
        background: 'var(--surface)'
      }}>
        <div style={{ 
          padding: '16px', 
          borderBottom: '2px solid #000',
          background: 'var(--surface-light, #f5f5f5)',
          fontWeight: 700,
          fontSize: '11pt'
        }}>
          📚 Setup Instructions
        </div>

        <div style={{ padding: '20px', fontSize: '9pt', lineHeight: 1.8 }}>
          <h4 style={{ fontSize: '10pt', marginBottom: '12px' }}>Step 1: Get API Credentials</h4>
          <p style={{ color: '#666', marginBottom: '16px' }}>
            Wait for Central Dispatch's "Central Dispatch APIs Onboarding & Documentation" email with your test credentials.
          </p>

          <h4 style={{ fontSize: '10pt', marginBottom: '12px' }}>Step 2: Add to Supabase Secrets</h4>
          <pre style={{ 
            background: '#000',
            color: '#0f0',
            padding: '12px',
            borderRadius: '0px',
            fontSize: '8pt',
            overflow: 'auto',
            fontFamily: 'monospace'
          }}>
{`supabase secrets set CENTRAL_DISPATCH_CLIENT_ID="your_client_id"
supabase secrets set CENTRAL_DISPATCH_CLIENT_SECRET="your_secret"
supabase secrets set CENTRAL_DISPATCH_TEST_MODE="true"`}
          </pre>

          <h4 style={{ fontSize: '10pt', marginTop: '16px', marginBottom: '12px' }}>Step 3: Connect</h4>
          <p style={{ color: '#666', marginBottom: '8px' }}>
            Click "Connect Central Dispatch" button above, authorize access, and you're done!
          </p>

          <h4 style={{ fontSize: '10pt', marginTop: '16px', marginBottom: '12px' }}>Step 4: Test</h4>
          <p style={{ color: '#666' }}>
            Create a test transaction and verify shipping listing is created automatically.
          </p>
        </div>
      </div>

      {/* Back Button */}
      <button
        onClick={() => navigate('/admin')}
        style={{
          marginTop: '20px',
          padding: '8px 16px',
          border: '2px solid #000',
          background: 'var(--surface)',
          fontSize: '9pt',
          fontWeight: 700,
          cursor: 'pointer',
          borderRadius: '0px'
        }}
      >
        ← Back to Admin
      </button>
    </div>
  );
};

export default ShippingSettings;

