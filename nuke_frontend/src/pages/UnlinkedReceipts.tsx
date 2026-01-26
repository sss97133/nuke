import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../design-system.css';

type ReceiptDoc = {
  id: string;
  vehicle_id: string | null;
  title: string | null;
  file_url: string | null;
  vendor_name: string | null;
  amount: number | null;
  currency: string | null;
  created_at: string | null;
};

type VehicleSummary = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
};

const formatCurrency = (amount: number | null, currency?: string | null) => {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  const code = currency || 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleDateString();
};

export default function UnlinkedReceipts() {
  const navigate = useNavigate();
  const [receipts, setReceipts] = useState<ReceiptDoc[]>([]);
  const [vehicleMap, setVehicleMap] = useState<Record<string, VehicleSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReceipts = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate(`/login?returnUrl=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
        return;
      }

      const { data, error: receiptsError } = await supabase
        .from('vehicle_documents')
        .select('id,vehicle_id,title,file_url,vendor_name,amount,currency,created_at')
        .eq('document_type', 'receipt')
        .is('linked_to_tag_id', null)
        .eq('uploaded_by', user.id)
        .order('created_at', { ascending: false })
        .limit(200);

      if (receiptsError) {
        throw receiptsError;
      }

      const rows = (data || []) as ReceiptDoc[];
      setReceipts(rows);

      const vehicleIds = Array.from(new Set(rows.map((row) => row.vehicle_id).filter(Boolean))) as string[];
      if (vehicleIds.length > 0) {
        const { data: vehiclesData } = await supabase
          .from('vehicles')
          .select('id,year,make,model')
          .in('id', vehicleIds);

        const map: Record<string, VehicleSummary> = {};
        (vehiclesData || []).forEach((vehicle: any) => {
          map[vehicle.id] = {
            id: vehicle.id,
            year: vehicle.year ?? null,
            make: vehicle.make ?? null,
            model: vehicle.model ?? null
          };
        });
        setVehicleMap(map);
      } else {
        setVehicleMap({});
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load unlinked receipts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReceipts();
  }, []);

  return (
    <div className="layout">
      <div className="container">
        <div className="main" style={{ padding: '24px' }}>
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Unlinked Receipts</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="button button-secondary" onClick={loadReceipts} style={{ fontSize: '8pt' }}>
                  Refresh
                </button>
                <button className="button button-secondary" onClick={() => navigate('/org/dashboard')} style={{ fontSize: '8pt' }}>
                  Back to Dashboard
                </button>
              </div>
            </div>
            <div className="card-body">
              {loading && <p className="text-small text-muted">Loading receipts...</p>}
              {error && <div className="alert alert-error">{error}</div>}
              {!loading && !error && receipts.length === 0 && (
                <p className="text-small text-muted">No unlinked receipts found.</p>
              )}

              {!loading && !error && receipts.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '8px' }}>Receipt</th>
                        <th style={{ padding: '8px' }}>Vehicle</th>
                        <th style={{ padding: '8px' }}>Amount</th>
                        <th style={{ padding: '8px' }}>Uploaded</th>
                        <th style={{ padding: '8px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipts.map((receipt) => {
                        const vehicle = receipt.vehicle_id ? vehicleMap[receipt.vehicle_id] : null;
                        const vehicleLabel = vehicle
                          ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle'
                          : 'Unknown vehicle';

                        return (
                          <tr key={receipt.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                            <td style={{ padding: '8px', maxWidth: '220px' }}>
                              <div style={{ fontWeight: 600 }}>
                                {receipt.title || receipt.vendor_name || 'Receipt'}
                              </div>
                              <div className="text-small text-muted">
                                {receipt.vendor_name || '—'}
                              </div>
                            </td>
                            <td style={{ padding: '8px' }}>
                              <div>{vehicleLabel}</div>
                              {receipt.vehicle_id && (
                                <button
                                  className="button button-link"
                                  style={{ fontSize: '8pt', padding: 0 }}
                                  onClick={() => navigate(`/vehicle/${receipt.vehicle_id}`)}
                                >
                                  Open vehicle
                                </button>
                              )}
                            </td>
                            <td style={{ padding: '8px' }}>
                              {formatCurrency(receipt.amount, receipt.currency)}
                            </td>
                            <td style={{ padding: '8px' }}>
                              {formatDate(receipt.created_at)}
                            </td>
                            <td style={{ padding: '8px' }}>
                              {receipt.file_url ? (
                                <a
                                  href={receipt.file_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="button button-small"
                                  style={{ fontSize: '8pt' }}
                                >
                                  Open file
                                </a>
                              ) : (
                                <span className="text-small text-muted">No file</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
