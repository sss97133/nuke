import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import PrefetchLink from '../components/PrefetchLink';
import { VehicleIdentity } from '../components/common/MakeIdentity';
import './UnlinkedReceipts.css';

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

const PAGE_SIZE = 50;
type ReceiptCursor = Pick<ReceiptDoc, 'id' | 'created_at'>;

const formatReceiptAmount = (amount: number | null, currency?: string | null) => {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'Amount unknown';
  const value = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const code = currency?.trim().toUpperCase();
  if (!code) return `${value} (currency unknown)`;
  if (!/^[A-Z]{3}$/.test(code)) return `${value} (currency not recognized)`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: 'code', maximumFractionDigits: 6 }).format(amount);
  } catch {
    return `${value} (currency not recognized)`;
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Date unknown';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unknown';
  return date.toLocaleDateString();
};

export default function UnlinkedReceipts() {
  const navigate = useNavigate();
  const [receipts, setReceipts] = useState<ReceiptDoc[]>([]);
  const [vehicleMap, setVehicleMap] = useState<Record<string, VehicleSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicleError, setVehicleError] = useState(false);
  const [cursors, setCursors] = useState<Array<ReceiptCursor | null>>([null]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const cursor = cursors[page];

  const refresh = () => {
    generation.current++;
    setReceipts([]); setVehicleMap({}); setLoading(true); setError(null); setVehicleError(false); setHasMore(false);
    setCursors([null]); setPage(0); setRevision(value => value + 1);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event !== 'INITIAL_SESSION' && event !== 'TOKEN_REFRESHED') refresh();
    });
    return () => { generation.current++; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const request = ++generation.current;
    const current = () => generation.current === request;
    setLoading(true);
    setError(null); setVehicleError(false); setReceipts([]); setVehicleMap({}); setHasMore(false);
    const loadReceipts = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (!current()) return;
        if (authError) throw new Error('Your account could not be checked. Please retry.');
        if (!user) {
          navigate(`/login?returnUrl=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
          return;
        }

        let query = supabase
          .from('vehicle_documents')
          .select('id,vehicle_id,title,file_url,vendor_name,amount,currency,created_at')
          .eq('document_type', 'receipt')
          .is('linked_to_tag_id', null)
          .eq('uploaded_by', user.id)
          .order('created_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false })
          .limit(PAGE_SIZE + 1);
        // Seek from the last shown row so new uploads do not shift later pages.
        // Both values are typed database columns, never free-form filter input.
        if (cursor) query = cursor.created_at === null
          ? query.is('created_at', null).lt('id', cursor.id)
          : query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id}),created_at.is.null`);
        const { data, error: receiptsError } = await query;
        if (!current()) return;

        if (receiptsError) {
          throw receiptsError;
        }

        if (!Array.isArray(data)) throw new Error('Receipt list unavailable.');
        const rows = data.slice(0, PAGE_SIZE) as ReceiptDoc[];
        const map: Record<string, VehicleSummary> = {};

        const vehicleIds = Array.from(new Set(rows.map((row) => row.vehicle_id).filter(Boolean))) as string[];
        if (vehicleIds.length > 0) {
          try {
            const { data: vehiclesData, error: vehiclesError } = await supabase
              .from('vehicles')
              .select('id,year,make,model')
              .in('id', vehicleIds);

            if (!current()) return;
            if (vehiclesError || !Array.isArray(vehiclesData)) throw new Error('Vehicle details unavailable.');
            vehiclesData.forEach((vehicle: VehicleSummary) => {
              map[vehicle.id] = {
                id: vehicle.id,
                year: vehicle.year ?? null,
                make: vehicle.make ?? null,
                model: vehicle.model ?? null
              };
            });
          } catch { if (current()) setVehicleError(true); }
        }
        if (!current()) return;
        setVehicleMap(map); setReceipts(rows); setHasMore(data.length > PAGE_SIZE);
      } catch {
        if (current()) setError('Receipts could not load. Retry this page.');
      } finally {
        if (current()) setLoading(false);
      }
    };
    void loadReceipts();
    return () => { if (current()) generation.current++; };
  }, [cursor, revision, navigate]);

  return (
    <section className="receipt-review" aria-labelledby="receipt-review-title">
          <div className="receipt-review-header">
              <div><p className="receipt-review-eyebrow">Your uploaded documents</p><h1 id="receipt-review-title">Receipts without image tags</h1></div>
              <div className="receipt-review-actions">
                <button type="button" onClick={refresh} disabled={loading}>
                  Refresh list
                </button>
                <PrefetchLink to="/accounting" className="receipt-review-primary">Open accounting</PrefetchLink>
              </div>
          </div>
          <div className="receipt-review-note"><p>This list contains your receipt uploads that have no linked image tag. It does not establish whether a receipt is in your books, paid, or assigned to a job.</p><p>Open Accounting to review saved books, source evidence and assignments. This page does not identify matching accounting entries.</p></div>
          <div className="receipt-review-list" aria-busy={loading}>
              <p role="status" className="receipt-review-status">{loading ? 'Loading receipts…' : !error && receipts.length > 0 ? `Page ${page + 1} · ${receipts.length} receipt${receipts.length === 1 ? '' : 's'} shown. ${hasMore ? 'More receipts are available.' : 'End of this list.'}` : ''}</p>
              {error && <div role="alert" className="receipt-review-error"><p>{error}</p><button type="button" onClick={() => setRevision(value => value + 1)}>Retry page</button></div>}
              {!loading && vehicleError && <p role="status">Vehicle details could not load. The receipt sources are still available; refresh to retry the vehicle lookup.</p>}
              {!loading && !error && receipts.length === 0 && (
                <p>{page === 0 ? 'No receipt uploads without image tags were found in your account.' : 'No receipts remain on this page. Go back or refresh the list.'}</p>
              )}

              {!loading && !error && receipts.length > 0 && (
                <div className="receipt-review-table">
                  <table>
                    <caption className="sr-only">Uploaded receipt sources without image tags, newest uploads first</caption>
                    <thead>
                      <tr>
                        <th scope="col">Receipt</th>
                        <th scope="col">Recorded vehicle</th>
                        <th scope="col">Recorded amount</th>
                        <th scope="col">Uploaded</th>
                        <th scope="col">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipts.map((receipt) => {
                        const vehicle = receipt.vehicle_id ? vehicleMap[receipt.vehicle_id] : null;
                        return (
                          <tr key={receipt.id}>
                            <td data-label="Receipt">
                              <strong>
                                {receipt.title || receipt.vendor_name || 'Receipt'}
                              </strong>
                              <div className="receipt-review-muted">
                                {receipt.vendor_name || 'Vendor unknown'}
                              </div>
                            </td>
                            <td data-label="Recorded vehicle">
                              <div>{vehicle ? <VehicleIdentity year={vehicle.year} make={vehicle.make || ''} model={vehicle.model || ''} /> : receipt.vehicle_id ? 'Vehicle details unavailable' : 'No vehicle recorded'}</div>
                              {receipt.vehicle_id && (
                                <PrefetchLink
                                  to={`/vehicle/${receipt.vehicle_id}`}
                                >
                                  Open vehicle
                                </PrefetchLink>
                              )}
                            </td>
                            <td data-label="Recorded amount" className="receipt-review-amount">
                              {formatReceiptAmount(receipt.amount, receipt.currency)}
                            </td>
                            <td data-label="Uploaded">
                              {formatDate(receipt.created_at)}
                            </td>
                            <td data-label="Source">
                              {receipt.file_url ? (
                                <a
                                  href={receipt.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Open file <span className="sr-only">in a new tab</span>
                                </a>
                              ) : (
                                <span className="receipt-review-muted">No file recorded</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <nav className="receipt-review-pagination" aria-label="Receipt pages">
                <button type="button" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>Previous page</button>
                <span>Page {page + 1}</span>
                <button type="button" disabled={loading || !!error || !hasMore} onClick={() => {
                  const last = receipts.at(-1);
                  if (!last) return;
                  setCursors(values => [...values.slice(0, page + 1), { id: last.id, created_at: last.created_at }]); setPage(value => value + 1);
                }}>Next page</button>
              </nav>
              <p className="receipt-review-muted receipt-review-limit">Up to {PAGE_SIZE} receipts per page. Refresh starts at the newest upload.</p>
          </div>
    </section>
  );
}
