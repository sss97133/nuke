/**
 * User Discoveries Tab
 * Shows all vehicles a user has discovered across any channel
 * (FB Marketplace, BaT, Craigslist, manual, etc.)
 * with interaction lifecycle tracking.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface Discovery {
  id: string;
  vehicle_id: string;
  source_platform: string;
  source_url: string | null;
  discovered_price: number | null;
  discovered_location: string | null;
  discovered_seller_name: string | null;
  discovered_title: string | null;
  interaction_status: string;
  notes: string | null;
  tags: string[];
  discovered_at: string;
  status_updated_at: string;
  vehicle?: {
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
    primary_image_url: string | null;
    status: string | null;
  };
}

interface DiscoveryStats {
  total_discoveries: number;
  discovered: number;
  saved: number;
  watching: number;
  contacted: number;
  negotiating: number;
  purchased: number;
  passed: number;
  sources_used: number;
  avg_price: number | null;
  top_source: string | null;
}

interface UserDiscoveriesProps {
  userId: string;
  isOwnProfile: boolean;
}

const STATUSES = [
  { key: 'all', label: 'All' },
  { key: 'discovered', label: 'Discovered' },
  { key: 'saved', label: 'Saved' },
  { key: 'watching', label: 'Watching' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'negotiating', label: 'Negotiating' },
  { key: 'purchased', label: 'Purchased' },
  { key: 'passed', label: 'Passed' },
];

const PLATFORM_LABELS: Record<string, string> = {
  facebook_marketplace: 'FB Marketplace',
  bring_a_trailer: 'BaT',
  cars_and_bids: 'Cars & Bids',
  craigslist: 'Craigslist',
  ebay_motors: 'eBay Motors',
  hagerty: 'Hagerty',
  facebook_group: 'FB Group',
  instagram: 'Instagram',
  manual: 'Manual',
  unknown: 'Link',
};

const STATUS_COLORS: Record<string, string> = {
  discovered: 'var(--text-muted)',
  saved: 'var(--info, #3b82f6)',
  watching: '#8b5cf6',
  contacted: 'var(--warning)',
  negotiating: 'var(--orange)',
  purchased: 'var(--success, #22c55e)',
  passed: 'var(--text-muted)',
};

const formatPrice = (price: number | null | undefined) => {
  if (!price) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffHours < 1) return 'just now';
  if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
  if (diffDays < 7) return `${Math.floor(diffDays)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const UserDiscoveries: React.FC<UserDiscoveriesProps> = ({ userId, isOwnProfile }) => {
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [stats, setStats] = useState<DiscoveryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);

  const loadDiscoveries = useCallback(async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('user_vehicle_discoveries')
        .select(`
          *,
          vehicle:vehicles(id, year, make, model, primary_image_url, status)
        `)
        .eq('user_id', userId)
        .order('discovered_at', { ascending: false })
        .limit(100);

      if (filter !== 'all') {
        query = query.eq('interaction_status', filter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setDiscoveries(data || []);
    } catch (err) {
      console.error('Error loading discoveries:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, filter]);

  const loadStats = useCallback(async () => {
    const { data, error } = await supabase
      .from('user_discovery_stats')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!error && data) {
      setStats(data);
    }
  }, [userId]);

  useEffect(() => {
    loadDiscoveries();
    loadStats();
  }, [loadDiscoveries, loadStats]);

  const updateStatus = async (discoveryId: string, newStatus: string) => {
    const { error } = await supabase
      .from('user_vehicle_discoveries')
      .update({
        interaction_status: newStatus,
        status_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', discoveryId);

    if (!error) {
      setDiscoveries(prev =>
        prev.map(d => d.id === discoveryId ? { ...d, interaction_status: newStatus } : d)
      );
      loadStats();
    }
  };

  const handleIngest = async () => {
    if (!ingestUrl.trim()) return;
    setIngesting(true);
    setIngestResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            url: ingestUrl.trim(),
            user_id: userId,
          }),
        }
      );

      const result = await resp.json();
      if (result.status === 'error') {
        setIngestResult(`Error: ${result.error}`);
      } else {
        setIngestResult(
          result.status === 'duplicate'
            ? 'Already tracked'
            : result.is_new_vehicle
              ? 'New vehicle created + tracked'
              : 'Matched existing vehicle + tracked'
        );
        setIngestUrl('');
        loadDiscoveries();
        loadStats();
      }
    } catch (err: any) {
      setIngestResult(`Error: ${err.message}`);
    } finally {
      setIngesting(false);
      setTimeout(() => setIngestResult(null), 4000);
    }
  };

  if (loading && discoveries.length === 0) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
        Loading discoveries...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

      {/* Stats bar */}
      {stats && (
        <div style={{
          display: 'flex',
          gap: 'var(--space-4)',
          flexWrap: 'wrap',
          padding: 'var(--space-3) var(--space-4)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          fontFamily: '"Courier New", Courier, monospace',
        }}>
          <StatCell label="Found" value={stats.total_discoveries} />
          <StatCell label="Saved" value={stats.saved} />
          <StatCell label="Watching" value={stats.watching} />
          <StatCell label="Contacted" value={stats.contacted} />
          <StatCell label="Purchased" value={stats.purchased} />
          <StatCell label="Sources" value={stats.sources_used} />
        </div>
      )}

      {/* Quick ingest — own profile only */}
      {isOwnProfile && (
        <div style={{
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'center',
        }}>
          <input
            type="text"
            value={ingestUrl}
            onChange={(e) => setIngestUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleIngest()}
            placeholder="Paste a URL to track a vehicle..."
            style={{
              flex: 1,
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '11px',
              fontFamily: '"Courier New", Courier, monospace',
              outline: 'none',
            }}
          />
          <button
            onClick={handleIngest}
            disabled={ingesting || !ingestUrl.trim()}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              border: '1px solid var(--border)',
              background: ingesting ? 'var(--surface)' : 'var(--text)',
              color: ingesting ? 'var(--text-muted)' : 'var(--bg)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: ingesting ? 'wait' : 'pointer',
              fontFamily: '"Courier New", Courier, monospace',
            }}
          >
            {ingesting ? '...' : 'Ingest'}
          </button>
          {ingestResult && (
            <span style={{
              fontSize: '10px',
              color: ingestResult.startsWith('Error') ? 'var(--danger, #ef4444)' : 'var(--success, #22c55e)',
              fontFamily: '"Courier New", Courier, monospace',
            }}>
              {ingestResult}
            </span>
          )}
        </div>
      )}

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
        {STATUSES.map(s => {
          const count = s.key === 'all'
            ? stats?.total_discoveries || discoveries.length
            : stats?.[s.key as keyof DiscoveryStats] as number || 0;

          return (
            <button
              key={s.key}
              onClick={() => setFilter(s.key)}
              style={{
                padding: '2px 8px',
                border: filter === s.key ? '2px solid var(--text)' : '1px solid var(--border)',
                background: filter === s.key ? 'var(--text)' : 'transparent',
                color: filter === s.key ? 'var(--bg)' : 'var(--text-muted)',
                fontSize: '10px',
                fontWeight: filter === s.key ? 700 : 400,
                cursor: 'pointer',
                fontFamily: '"Courier New", Courier, monospace',
              }}
            >
              {s.label} {count > 0 && `(${count})`}
            </button>
          );
        })}
      </div>

      {/* Discovery cards */}
      {discoveries.length === 0 ? (
        <div style={{
          padding: 'var(--space-6)',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '11px',
          border: '1px solid var(--border)',
          fontFamily: '"Courier New", Courier, monospace',
        }}>
          {isOwnProfile
            ? 'No discoveries yet. Paste a URL above to start tracking vehicles.'
            : 'No discoveries to show.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {discoveries.map((d) => (
            <DiscoveryCard
              key={d.id}
              discovery={d}
              isOwnProfile={isOwnProfile}
              onStatusChange={updateStatus}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Stat Cell ────────────────────────────────────────

const StatCell: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '50px' }}>
    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
      {value}
    </div>
    <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {label}
    </div>
  </div>
);

