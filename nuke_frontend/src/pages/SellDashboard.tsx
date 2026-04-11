/**
 * SellDashboard.tsx
 * Shows all listing_exports across all platforms with status tracking.
 * Route: /sell
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ListingExportService, ListingExport } from '../services/listingExportService';

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const FONT_BODY = 'Arial, sans-serif';
const FONT_MONO = "'Courier New', Courier, monospace";

const LABEL: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  fontSize: '8px',
  fontWeight: 700,
  color: 'var(--text-secondary, #666666)',
  fontFamily: FONT_BODY,
};

const BUTTON: React.CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: '9px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  padding: '6px 12px',
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
  submitted: { bg: 'var(--bg, #f5f5f5)', border: 'var(--warning, #b05a00)', color: 'var(--warning, #b05a00)' },
  active: { bg: 'var(--bg, #f5f5f5)', border: 'var(--success, #16825d)', color: 'var(--success, #16825d)' },
  sold: { bg: 'var(--bg, #f5f5f5)', border: 'var(--text, #2a2a2a)', color: 'var(--text, #2a2a2a)' },
  expired: { bg: 'var(--bg, #f5f5f5)', border: 'var(--error, #d13438)', color: 'var(--error, #d13438)' },
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

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span style={{
      ...LABEL,
      padding: '2px 6px',
      border: '2px solid var(--border, #bdbdbd)',
      display: 'inline-block',
    }}>
      {PLATFORM_LABELS[platform] || platform.toUpperCase()}
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
      padding: '12px 14px',
      borderBottom: '2px solid var(--border, #bdbdbd)',
      backgroundColor: 'var(--bg, #f5f5f5)',
    }}>
      {[
        { label: 'TOTAL', value: String(total) },
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

function ExportRow({ exp, onStatusChange }: {
  exp: ExportWithVehicle;
  onStatusChange: (id: string, status: ListingExport['status']) => void;
}) {
  const ymm = [exp.vehicle?.year, exp.vehicle?.make, exp.vehicle?.model]
    .filter(Boolean).join(' ').toUpperCase() || 'UNKNOWN VEHICLE';

  return (
    <div style={{
      display: 'flex',
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
            style={{ width: 48, height: 36, objectFit: 'cover', border: '2px solid var(--border, #bdbdbd)' }}
          />
        ) : (
          <div style={{
            width: 48, height: 36,
            border: '2px solid var(--border, #bdbdbd)',
            backgroundColor: 'var(--bg, #f5f5f5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ ...LABEL, fontSize: '7px' }}>N/A</span>
          </div>
        )}
      </Link>

      {/* Vehicle name */}
      <Link to={`/vehicle/${exp.vehicle_id}`} style={{
        textDecoration: 'none',
        fontFamily: FONT_BODY,
        fontSize: '10px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        color: 'var(--text, #2a2a2a)',
        minWidth: 140,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {ymm}
      </Link>

      {/* Platform */}
      <PlatformBadge platform={exp.platform} />

      {/* Status */}
      <StatusBadge status={exp.status} />

      {/* Price */}
      <span style={{ fontFamily: FONT_MONO, fontSize: '10px', fontWeight: 700, minWidth: 70 }}>
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
      <div style={{ display: 'flex', gap: 4 }}>
        {exp.external_listing_url && (
          <button
            onClick={() => window.open(exp.external_listing_url!, '_blank')}
            style={{ ...BUTTON, padding: '3px 8px', fontSize: '8px' }}
          >
            VIEW
          </button>
        )}
        {exp.status === 'prepared' && (
          <button
            onClick={() => onStatusChange(exp.id, 'submitted')}
            style={{ ...BUTTON, padding: '3px 8px', fontSize: '8px' }}
          >
            MARK SUBMITTED
          </button>
        )}
        {exp.status === 'submitted' && (
          <button
            onClick={() => onStatusChange(exp.id, 'active')}
            style={{ ...BUTTON, padding: '3px 8px', fontSize: '8px' }}
          >
            MARK ACTIVE
          </button>
        )}
        {(exp.status === 'active' || exp.status === 'submitted') && (
          <button
            onClick={() => onStatusChange(exp.id, 'sold')}
            style={{ ...BUTTON, padding: '3px 8px', fontSize: '8px', borderColor: 'var(--success, #16825d)', color: 'var(--success, #16825d)' }}
          >
            MARK SOLD
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
  const [exports, setExports] = useState<ExportWithVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');

  const fetchExports = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('listing_exports')
        .select(`
          *,
          vehicle:vehicles!listing_exports_vehicle_id_fkey (
            year, make, model, primary_image_url
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setExports((data || []) as ExportWithVehicle[]);
    } catch (err) {
      console.error('Error fetching exports:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchExports(); }, [fetchExports]);

  const handleStatusChange = useCallback(async (id: string, status: ListingExport['status']) => {
    const updates: Record<string, unknown> = {};
    if (status === 'submitted') updates.submitted_at = new Date().toISOString();
    if (status === 'active') updates.activated_at = new Date().toISOString();
    if (status === 'sold' || status === 'expired' || status === 'cancelled') updates.ended_at = new Date().toISOString();

    await ListingExportService.updateExportStatus(id, status, updates as any);
    fetchExports();
  }, [fetchExports]);

  const filtered = exports.filter(e => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (platformFilter !== 'all' && e.platform !== platformFilter) return false;
    return true;
  });

  const uniquePlatforms = [...new Set(exports.map(e => e.platform))];

  return (
    <div style={{ fontFamily: FONT_BODY, minHeight: '60vh' }}>
      {/* Page header */}
      <div style={{
        padding: '14px',
        borderBottom: '2px solid var(--border, #bdbdbd)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: '14px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          SELL DASHBOARD
        </span>
        <Link to="/?tab=garage" style={{ ...BUTTON, textDecoration: 'none', display: 'inline-block' }}>
          BACK TO GARAGE
        </Link>
      </div>

      {/* Stats */}
      <StatsBar exports={exports} />

      {/* Filters */}
      <div style={{
        display: 'flex',
        gap: 8,
        padding: '8px 14px',
        borderBottom: '2px solid var(--border, #bdbdbd)',
        alignItems: 'center',
      }}>
        <span style={LABEL}>FILTER</span>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          style={{
            fontFamily: FONT_BODY,
            fontSize: '9px',
            fontWeight: 700,
            textTransform: 'uppercase',
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
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          style={{
            fontFamily: FONT_BODY,
            fontSize: '9px',
            fontWeight: 700,
            textTransform: 'uppercase',
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
          {filtered.length} LISTING{filtered.length !== 1 ? 'S' : ''}
        </span>
      </div>

      {/* Listings */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, ...LABEL, fontSize: '10px' }}>
          LOADING...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ ...LABEL, fontSize: '10px', marginBottom: 8 }}>NO LISTINGS YET</div>
          <div style={{ ...LABEL, fontSize: '9px', color: 'var(--text-secondary, #666666)' }}>
            GO TO A VEHICLE PROFILE AND USE "COMPOSE & AUTOFILL" TO CREATE YOUR FIRST LISTING
          </div>
        </div>
      ) : (
        <div>
          {filtered.map(exp => (
            <ExportRow key={exp.id} exp={exp} onStatusChange={handleStatusChange} />
          ))}
        </div>
      )}
    </div>
  );
}
