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

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('vehicle_price_history')
          .select('id, price_type, value, source, as_of, confidence')
          .eq('vehicle_id', vehicleId)
          .order('as_of', { ascending: false })
          .limit(200);
        if (error) throw error;
        setRows((data as any) || []);
      } catch (e) {
        console.error('load history failed', e);
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [vehicleId, isOpen]);

  if (!isOpen) return null;

  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>Price History</div>
        <div style={bodyStyle}>
          {loading ? (
            <div className="text" style={to8}>Loading history...</div>
          ) : rows.length === 0 ? (
            <div className="text text-muted" style={to8}>No history yet</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['as_of','price_type','value','confidence','source'].map(h => (
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