// ── Discovery Card ────────────────────────────────────

const DiscoveryCard: React.FC<{
  discovery: Discovery;
  isOwnProfile: boolean;
  onStatusChange: (id: string, status: string) => void;
}> = ({ discovery, isOwnProfile, onStatusChange }) => {
  const d = discovery;
  const v = d.vehicle;
  const title = d.discovered_title
    || (v ? `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() : 'Unknown Vehicle');
  const imageUrl = v?.primary_image_url;
  const platformLabel = PLATFORM_LABELS[d.source_platform] || d.source_platform;
  const statusColor = STATUS_COLORS[d.interaction_status] || 'var(--text-muted)';

  return (
    <div style={{
      display: 'flex',
      gap: 'var(--space-3)',
      padding: 'var(--space-3)',
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      alignItems: 'flex-start',
    }}>
      {/* Thumbnail */}
      <div style={{
        width: '72px',
        height: '54px',
        flexShrink: 0,
        background: 'var(--surface-hover)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>No img</span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Link
            to={`/vehicles/${d.vehicle_id}`}
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text)',
              textDecoration: 'none',
              fontFamily: '"Courier New", Courier, monospace',
            }}
          >
            {title}
          </Link>

          {/* Source badge */}
          <span style={{
            fontSize: '8px',
            padding: '1px 5px',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontFamily: '"Courier New", Courier, monospace',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            {platformLabel}
          </span>

          {/* Status badge */}
          <span style={{
            fontSize: '8px',
            padding: '1px 5px',
            background: statusColor,
            color: 'var(--surface-elevated)',
            fontWeight: 700,
            fontFamily: '"Courier New", Courier, monospace',
            textTransform: 'uppercase',
          }}>
            {d.interaction_status}
          </span>
        </div>

        {/* Details row */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-3)',
          marginTop: '2px',
          fontSize: '10px',
          color: 'var(--text-muted)',
          fontFamily: '"Courier New", Courier, monospace',
        }}>
          {d.discovered_price && <span>{formatPrice(d.discovered_price)}</span>}
          {d.discovered_location && <span>{d.discovered_location}</span>}
          {d.discovered_seller_name && <span>Seller: {d.discovered_seller_name}</span>}
          <span>{formatDate(d.discovered_at)}</span>
        </div>

        {/* Tags */}
        {d.tags && d.tags.length > 0 && (
          <div style={{ display: 'flex', gap: '3px', marginTop: '3px', flexWrap: 'wrap' }}>
            {d.tags.map((tag, i) => (
              <span key={i} style={{
                fontSize: '8px',
                padding: '0 4px',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                fontFamily: '"Courier New", Courier, monospace',
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Notes */}
        {d.notes && (
          <div style={{
            fontSize: '10px',
            color: 'var(--text-muted)',
            marginTop: '3px',
            fontFamily: '"Courier New", Courier, monospace',
          }}>
            {d.notes}
          </div>
        )}
      </div>

      {/* Quick actions — own profile only */}
      {isOwnProfile && (
        <div style={{ display: 'flex', gap: '2px', flexShrink: 0, flexWrap: 'wrap', maxWidth: '120px' }}>
          {['saved', 'watching', 'contacted', 'purchased', 'passed'].map(status => (
            status !== d.interaction_status && (
              <button
                key={status}
                onClick={() => onStatusChange(d.id, status)}
                style={{
                  fontSize: '8px',
                  padding: '1px 4px',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontFamily: '"Courier New", Courier, monospace',
                  textTransform: 'capitalize',
                }}
                title={`Mark as ${status}`}
              >
                {status}
              </button>
            )
          ))}
          {d.source_url && (
            <a
              href={d.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '8px',
                padding: '1px 4px',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                textDecoration: 'none',
                fontFamily: '"Courier New", Courier, monospace',
              }}
            >
              Source
            </a>
          )}
        </div>
      )}
    </div>
  );
};

export default UserDiscoveries;
