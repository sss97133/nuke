import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface PriceAnalysisPanelProps {
  vehicleId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface RpcSignal {
  vehicle_id: string;
  primary_label: string | null;
  primary_value: number | null;
  anchor_label: string | null;
  anchor_value: number | null;
  delta_amount: number | null;
  delta_pct: number | null;
  confidence: number | null;
  sources: string[] | null;
  missing_fields?: string[] | null;
  updated_at: string | null;
}

interface HistPoint { as_of: string; value: number; type: string }

const to8 = { fontSize: '8pt' } as const;
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const panel: React.CSSProperties = { width: 760, maxWidth: '95%', background: 'var(--surface)', border: '1px solid #c0c0c0', borderRadius: 2 };
const header: React.CSSProperties = { ...to8, padding: 6, borderBottom: '1px solid #c0c0c0', background: '#f3f4f6', fontWeight: 700 };
const body: React.CSSProperties = { padding: 8 };
const chip: React.CSSProperties = { ...to8, background: '#f3f4f6', border: '1px solid #c0c0c0', padding: '1px 4px', borderRadius: 2 };

const PriceAnalysisPanel: React.FC<PriceAnalysisPanelProps> = ({ vehicleId, isOpen, onClose }) => {
  const [sig, setSig] = useState<RpcSignal | null>(null);
  const [history, setHistory] = useState<HistPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      setLoading(true);
      try {
        const [{ data: rpc, error: rpcErr }, { data: hist, error: histErr }] = await Promise.all([
          supabase.rpc('vehicle_price_signal', { vehicle_ids: [vehicleId] }),
          supabase
            .from('vehicle_price_history')
            .select('as_of,value,price_type')
            .eq('vehicle_id', vehicleId)
            .in('price_type', ['current','asking','sale'])
            .order('as_of', { ascending: true })
            .limit(200)
        ]);
        if (!rpcErr && Array.isArray(rpc) && rpc.length > 0) setSig(rpc[0] as any);
        else setSig(null);
        if (!histErr && Array.isArray(hist)) {
          setHistory((hist as any[]).map(h => ({ as_of: h.as_of, value: h.value, type: h.price_type })));
        } else setHistory([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, vehicleId]);

  const spark = useMemo(() => {
    if (!history || history.length < 2) return null;
    const values = history.map(h => h.value).filter(v => typeof v === 'number');
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const w = 320, h = 40; const padX = 4, padY = 4;
    const scaleX = (i: number) => padX + (i / (values.length - 1)) * (w - padX * 2);
    const scaleY = (v: number) => {
      if (max === min) return h / 2;
      // invert y (higher values at top)
      return padY + (1 - (v - min) / (max - min)) * (h - padY * 2);
    };
    const pts = values.map((v, i) => `${scaleX(i)},${scaleY(v)}`).join(' ');
    return { w, h, pts, min, max };
  }, [history]);

  if (!isOpen) return null;

  const fmt = (n?: number | null) => (typeof n === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n) : '—');
  const pct = (p?: number | null) => (typeof p === 'number' ? `${(p >= 0 ? '' : '-')}${Math.abs(p).toFixed(1)}%` : '—');

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={header}>Price Analysis</div>
        <div style={body}>
          {loading ? (
            <div className="text" style={to8}>Loading…</div>
          ) : (
            <>
              {/* Top chips */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                <span style={chip}>Primary: {sig?.primary_label || '—'} {fmt(sig?.primary_value)}</span>
                <span style={chip}>Anchor: {sig?.anchor_label || '—'} {fmt(sig?.anchor_value)}</span>
                <span style={{ ...chip, color: (sig?.delta_amount ?? 0) >= 0 ? '#006400' : '#800000' }}>Delta: {pct(sig?.delta_pct)} {fmt(Math.abs(sig?.delta_amount ?? 0))}</span>
                {typeof sig?.confidence === 'number' && <span style={chip}>Conf {sig.confidence}</span>}
                {(sig?.missing_fields || []).length > 0 && (
                  <span style={{ ...chip, borderStyle: 'dashed' }}>Missing: {(sig!.missing_fields || []).join(', ')}</span>
                )}
              </div>

              {/* Sources */}
              {(sig?.sources || []).length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div className="text text-muted" style={to8}>Sources</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(sig!.sources || []).map((s, i) => (<span key={i} style={chip}>{s}</span>))}
                  </div>
                </div>
              )}

              {/* Sparkline */}
              <div style={{ marginTop: 4 }}>
                <div className="text text-muted" style={to8}>30–90d trend</div>
                {spark ? (
                  <svg width={spark.w} height={spark.h} viewBox={`0 0 ${spark.w} ${spark.h}`} style={{ border: '1px solid #c0c0c0' }}>
                    <polyline fill="none" stroke="#2563eb" strokeWidth="1" points={spark.pts} />
                  </svg>
                ) : (
                  <div className="text" style={to8}>Not enough data</div>
                )}
              </div>

              {/* Actions */}
              {(sig?.missing_fields || []).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {(() => {
                    const map: Record<string, string> = {
                      purchase_price: 'missing_purchase',
                      msrp: 'missing_msrp',
                      current_value: 'missing_current',
                      asking_price: 'for_sale_no_asking',
                    };
                    const tokens = (sig!.missing_fields || []).map(f => map[f] || '').filter(Boolean);
                    const href = tokens.length > 0 ? `/admin/price-editor?f=${encodeURIComponent(tokens.join(','))}` : '/admin/price-editor';
                    return (
                      <a className="button button-small" href={href}>
                        Open Bulk Price Editor
                      </a>
                    );
                  })()}
                </div>
              )}
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="button button-small" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PriceAnalysisPanel;
