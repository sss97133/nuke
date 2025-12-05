import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import ReceiptEvidenceViewer from '../documents/ReceiptEvidenceViewer';

interface PartsInventoryModalProps {
  vehicleId: string;
  open: boolean;
  onClose: () => void;
}

interface ItemRow {
  id: string;
  receipt_id: string;
  line_number?: number | null;
  description?: string | null;
  part_number?: string | null;
  quantity?: number | null;
  total_price?: number | null;
  vendor_name?: string | null;
  receipt_date?: string | null;
  file_url?: string | null;
  raw_json?: any | null;
}

const PartsInventoryModal: React.FC<PartsInventoryModalProps> = ({ vehicleId, open, onClose }) => {
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [evidence, setEvidence] = useState<{ url: string; match: string; ocr: any } | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoading(true);
        const { data: recs } = await supabase
          .from('receipts')
          .select('id, vendor_name, receipt_date, raw_json, source_document_id')
          .eq('scope_type', 'vehicle')
          .eq('scope_id', vehicleId);
        if (!recs || recs.length === 0) { setRows([]); return; }
        const ids = recs.map((r: any) => r.id);
        const { data: items } = await supabase
          .from('receipt_items')
          .select('id, receipt_id, line_number, description, part_number, quantity, total_price')
          .in('receipt_id', ids)
          .order('line_number', { ascending: true });
        const out: ItemRow[] = [];
        for (const it of (items || []) as any[]) {
          const parent = (recs as any[]).find(r => r.id === it.receipt_id);
          let url: string | null = null;
          if (parent?.source_document_id) {
            const { data: doc } = await supabase.from('vehicle_documents').select('file_url').eq('id', parent.source_document_id).single();
            url = doc?.file_url || null;
          }
          out.push({
            id: it.id,
            receipt_id: it.receipt_id,
            line_number: it.line_number,
            description: it.description,
            part_number: it.part_number,
            quantity: it.quantity,
            total_price: it.total_price,
            vendor_name: parent?.vendor_name || null,
            receipt_date: parent?.receipt_date || null,
            file_url: url,
            raw_json: parent?.raw_json || null
          });
        }
        setRows(out);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, vehicleId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => (
      (r.description || '').toLowerCase().includes(q) ||
      (r.part_number || '').toLowerCase().includes(q) ||
      (r.vendor_name || '').toLowerCase().includes(q)
    ));
  }, [rows, search]);

  if (!open) return null;
  return (
    <div className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.6)', zIndex: 10000 }} onClick={onClose}>
      <div className="bg-white border rounded shadow-xl" style={{ position: 'absolute', inset: '8% 8% auto 8%', padding: 8 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>
          <div className="text font-bold" style={{ fontSize: '10pt' }}>Parts Inventory</div>
          <button className="button button-small" onClick={onClose}>Close</button>
        </div>
        <div style={{ padding: 8 }}>
          <input
            className="form-input"
            placeholder="Search by description, part number, vendor"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />
          {loading ? (
            <div className="text-small">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-small text-muted">No items</div>
          ) : (
            <table className="w-full" style={{ fontSize: '9pt' }}>
              <thead>
                <tr className="text-left">
                  <th style={{ padding: '6px' }}>Line</th>
                  <th style={{ padding: '6px' }}>Description</th>
                  <th style={{ padding: '6px' }}>Part #</th>
                  <th style={{ padding: '6px' }}>Qty</th>
                  <th style={{ padding: '6px' }}>Total</th>
                  <th style={{ padding: '6px' }}>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-t border-gray-200">
                    <td style={{ padding: '6px' }}>{r.line_number || '—'}</td>
                    <td style={{ padding: '6px' }}>{r.description || '—'}</td>
                    <td style={{ padding: '6px' }}>{r.part_number || '—'}</td>
                    <td style={{ padding: '6px' }}>{r.quantity ?? '—'}</td>
                    <td style={{ padding: '6px' }}>{typeof r.total_price === 'number' ? `$${r.total_price.toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '6px' }}>
                      {r.file_url ? (
                        <button
                          className="button button-small"
                          onClick={() => setEvidence({ url: r.file_url || '', match: (r.total_price ?? 0).toFixed(2), ocr: r.raw_json?.ocr || r.raw_json })}
                        >
                          View Evidence
                        </button>
                      ) : (
                        <span className="text-small text-muted">No file</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {evidence && (
        <ReceiptEvidenceViewer
          open={!!evidence}
          onClose={() => setEvidence(null)}
          fileUrl={evidence.url}
          matchText={evidence.match}
          ocr={evidence.ocr}
        />
      )}
    </div>
  );
};

export default PartsInventoryModal;


