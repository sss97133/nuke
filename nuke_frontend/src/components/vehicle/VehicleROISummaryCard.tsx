import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type RoiSummary = {
  vehicle_id: string;
  spend?: {
    attributed_spend_cents?: number;
    attributed_spend_usd?: number;
  };
  value?: {
    current_value_usd?: number | null;
    value_30d_ago_usd?: number | null;
    delta_30d_usd?: number | null;
  };
  roi?: {
    roi_30d?: number | null;
    event_value_impact_sum?: number | null;
  };
};

const n = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const num = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(num) ? num : null;
};

const formatUSD0 = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
};

const formatUSD2 = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
};

const formatPct2 = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}%`;
};

export default function VehicleROISummaryCard({ vehicleId }: { vehicleId: string }) {
  const [data, setData] = useState<RoiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const { data, error } = await supabase.rpc('get_vehicle_roi_summary', { p_vehicle_id: vehicleId });
        if (error) throw error;
        if (cancelled) return;

        const raw: any = Array.isArray(data) ? data[0] : data;
        const normalized: RoiSummary = {
          vehicle_id: raw?.vehicle_id ?? vehicleId,
          spend: {
            attributed_spend_cents: n(raw?.spend?.attributed_spend_cents) ?? undefined,
            attributed_spend_usd: n(raw?.spend?.attributed_spend_usd) ?? undefined
          },
          value: {
            current_value_usd: n(raw?.value?.current_value_usd),
            value_30d_ago_usd: n(raw?.value?.value_30d_ago_usd),
            delta_30d_usd: n(raw?.value?.delta_30d_usd)
          },
          roi: {
            roi_30d: n(raw?.roi?.roi_30d),
            event_value_impact_sum: n(raw?.roi?.event_value_impact_sum)
          }
        };

        setData(normalized);
      } catch (e: any) {
        if (cancelled) return;
        console.error('Failed to load ROI summary:', e);
        setError(e?.message || 'Failed to load ROI summary');
        setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  return (
    <div className="card">
      <div className="card-header">Investment Summary</div>
      <div className="card-body">
        {loading ? (
          <div className="text-small text-muted">Loading ROI…</div>
        ) : error ? (
          <div className="text-small text-muted">ROI unavailable: {error}</div>
        ) : (
          <div className="vehicle-details">
            <div className="vehicle-detail">
              <span>Attributed spend</span>
              <span className="text font-bold">{formatUSD2(data?.spend?.attributed_spend_usd)}</span>
            </div>
            <div className="vehicle-detail">
              <span>Current value</span>
              <span className="text">{formatUSD0(data?.value?.current_value_usd ?? null)}</span>
            </div>
            <div className="vehicle-detail">
              <span>Value 30d ago</span>
              <span className="text">{formatUSD0(data?.value?.value_30d_ago_usd ?? null)}</span>
            </div>
            <div className="vehicle-detail">
              <span>Δ 30d</span>
              <span
                className="text"
                style={{
                  color: (data?.value?.delta_30d_usd ?? 0) >= 0 ? '#008000' : '#800000'
                }}
              >
                {formatUSD0(data?.value?.delta_30d_usd ?? null)}
              </span>
            </div>
            <div className="vehicle-detail">
              <span>ROI (30d)</span>
              <span className="text" style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                {formatPct2(data?.roi?.roi_30d ?? null)}
              </span>
            </div>
            <div className="vehicle-detail">
              <span>Event value impact (sum)</span>
              <span className="text">{formatUSD0(data?.roi?.event_value_impact_sum ?? null)}</span>
            </div>
            <div className="text-small text-muted" style={{ marginTop: '8px' }}>
              Derived from receipts/work orders (spend) and valuation series (value delta). This is best-effort until all costs are attributed.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


