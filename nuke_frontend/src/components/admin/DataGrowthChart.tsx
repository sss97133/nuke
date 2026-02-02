import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface GrowthStats {
  vehicles: number;
  images: number;
  comments: number;
  observations: number;
  bat_identities: number;
  active_users: number;
  generated_at?: string;
}

export default function DataGrowthChart() {
  const [stats, setStats] = useState<GrowthStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('db-stats');
      if (fnError) throw fnError;
      setStats(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  };

  const statItems = stats ? [
    { label: 'Vehicles', value: stats.vehicles, color: '#ff6b6b' },
    { label: 'Images', value: stats.images, color: '#00d4ff' },
    { label: 'Comments', value: stats.comments, color: '#ffd93d' },
    { label: 'Observations', value: stats.observations, color: '#6bcb77' },
    { label: 'Identity Seeds', value: stats.bat_identities, color: '#c77dff' },
    { label: 'Active Users', value: stats.active_users, color: '#ffffff' },
  ] : [];

  // Calculate bar widths relative to max
  const maxValue = stats ? Math.max(...statItems.map(s => s.value)) : 0;

  return (
    <div style={{
      borderRadius: '0px',
      border: '2px solid var(--border-light)',
      backgroundColor: 'var(--white)',
      padding: 'var(--space-4)'
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>Data Growth</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
            Live database statistics
          </div>
        </div>
        <button
          className="button button-secondary"
          onClick={() => void loadStats()}
          disabled={loading}
          style={{ fontSize: '8pt' }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 'var(--space-3)', fontSize: '8pt', color: '#b91c1c' }}>
          {error}
        </div>
      )}

      {stats && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          {statItems.map((item) => (
            <div key={item.label} style={{ marginBottom: 'var(--space-3)' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '8pt',
                marginBottom: '4px'
              }}>
                <span style={{ color: 'var(--text-muted)' }}>{item.label}</span>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {formatNumber(item.value)}
                </span>
              </div>
              <div style={{
                height: '8px',
                backgroundColor: 'var(--grey-100)',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  width: `${(item.value / maxValue) * 100}%`,
                  backgroundColor: item.color,
                  borderRadius: '4px',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          ))}

          {stats.generated_at && (
            <div style={{
              marginTop: 'var(--space-3)',
              fontSize: '8pt',
              color: 'var(--text-muted)',
              textAlign: 'right'
            }}>
              Updated: {new Date(stats.generated_at).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
