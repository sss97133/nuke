import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface FacebookConnectionSettingsProps {
  userId: string;
}

const FacebookConnectionSettings: React.FC<FacebookConnectionSettingsProps> = ({ userId }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [facebookIdentity, setFacebookIdentity] = useState<any>(null);

  useEffect(() => {
    checkConnection();
  }, [userId]);

  const checkConnection = async () => {
    try {
      const { data: identity } = await supabase
        .from('external_identities')
        .select('*')
        .eq('platform', 'facebook')
        .eq('claimed_by_user_id', userId)
        .maybeSingle();

      setIsConnected(!!identity);
      setFacebookIdentity(identity);
    } catch (error) {
      console.error('Error checking Facebook connection:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect your Facebook account? This will remove all Facebook videos from your vehicle profiles.')) {
      return;
    }

    setDisconnecting(true);
    try {
      // Delete the external identity
      if (facebookIdentity) {
        const { error } = await supabase
          .from('external_identities')
          .delete()
          .eq('id', facebookIdentity.id);

        if (error) throw error;
      }

      // Optionally: Call edge function to revoke tokens
      // await supabase.functions.invoke('disconnect-facebook', {
      //   body: { user_id: userId }
      // });

      setIsConnected(false);
      setFacebookIdentity(null);
      alert('Facebook account disconnected successfully.');
    } catch (error) {
      console.error('Error disconnecting Facebook:', error);
      alert('Failed to disconnect Facebook. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading connection status...
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div style={{
        padding: '16px',
        border: '1px solid var(--border-light)',
        borderRadius: '8px',
        background: 'var(--surface)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px',
              marginBottom: '4px'
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#1877F2">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
              <h4 style={{ 
                fontSize: '14px', 
                fontWeight: 600,
                margin: 0,
                color: 'var(--text)'
              }}>
                Facebook
              </h4>
            </div>
            <p style={{ 
              fontSize: '12px', 
              color: 'var(--text-muted)',
              margin: '4px 0 0 32px'
            }}>
              Not connected. Connect to display videos from Facebook in your vehicle profiles.
            </p>
          </div>
          <button
            onClick={() => {
              // Navigate to a vehicle profile to connect, or create a dedicated connect page
              window.location.href = '/vehicles';
            }}
            style={{
              padding: '8px 16px',
              background: '#1877F2',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: '16px',
      border: '1px solid var(--border-light)',
      borderRadius: '8px',
      background: 'var(--surface)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px',
            marginBottom: '4px'
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#1877F2">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
            <h4 style={{ 
              fontSize: '14px', 
              fontWeight: 600,
              margin: 0,
              color: 'var(--text)'
            }}>
              Facebook
            </h4>
            <span style={{
              padding: '2px 8px',
              background: '#1877F2',
              color: 'white',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 500
            }}>
              Connected
            </span>
          </div>
          <p style={{ 
            fontSize: '12px', 
            color: 'var(--text-muted)',
            margin: '4px 0 0 32px'
          }}>
            {facebookIdentity?.handle && `Connected as @${facebookIdentity.handle}`}
            {!facebookIdentity?.handle && 'Your Facebook account is connected. Videos will appear in your vehicle profiles.'}
          </p>
        </div>
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          style={{
            padding: '8px 16px',
            background: disconnecting ? 'var(--text-muted)' : 'var(--danger)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: disconnecting ? 'not-allowed' : 'pointer'
          }}
        >
          {disconnecting ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
};

export default FacebookConnectionSettings;
