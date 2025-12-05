import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import ReceiptEvidenceViewer from '../documents/ReceiptEvidenceViewer';

interface PartEvidenceModalProps {
  vehicleId: string;
  open: boolean;
  onClose: () => void;
  partName: string;
  category?: string;
}

interface ImgRow { id: string; image_url: string; taken_at: string | null; created_at: string; }
interface RecRow { id: string; vendor_name: string | null; receipt_date: string | null; total: number | null; raw_json: any | null; source_document_id: string | null; file_url?: string | null; matched_item?: any }

const tokenize = (s: string) => (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const PartEvidenceModal: React.FC<PartEvidenceModalProps> = ({ vehicleId, open, onClose, partName }) => {
  const [images, setImages] = useState<ImgRow[]>([]);
  const [receipts, setReceipts] = useState<RecRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [evidence, setEvidence] = useState<{ url: string; ocr: any; match: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoading(true);
        const tokens = tokenize(partName);
        // 1) Find images with tags matching tokens (type product/part/modification/brand)
        const { data: tagRows } = await supabase
          .from('image_tags')
          .select('image_id, text, type')
          .eq('vehicle_id', vehicleId)
          .in('type', ['product','part','modification','brand']);
        const wanted = new Set<string>();
        (tagRows || []).forEach(tr => {
          const t = (tr as any).text?.toLowerCase() || '';
          if (tokens.some(tok => t.includes(tok))) wanted.add((tr as any).image_id);
        });
        let imgs: ImgRow[] = [];
        if (wanted.size > 0) {
          const idList = Array.from(wanted);
          const { data: imgRows } = await supabase
            .from('vehicle_images')
            .select('id, image_url, taken_at, created_at')
            .in('id', idList)
            .eq('vehicle_id', vehicleId)
            .order('taken_at', { ascending: true });
          imgs = (imgRows || []) as any;
        }
        setImages(imgs);

        // 2) Find receipts and matching line items by token match
        const { data: recs } = await supabase
          .from('receipts')
          .select('id, vendor_name, receipt_date, total, raw_json, source_document_id')
          .eq('scope_type', 'vehicle')
          .eq('scope_id', vehicleId)
          .order('receipt_date', { ascending: true });
        const rows: RecRow[] = [];
        for (const r of (recs || []) as any[]) {
          // match items from raw_json or a separate receipt_items join if present
          let items: any[] = []; let matched: any = null;
          if (r.raw_json?.items) items = r.raw_json.items;
          if (items.length === 0) {
            const { data: its } = await supabase.from('receipt_items').select('*').eq('receipt_id', r.id);
            items = its || [];
          }
          for (const it of items) {
            const text = `${it.description || ''} ${it.part_number || ''}`.toLowerCase();
            if (tokens.some(tok => text.includes(tok))) { matched = it; break; }
          }
          if (matched) {
            let fileUrl: string | null = null;
            if (r.source_document_id) {
              const { data: doc } = await supabase.from('vehicle_documents').select('file_url').eq('id', r.source_document_id).single();
              fileUrl = doc?.file_url || null;
            }
            rows.push({ ...r, file_url: fileUrl, matched_item: matched });
          }
        }
        setReceipts(rows);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, vehicleId, partName]);

  const installDate = useMemo(() => {
    const recDate = receipts.length ? receipts[0].receipt_date : null;
    if (images.length) return images[0].taken_at || images[0].created_at;
    return recDate || null;
  }, [images, receipts]);

  const latestImage = images.length ? images[images.length - 1] : null;

  if (!open) return null;
  return (
    <div className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.6)', zIndex: 10000 }} onClick={onClose}>
      <div className="bg-white border rounded shadow-xl" style={{ position: 'absolute', inset: '6% 6% auto 6%', padding: 8 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>
          <div className="text font-bold" style={{ fontSize: '10pt' }}>{partName} — Evidence</div>
          <button className="button button-small" onClick={onClose}>Close</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12, padding: 8, maxHeight: '70vh', overflow: 'auto' }}>
          <div>
            <div className="text font-bold" style={{ marginBottom: 6 }}>Images ({images.length})</div>
            {images.length === 0 ? (
              <div className="text-small text-muted">No specific images found. Add close-ups and tag them.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                {images.map(img => (
                  <a key={img.id} href={img.image_url} target="_blank" rel="noreferrer" style={{ display: 'block', border: '1px solid var(--border-light)' }}>
                    <img src={img.image_url} style={{ width: '100%', height: 100, objectFit: 'cover' }} />
                    <div className="text-small" style={{ padding: 4 }}>{(img.taken_at || img.created_at || '').toString().slice(0, 10)}</div>
                  </a>
                ))}
              </div>
            )}
            <div className="text-small" style={{ marginTop: 8 }}>
              <strong>Installed:</strong> {installDate ? new Date(installDate).toLocaleDateString() : 'Unknown'}
              {latestImage && (
                <> • <strong>Latest photo:</strong> {new Date(latestImage.taken_at || latestImage.created_at).toLocaleDateString()}</>
              )}
            </div>
          </div>
          <div>
            <div className="text font-bold" style={{ marginBottom: 6 }}>Receipts ({receipts.length})</div>
            {receipts.length === 0 ? (
              <div className="text-small text-muted">No matching receipt items.</div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {receipts.map(r => (
                  <div key={r.id} className="border rounded" style={{ padding: 8 }}>
                    <div className="text-small"><strong>{r.vendor_name || 'Vendor'}</strong> • {r.receipt_date || '—'} • {typeof r.total === 'number' ? `$${r.total.toFixed(2)}` : '—'}</div>
                    {r.matched_item && (
                      <div className="text-small text-muted" style={{ marginTop: 4 }}>{r.matched_item.description || ''}</div>
                    )}
                    {r.file_url && (
                      <div style={{ marginTop: 6 }}>
                        <button className="button button-small" onClick={() => setEvidence({ url: r.file_url || '', ocr: r.raw_json?.ocr || r.raw_json, match: (r.matched_item?.total_price ?? r.total)?.toFixed ? (r.matched_item.total_price as number).toFixed(2) : (r.total ? r.total.toFixed(2) : '') })}>
                          View Evidence
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {evidence && (
        <ReceiptEvidenceViewer open={!!evidence} onClose={() => setEvidence(null)} fileUrl={evidence.url} ocr={evidence.ocr} matchText={evidence.match} />
      )}
    </div>
  );
};

export default PartEvidenceModal;


