import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

type VehicleDocRow = {
  id: string;
  document_type: string;
  title: string | null;
  file_url: string | null;
  file_type: string | null;
  vendor_name: string | null;
  amount: number | null;
  currency: string | null;
  created_at: string | null;
};

type ReceiptRow = {
  id: string;
  source_document_id: string | null;
  processing_status: string | null;
  vendor_name: string | null;
  total: number | null;
  currency: string | null;
  created_at: string | null;
};

function formatUsd(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatDate(ts?: string | null): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleDateString();
  } catch {
    return '—';
  }
}

export function VehicleLedgerDocumentsCard(props: {
  vehicleId: string;
  canManage: boolean;
}) {
  const { vehicleId, canManage } = props;

  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<VehicleDocRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ succeeded: number; failed: number; remaining: number; lastBatch: number } | null>(null);
  const cancelRef = useRef(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [docsRes, receiptsRes] = await Promise.all([
        supabase
          .from('vehicle_documents')
          .select('id,document_type,title,file_url,file_type,vendor_name,amount,currency,created_at')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('receipts')
          .select('id,source_document_id,processing_status,vendor_name,total,currency,created_at')
          .eq('source_document_table', 'vehicle_documents')
          .eq('scope_type', 'vehicle')
          .eq('scope_id', vehicleId)
          .order('created_at', { ascending: false })
          .limit(2000),
      ]);

      if (docsRes.error) throw docsRes.error;
      if (receiptsRes.error) throw receiptsRes.error;

      setDocs((docsRes.data as any[]) || []);
      setReceipts((receiptsRes.data as any[]) || []);
    } catch (e: any) {
      setDocs([]);
      setReceipts([]);
      setError(e?.message || 'Failed to load ledger documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  const receiptByDocId = useMemo(() => {
    const m = new Map<string, ReceiptRow>();
    for (const r of receipts) {
      const k = r.source_document_id ? String(r.source_document_id) : '';
      if (!k) continue;
      // Keep the latest receipt per doc
      if (!m.has(k)) m.set(k, r);
    }
    return m;
  }, [receipts]);

  const totals = useMemo(() => {
    const totalDocs = docs.length;
    let processed = 0;
    let failed = 0;
    let spent = 0;
    for (const d of docs) {
      const r = receiptByDocId.get(String(d.id));
      if (r) processed++;
      const st = String(r?.processing_status || '').toLowerCase();
      if (st === 'failed') failed++;
      if (typeof r?.total === 'number') spent += r.total;
    }
    return { totalDocs, processed, failed, spent, remaining: Math.max(0, totalDocs - processed) };
  }, [docs, receiptByDocId]);

  const runAll = async () => {
    if (!canManage || running) return;
    cancelRef.current = false;
    setRunning(true);
    setProgress({ succeeded: 0, failed: 0, remaining: totals.remaining, lastBatch: 0 });
    setError(null);

    try {
      // Loop until done or cancelled. Each batch does a small amount of work to avoid timeouts.
      for (let i = 0; i < 999; i++) {
        if (cancelRef.current) break;

        const { data, error: fnErr } = await supabase.functions.invoke('analyze-vehicle-documents', {
          body: { vehicleId, limit: 5, retry_failed: false }
        });

        if (fnErr) {
          throw fnErr;
        }

        const batchSucceeded = Number((data as any)?.succeeded || 0);
        const batchFailed = Number((data as any)?.failed || 0);
        const remaining = Number((data as any)?.remaining ?? 0);
        const processedInBatch = Number((data as any)?.processed_in_batch || 0);

        setProgress((p) => ({
          succeeded: (p?.succeeded || 0) + batchSucceeded,
          failed: (p?.failed || 0) + batchFailed,
          remaining,
          lastBatch: processedInBatch
        }));

        await load();

        if (!Number.isFinite(remaining) || remaining <= 0) break;
        if (!Number.isFinite(processedInBatch) || processedInBatch <= 0) break;

        // Small delay to be polite to the worker + OpenAI/Azure backend
        await new Promise((r) => setTimeout(r, 350));
      }
    } catch (e: any) {
      setError(e?.message || 'Analysis failed');
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    cancelRef.current = true;
    setRunning(false);
  };

  return (
    <div className="card" style={{ marginTop: 'var(--space-3)' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>Investment ledger documents</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {canManage && (
            <>
              <button className="button button-small" disabled={running || loading} onClick={runAll} style={{ fontSize: '8pt' }}>
                {running ? 'Analyzing…' : 'Analyze all'}
              </button>
              {running && (
                <button className="button button-small" onClick={stop} style={{ fontSize: '8pt' }}>
                  Stop
                </button>
              )}
            </>
          )}
          <button className="button button-small" disabled={loading} onClick={load} style={{ fontSize: '8pt' }}>
            Refresh
          </button>
        </div>
      </div>

      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <div className="text-small text-muted">Loading…</div>
        ) : error ? (
          <div className="text-small" style={{ color: '#b91c1c' }}>{error}</div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: '8pt' }}>
              <div><strong>Total docs:</strong> {totals.totalDocs}</div>
              <div><strong>Analyzed:</strong> {totals.processed}</div>
              <div><strong>Failed:</strong> {totals.failed}</div>
              <div><strong>Remaining:</strong> {totals.remaining}</div>
              <div><strong>Total spend (from extracted receipts):</strong> {formatUsd(totals.spent)}</div>
            </div>

            {progress && (
              <div className="text-small text-muted">
                Last batch: {progress.lastBatch} · Succeeded: {progress.succeeded} · Failed: {progress.failed} · Remaining: {progress.remaining}
              </div>
            )}

            {docs.length === 0 ? (
              <div className="text-small text-muted">No vehicle documents found.</div>
            ) : (
              <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Doc</th>
                      <th style={{ textAlign: 'left' }}>Type</th>
                      <th style={{ textAlign: 'left' }}>Vendor</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'left' }}>Status</th>
                      <th style={{ textAlign: 'left' }}>Uploaded</th>
                      <th style={{ textAlign: 'left' }}>Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.slice(0, 200).map((d) => {
                      const r = receiptByDocId.get(String(d.id));
                      const st = String(r?.processing_status || (r ? 'processed' : 'pending')).toLowerCase();
                      const statusLabel = st || (r ? 'processed' : 'pending');
                      return (
                        <tr key={d.id}>
                          <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.title || d.id}
                          </td>
                          <td>{d.document_type || '—'}</td>
                          <td>{r?.vendor_name || d.vendor_name || '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            {typeof r?.total === 'number'
                              ? formatUsd(r.total)
                              : (typeof d.amount === 'number' ? formatUsd(d.amount) : '—')}
                          </td>
                          <td>{statusLabel}</td>
                          <td>{formatDate(d.created_at)}</td>
                          <td>
                            {d.file_url ? (
                              <a href={d.file_url} target="_blank" rel="noreferrer">
                                View
                              </a>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

