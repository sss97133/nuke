import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface PriceHistoryModalProps {
  vehicleId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface HistoryRow {
  id: string;
  price_type: 'msrp' | 'purchase' | 'current' | 'asking' | 'sale';
  value: number;
  source: string;
  as_of: string;
  confidence: number | null;
  is_outlier?: boolean | null;
  outlier_reason?: string | null;
}

const to8 = { fontSize: '8pt' } as const;
const modalStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
};
const panelStyle: React.CSSProperties = {
  width: '720px', maxWidth: '95%', background: 'var(--surface)', border: '1px solid #c0c0c0', borderRadius: 2
};
const headerStyle: React.CSSProperties = { ...to8, padding: 6, borderBottom: '1px solid #c0c0c0', background: 'var(--bg)', fontWeight: 700 };
const bodyStyle: React.CSSProperties = { padding: 8 };

const PriceHistoryModal: React.FC<PriceHistoryModalProps> = ({ vehicleId, isOpen, onClose }) => {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [baselineByType, setBaselineByType] = useState<Record<string, string>>({});
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      setLoading(true);
      setPinError(null);
      try {
        const { data, error } = await supabase
          .from('vehicle_price_history')
          .select('id, price_type, value, source, as_of, confidence, is_outlier, outlier_reason')
          .eq('vehicle_id', vehicleId)
          .order('as_of', { ascending: false })
          .limit(200);
        if (error) throw error;
        setRows((data as any) || []);

        // Load pinned baselines for 30d (optional; safe if table missing / RLS blocks)
        try {
          const { data: bases } = await supabase
            .from('vehicle_price_baselines')
            .select('price_type, period, baseline_price_history_id')
            .eq('vehicle_id', vehicleId)
            .eq('period', '30d');
          const m: Record<string, string> = {};
          for (const b of (bases as any[]) || []) {
            const pt = String(b?.price_type || '');
            const id = String(b?.baseline_price_history_id || '');
            if (pt && id) m[pt] = id;
          }
          setBaselineByType(m);
        } catch {
          setBaselineByType({});
        }
      } catch (e) {
        console.error('load history failed', e);
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [vehicleId, isOpen]);

  if (!isOpen) return null;

  const handlePinBaseline = async (row: HistoryRow) => {
    setPinError(null);
    setPinningId(row.id);
    try {
      const { error } = await supabase.rpc('set_vehicle_price_baseline', {
        p_vehicle_id: vehicleId,
        p_price_type: row.price_type,
        p_period: '30d',
        p_price_history_id: row.id,
      });
      if (error) throw error;
      setBaselineByType((prev) => ({ ...prev, [row.price_type]: row.id }));
    } catch (e: any) {
      setPinError(e?.message || 'Failed to pin baseline');
    } finally {
      setPinningId(null);
    }
  };

  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>Price History</div>
        <div style={bodyStyle}>
          {pinError ? (
            <div className="text" style={{ ...to8, color: 'var(--error-text, #dc2626)', marginBottom: 8 }}>
              {pinError}
            </div>
          ) : null}
          {loading ? (
            <div className="text" style={to8}>Loading history...</div>
          ) : rows.length === 0 ? (
            <div className="text text-muted" style={to8}>No history yet</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['as_of','price_type','value','confidence','source','flags','baseline'].map(h => (
                      <th key={h} style={{ ...to8, textAlign: 'left', borderBottom: '1px solid #c0c0c0', padding: '2px 4px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td style={{ ...to8, borderBottom: '1px solid #e5e7eb', padding: '2px 4px' }}>{new Date(r.as_of).toLocaleString()}</td>
                      <td style={{ ...to8, borderBottom: '1px solid #e5e7eb', padding: '2px 4px', textTransform: 'uppercase' }}>{r.price_type}</td>
                      <td style={{ ...to8, borderBottom: '1px solid #e5e7eb', padding: '2px 4px' }}>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(r.value)}</td>
                      <td style={{ ...to8, borderBottom: '1px solid #e5e7eb', padding: '2px 4px' }}>{r.confidence ?? ''}</td>
                      <td style={{ ...to8, borderBottom: '1px solid #e5e7eb', padding: '2px 4px' }}>{r.source}</td>
                      <td style={{ ...to8, borderBottom: '1px solid #e5e7eb', padding: '2px 4px' }}>
                        {r.is_outlier ? (
                          <span title={r.outlier_reason || 'outlier'} style={{ color: 'var(--warning, #f59e0b)', fontWeight: 700 }}>
                            OUTLIER
                          </span>
                        ) : (
                          ''
                        )}
                      </td>
                      <td style={{ ...to8, borderBottom: '1px solid #e5e7eb', padding: '2px 4px' }}>
                        {baselineByType[r.price_type] === r.id ? (
                          <span style={{ fontWeight: 800, color: 'var(--primary)' }}>PINNED (30D)</span>
                        ) : (
                          <button
                            className="button button-small"
                            style={{ fontSize: '7pt', padding: '2px 6px' }}
                            disabled={Boolean(r.is_outlier) || pinningId === r.id}
                            onClick={() => handlePinBaseline(r)}
                            title={r.is_outlier ? 'Cannot pin an outlier' : 'Pin as 30D baseline'}
                          >
                            {pinningId === r.id ? 'Pinning...' : 'Pin 30D'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="button button-small" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PriceHistoryModal;
