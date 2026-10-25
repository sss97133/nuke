/**
 * SellDashboard.tsx
 * Shows all listing_exports across all platforms with status tracking.
 * Route: /sell
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PrefetchLink as Link } from '../components/PrefetchLink';
import { usePageTitle } from '../hooks/usePageTitle';
import './SellDashboard.css';
import { supabase } from '../lib/supabase';
import { ListingExportService, ListingExport } from '../services/listingExportService';

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const FONT_BODY = 'var(--font-family)';
const FONT_MONO = 'var(--font-mono)';

const LABEL: React.CSSProperties = {
  textTransform: 'none',
  letterSpacing: '0.5px',
  fontSize: 'var(--text-callout)',
  fontWeight: 700,
  color: 'var(--text-secondary, #666666)',
  fontFamily: FONT_BODY,
};

const BUTTON: React.CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: 'var(--text-callout)',
  fontWeight: 700,
  textTransform: 'none',
  letterSpacing: '0.5px',
  padding: '8px 12px',
  minHeight: 'var(--control-height)',
  boxSizing: 'border-box',
  border: '2px solid var(--border, #bdbdbd)',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  color: 'var(--text, #2a2a2a)',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportWithVehicle extends ListingExport {
  vehicle?: {
    year: number | null;
    make: string | null;
    model: string | null;
    primary_image_url: string | null;
  };
}

type StatusFilter = 'all' | ListingExport['status'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; border: string; color: string }> = {
  prepared: { bg: 'var(--bg, #f5f5f5)', border: 'var(--border, #bdbdbd)', color: 'var(--text-secondary, #666666)' },
  submitted: { bg: 'var(--bg, #f5f5f5)', border: 'var(--warning, #b05a00)', color: 'var(--warning-dark)' },
  active: { bg: 'var(--bg, #f5f5f5)', border: 'var(--success, #16825d)', color: 'var(--success, #16825d)' },
  sold: { bg: 'var(--bg, #f5f5f5)', border: 'var(--text, #2a2a2a)', color: 'var(--text, #2a2a2a)' },
  expired: { bg: 'var(--bg, #f5f5f5)', border: 'var(--error, #d13438)', color: 'var(--error-dark)' },
  cancelled: { bg: 'var(--bg, #f5f5f5)', border: 'var(--text-secondary, #666666)', color: 'var(--text-secondary, #666666)' },
};

const PLATFORM_LABELS: Record<string, string> = {
  nzero: 'NUKE',
  bat: 'BAT',
  ebay: 'EBAY',
  craigslist: 'CL',
  carscom: 'CARS.COM',
  facebook: 'FB',
  autotrader: 'AT',
  hemmings: 'HEMM',
  carsandbids: 'C&B',
  hagerty: 'HAG',
  other: 'OTHER',
};

function formatDate(iso: string): string {
  if (!Number.isFinite(Date.parse(iso))) return 'Date unknown';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function formatCurrency(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.prepared;
  return (
    <span style={{
      ...LABEL,
      padding: '2px 6px',
      border: `2px solid ${colors.border}`,
      backgroundColor: colors.bg,
      color: colors.color,
      display: 'inline-block',
    }}>
      {status.toUpperCase()}
    </span>
  );
}

function PlatformBadge({ platform, label }: { platform: string; label?: string | null }) {
  // Prefer the channel label (set by the switchboard) so outlets collapsed into
  // the 'other' platform enum still read by name (Cars & Bids, RM Sotheby's, …).
  const text = label || PLATFORM_LABELS[platform] || platform.toUpperCase();
  return (
    <span style={{
      ...LABEL,
      padding: '2px 6px',
      border: '2px solid var(--border, #bdbdbd)',
      display: 'inline-block',
    }}>
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stats Bar
// ---------------------------------------------------------------------------

function StatsBar({ exports }: { exports: ExportWithVehicle[] }) {
  const active = exports.filter(e => e.status === 'active').length;
  const sold = exports.filter(e => e.status === 'sold').length;
  const totalRevenue = exports
    .filter(e => e.status === 'sold' && e.sold_price_cents)
    .reduce((sum, e) => sum + (e.sold_price_cents || 0), 0);
  const total = exports.length;
  const convRate = total > 0 ? ((sold / total) * 100).toFixed(1) : '0';

  return (
    <div style={{
      display: 'flex',
      gap: 20,
      flexWrap: 'wrap',
      padding: '12px 14px',
      borderBottom: '2px solid var(--border, #bdbdbd)',
      backgroundColor: 'var(--bg, #f5f5f5)',
    }}>
      {[
        { label: 'Loaded exports', value: String(total) },
        { label: 'ACTIVE', value: String(active) },
        { label: 'SOLD', value: String(sold) },
        { label: 'REVENUE', value: formatCurrency(totalRevenue) },
        { label: 'CONVERSION', value: `${convRate}%` },
      ].map(s => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={LABEL}>{s.label}</span>
          <span style={{ fontFamily: FONT_MONO, fontSize: '14px', fontWeight: 700 }}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export Row
// ---------------------------------------------------------------------------

function ExportRow({ exp, onStatusChange, busyId, disabled }: {
  exp: ExportWithVehicle;
  onStatusChange: (id: string, status: ListingExport['status']) => Promise<void>;
  busyId: string | null;
  disabled: boolean;
}) {
  const ymm = [exp.vehicle?.year, exp.vehicle?.make, exp.vehicle?.model]
    .filter(Boolean).join(' ') || 'Unknown vehicle';

  return (
    <div className="sell-export-row" style={{
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 10,
      padding: '8px 14px',
      borderBottom: '1px solid var(--border, #bdbdbd)',
      backgroundColor: 'var(--surface, #ebebeb)',
    }}>
      {/* Thumbnail */}
      <Link to={`/vehicle/${exp.vehicle_id}`} style={{ flexShrink: 0 }}>
        {exp.vehicle?.primary_image_url ? (
          <img
            src={exp.vehicle.primary_image_url}
            alt={ymm}
            width={48}
            height={36}
            style={{ width: 48, height: 36, objectFit: 'cover', border: '2px solid var(--border, #bdbdbd)' }}
          />
        ) : (
          <div style={{
            width: 48, height: 36,
            border: '2px solid var(--border, #bdbdbd)',
            backgroundColor: 'var(--bg, #f5f5f5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ ...LABEL, fontSize: 'var(--text-callout)' }}>N/A</span>
          </div>
        )}
      </Link>

      {/* Vehicle name */}
      <Link to={`/vehicle/${exp.vehicle_id}`} style={{
        textDecoration: 'none',
        fontFamily: FONT_BODY,
        fontSize: 'var(--text-callout)',
        fontWeight: 700,
        textTransform: 'none',
        letterSpacing: '0.5px',
        color: 'var(--text, #2a2a2a)',
        minWidth: 0,
        flex: '1 1 180px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'normal',
      }}>
        {ymm}
      </Link>

      {/* Platform */}
      <PlatformBadge platform={exp.platform} label={typeof exp.metadata?.channel_label === 'string' ? exp.metadata.channel_label : null} />

      {/* Status */}
      <StatusBadge status={exp.status} />

      {/* Price */}
      <span style={{ fontFamily: FONT_MONO, fontSize: 'var(--text-callout)', fontWeight: 700, minWidth: 70 }}>
        {formatCurrency(exp.asking_price_cents)}
      </span>

      {/* Date */}
      <span style={{ ...LABEL, minWidth: 60 }}>
        {formatDate(exp.created_at)}
      </span>

      {/* Images count */}
      <span style={{ ...LABEL, minWidth: 30 }}>
        {exp.image_count} IMG
      </span>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div className="sell-export-actions">
        {exp.external_listing_url && (
          <button
            onClick={() => window.open(exp.external_listing_url!, '_blank', 'noopener,noreferrer')}
            style={{ ...BUTTON, padding: '3px 8px', fontSize: 'var(--text-callout)' }}
          >
            View listing
          </button>
        )}
        {exp.status === 'prepared' && (
          <button
            className="button"
            disabled={disabled}
            onClick={() => void onStatusChange(exp.id, 'submitted')}
            style={{ ...BUTTON, padding: '3px 8px', fontSize: 'var(--text-callout)' }}
          >
            {busyId === exp.id ? 'Saving…' : 'Mark submitted'}
          </button>
        )}
        {exp.status === 'submitted' && (
          <button
            className="button"
            disabled={disabled}
            onClick={() => void onStatusChange(exp.id, 'active')}
            style={{ ...BUTTON, padding: '3px 8px', fontSize: 'var(--text-callout)' }}
          >
            {busyId === exp.id ? 'Saving…' : 'Mark active'}
          </button>
        )}
        {(exp.status === 'active' || exp.status === 'submitted') && (
          <button
            className="button"
            disabled={disabled}
            onClick={() => void onStatusChange(exp.id, 'sold')}
            style={{ ...BUTTON, padding: '3px 8px', fontSize: 'var(--text-callout)', borderColor: 'var(--success, #16825d)', color: 'var(--success, #16825d)' }}
          >
            {busyId === exp.id ? 'Saving…' : 'Mark sold'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export default function SellDashboard() {
  usePageTitle('Sell dashboard');
  const [exports, setExports] = useState<ExportWithVehicle[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = useRef(false);
  const reading = useRef(false);
  const lifetime = useRef(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');

  const fetchExports = useCallback(async (): Promise<ExportWithVehicle[] | null> => {
    if (reading.current) return null;
    reading.current = true;
    const scope = lifetime.current;
    setLoading(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (scope !== lifetime.current) return null;
      if (authError || !user) {
        setExports([]); setHasLoaded(false);
        throw authError || new Error('Sign in again to read your listing exports.');
      }
      const { data, error } = await supabase.from('listing_exports')
        .select(`*, vehicle:vehicles!listing_exports_vehicle_id_fkey (year, make, model, primary_image_url)`)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (scope !== lifetime.current) return null;
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('The listing reader returned no readable result.');
      const rows = data as ExportWithVehicle[];
      setExports(rows); setHasLoaded(true); setReadError(null);
      return rows;
    } catch (err) {
      if (scope === lifetime.current) setReadError(err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Could not load listing exports.');
      return null;
    } finally {
      if (scope === lifetime.current) { reading.current = false; setLoading(false); }
    }
  }, []);

  useEffect(() => {
    void fetchExports();
    return () => { lifetime.current++; reading.current = false; };
  }, [fetchExports]);

  const handleStatusChange = useCallback(async (id: string, status: ListingExport['status']) => {
    if (pending.current || reading.current || readError) return;
    pending.current = true; setBusyId(id); setActionError(null); setStatusMessage(null);
    const scope = lifetime.current;
    const updates: Parameters<typeof ListingExportService.updateExportStatus>[2] = {};
    if (status === 'submitted') updates.submitted_at = new Date().toISOString();
    if (status === 'active') updates.activated_at = new Date().toISOString();
    if (status === 'sold' || status === 'expired' || status === 'cancelled') updates.ended_at = new Date().toISOString();
    try {
      const result = await ListingExportService.updateExportStatus(id, status, updates);
      if (scope !== lifetime.current) return;
      if (!result.success) throw new Error(result.error || 'The status update was refused.');
      const rows = await fetchExports();
      if (scope !== lifetime.current) return;
      if (rows?.some(row => row.id === id && row.status === status)) setStatusMessage('Listing status updated.');
      else setActionError('The updated status could not be confirmed. Refresh data to check this listing before trying again.');
    } catch (err) {
      if (scope === lifetime.current) setActionError(err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Could not update the listing status.');
    } finally {
      if (scope === lifetime.current) { pending.current = false; setBusyId(null); }
    }
  }, [fetchExports, readError]);

  const filtered = exports.filter(e => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (platformFilter !== 'all' && e.platform !== platformFilter) return false;
    return true;
  });

  const uniquePlatforms = [...new Set(exports.map(e => e.platform))];

  return (
    <div className="sell-dashboard" style={{ fontFamily: FONT_BODY, minHeight: '60vh' }}>
      {/* Page header */}
      <div style={{
        padding: '14px',
        borderBottom: '2px solid var(--border, #bdbdbd)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <h1 style={{
          margin: 0,
          fontSize: 'var(--text-title)',
          fontWeight: 700,
          textTransform: 'none',
          letterSpacing: '0.5px',
        }}>
          Sell dashboard
        </h1>
        <Link to="/?tab=garage" className="button" style={{ ...BUTTON, textDecoration: 'none', display: 'inline-block' }}>
          Back to Garage
        </Link>
      </div>

      {/* Stats */}
      <div className="sell-dashboard-messages">
        <button className="button" disabled={loading || busyId !== null} onClick={() => { setStatusMessage(null); void fetchExports(); }}>{loading ? 'Refreshing…' : 'Refresh data'}</button>
        {readError && <p role="alert">{readError} {hasLoaded ? 'Showing the last successful list. Refresh before changing a status.' : 'Your listing count is unknown.'}</p>}
        {actionError && <p role="alert">{actionError}</p>}
        {statusMessage && <p role="status">{statusMessage}</p>}
      </div>
      {hasLoaded && <StatsBar exports={exports} />}

      {/* Filters */}
      <div style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        padding: '8px 14px',
        borderBottom: '2px solid var(--border, #bdbdbd)',
        alignItems: 'center',
      }}>
        <span style={LABEL}>FILTER</span>

        {/* Status filter */}
        <select
          aria-label="Listing status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          style={{
            fontFamily: FONT_BODY,
            minHeight: 'var(--control-height)',
            padding: '4px 8px',
            border: '2px solid var(--border, #bdbdbd)',
            backgroundColor: 'var(--bg, #f5f5f5)',
            cursor: 'pointer',
          }}
        >
          <option value="all">ALL STATUS</option>
          <option value="prepared">DRAFT</option>
          <option value="submitted">SUBMITTED</option>
          <option value="active">ACTIVE</option>
          <option value="sold">SOLD</option>
          <option value="expired">EXPIRED</option>
          <option value="cancelled">CANCELLED</option>
        </select>

        {/* Platform filter */}
        <select
          aria-label="Listing platform"
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          style={{
            fontFamily: FONT_BODY,
            minHeight: 'var(--control-height)',
            padding: '4px 8px',
            border: '2px solid var(--border, #bdbdbd)',
            backgroundColor: 'var(--bg, #f5f5f5)',
            cursor: 'pointer',
          }}
        >
          <option value="all">ALL PLATFORMS</option>
          {uniquePlatforms.map(p => (
            <option key={p} value={p}>{(PLATFORM_LABELS[p] || p).toUpperCase()}</option>
          ))}
        </select>

        <div style={{ flex: 1 }} />
        <span style={{ ...LABEL }}>
          {hasLoaded ? `${filtered.length} loaded listing${filtered.length !== 1 ? 's' : ''}` : 'Listings not loaded'}
        </span>
      </div>

      {/* Listings */}
      {loading && !hasLoaded ? (
        <div style={{ textAlign: 'center', padding: 40, ...LABEL, fontSize: 'var(--text-callout)' }}>
          Loading listing exports…
        </div>
      ) : !hasLoaded ? null : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ ...LABEL, marginBottom: 8 }}>{exports.length ? 'No listings match these filters' : 'No listing exports yet'}</div>
          <div style={{ ...LABEL, fontSize: 'var(--text-callout)', color: 'var(--text-secondary, #666666)' }}>
            {exports.length ? 'Choose another status or platform to see your loaded listings.' : 'Open a vehicle from your Garage and use “Compose & Autofill” to prepare a listing.'}
          </div>
        </div>
      ) : (
        <div>
          {filtered.map(exp => (
            <ExportRow key={exp.id} exp={exp} onStatusChange={handleStatusChange} busyId={busyId} disabled={busyId !== null || loading || !!readError} />
          ))}
        </div>
      )}
    </div>
  );
}
