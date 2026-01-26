/**
 * Vault Page
 *
 * Wrapper for VaultPortfolio component.
 * Route: /vault
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import VaultPortfolio from '../components/vault/VaultPortfolio';

export default function VaultPage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id || null);
      setLoading(false);
    };
    getUser();
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', paddingTop: '100px' }}>
          <p style={{ fontSize: '10pt', color: 'var(--text-muted)' }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!userId) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', paddingTop: '100px' }}>
          <h1 style={{ fontSize: '14pt', marginBottom: '12px' }}>Vehicle Storage Vault</h1>
          <p style={{ fontSize: '10pt', color: 'var(--text-muted)', marginBottom: '24px' }}>
            Sign in to view your stored vehicles.
          </p>
          <button
            className="button button-primary"
            onClick={() => navigate('/login')}
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <VaultPortfolio
        userId={userId}
        onAllocateVehicle={() => navigate('/vehicles')}
        onReleaseVehicle={(storageId) => {
          console.log('Release requested for storage:', storageId);
        }}
      />
    </div>
  );
}
