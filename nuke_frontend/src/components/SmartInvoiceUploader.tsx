import React, { useCallback, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { receiptExtractionService } from '../services/receiptExtractionService';
import { receiptPersistService } from '../services/receiptPersistService';
import type { ParsedReceipt } from '../services/receiptExtractionService';

interface SmartInvoiceUploaderProps {
  vehicleId: string;
  onClose?: () => void;
  onSaved?: (result: { receiptId?: string }) => void;
}

interface UploadableDoc {
  id: string;
  file?: File;
  text?: string;
  type: 'file' | 'text';
  fileName?: string;
  mimeType?: string;
  prepared?: { filePath: string; publicUrl: string };
}

export const SmartInvoiceUploader: React.FC<SmartInvoiceUploaderProps> = ({ vehicleId, onClose, onSaved }) => {
  const [doc, setDoc] = useState<UploadableDoc | null>(null);
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [status, setStatus] = useState<'idle'|'uploading'|'parsing'|'preview'|'saving'|'success'|'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const [toast, setToast] = useState<string | null>(null);
  const [valueDelta, setValueDelta] = useState<{ delta: number; newValue: number; confidence: number } | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const onDropFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files as any);
    if (arr.length === 0) return;
    const file = arr[0];
    setDoc({ id: Math.random().toString(36).slice(2), file, type: 'file', fileName: file.name, mimeType: file.type });
    setParsed(null);
    setStatus('idle');
    setMessage('');
  }, []);

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    if (text && text.trim().length > 0) {
      setDoc({ id: Math.random().toString(36).slice(2), text, type: 'text', fileName: 'invoice.txt', mimeType: 'text/plain' });
      setParsed(null);
      setStatus('idle');
      setMessage('');
    }
  }, []);

  const prepareOcrImage = async (src: string): Promise<string> => {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = src;
      });
      const minWidth = 600;
      if (img.width >= minWidth) return src;
      const scale = Math.ceil(minWidth / Math.max(1, img.width));
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return src;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high' as any;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.92);
    } catch {
      return src;
    }
  };

  const parseTextToReceipt = (text: string): ParsedReceipt => {
    const lines = text.split(/\r?\n/).map(l => l.replace(/[\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
    const getDate = () => {
      const m = text.match(/(\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b)/);
      if (m) return m[1];
      const m2 = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s*\d{2,4}\b/i);
      if (m2) return m2[0];
      return undefined;
    };
    const getInvoiceNumber = () => {
      for (const l of lines) {
        const m = l.match(/invoice\s*number\s*[:#]?\s*([A-Za-z0-9-]+)/i);
        if (m) return m[1];
      }
      return undefined;
    };
    const getTotals = () => {
      let subtotal: number | undefined;
      let tax: number | undefined;
      let total: number | undefined;
      const money = (str: string) => {
        const m = str.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/);
        return m ? Number(m[1].replace(/,/g, '')) : undefined;
      };
      for (const l of lines.slice(-30)) {
        const lower = l.toLowerCase();
        if (lower.includes('subtotal')) subtotal = money(l) ?? subtotal;
        if (lower.includes('tax')) tax = money(l) ?? tax;
        if (/(total due|total paid|amount due|total)/i.test(l)) total = money(l) ?? total;
      }
      if (total === undefined) {
        const all = text.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/g);
        if (all && all.length) total = Number(all[all.length - 1].replace(/[^0-9.]/g, ''));
      }
      return { subtotal, tax, total };
    };
    const items: any[] = [];
    const isTotalLike = (l: string) => /(subtotal|shipping|tax|total due|total paid|amount due|payment methods|store credit balance)/i.test(l);
    const itemReA = /^([A-Z0-9-]{2,})\s+(.*?)(?:\s+(\d+(?:\.[0-9]+)?))\s+\$?([0-9]+\.[0-9]{2})(?:\s+\$?([0-9]+\.[0-9]{2}))?$/i;
    for (const l of lines) {
      if (isTotalLike(l)) continue;
      const m = l.match(itemReA);
      if (m) {
        const [_, part, desc, qtyStr, p1, p2] = m;
        items.push({
          line_number: items.length + 1,
          part_number: part,
          description: desc.trim(),
          quantity: Number(qtyStr),
          unit_price: p2 ? Number(p1) : undefined,
          total_price: Number(p2 || p1)
        });
      }
    }
    if (items.length === 0) {
      lines.forEach((l) => {
        if (isTotalLike(l)) return;
        const m = l.match(/(.+?)\s+\$?([0-9]+\.[0-9]{2})\s*$/);
        if (m && /(\s|^)\d+(?:\.\d+)?(\s|$)/.test(l)) {
          items.push({ line_number: items.length + 1, description: m[1].trim(), total_price: Number(m[2]) });
        }
      });
    }
    const { subtotal, tax, total } = getTotals();
    const vendor = (() => {
      const head = lines.slice(0, 12).join(' ').toLowerCase();
      if (/autozone/.test(head)) return 'AutoZone';
      if (/o\'?reilly|oreilly/.test(head)) return "O'Reilly Auto Parts";
      if (/advance auto/.test(head)) return 'Advance Auto Parts';
      if (/napa/.test(head)) return 'NAPA Auto Parts';
      return undefined;
    })();
    const parsed: any = {
      vendor_name: vendor,
      receipt_date: getDate(),
      subtotal,
      tax,
      total,
      invoice_number: getInvoiceNumber(),
      items,
      raw_json: { ocr: 'manual_paste', text }
    };
    return parsed;
  };

  const uploadToStorage = async (blob: Blob, name: string, mimeType: string) => {
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${Date.now()}_${safeName}`;
    const filePath = `vehicles/${vehicleId}/documents/${fileName}`;
    const { error } = await supabase.storage.from('vehicle-data').upload(filePath, blob, { contentType: mimeType, upsert: false });
    if (error) throw error;
    const { data: urlData } = supabase.storage.from('vehicle-data').getPublicUrl(filePath);
    return { filePath, publicUrl: urlData?.publicUrl as string };
  };

  const runParse = async () => {
    if (!doc) return;
    try {
      setStatus('uploading');
      setMessage('Uploading...');
      let prepared = doc.prepared;
      if (!prepared) {
        if (doc.type === 'file' && doc.file) {
          prepared = await uploadToStorage(doc.file, doc.file.name, doc.file.type);
        } else {
          const blob = new Blob([doc.text || ''], { type: 'text/plain' });
          prepared = await uploadToStorage(blob, doc.fileName || 'invoice.txt', 'text/plain');
        }
      }

      setStatus('parsing');
      setMessage('Parsing invoice...');
      const tasks: Promise<ParsedReceipt | undefined>[] = [];
      // Cloud extractor (Claude-backed server function)
      tasks.push(receiptExtractionService.extract({ url: prepared.publicUrl, mimeType: doc.mimeType || 'application/octet-stream' }).catch(() => undefined));

      // OCR if image
      if (doc.mimeType && /image\//.test(doc.mimeType)) {
        const Tesseract = (await import('tesseract.js')).default as any;
        try { if (Tesseract.setLogging) Tesseract.setLogging(false); } catch {}
        const ocrSrc = await prepareOcrImage(prepared.publicUrl);
        const result = await Tesseract.recognize(ocrSrc, 'eng', { logger: () => {}, tessedit_pageseg_mode: 6 });
        const text: string = String(result?.data?.text || '');
        tasks.push(Promise.resolve(parseTextToReceipt(text)));
      }

      // Text paste
      if (doc.type === 'text' && doc.text) {
        tasks.push(Promise.resolve(parseTextToReceipt(doc.text)));
      }

      const results = await Promise.all(tasks);
      const best = results.find(Boolean) as ParsedReceipt | undefined;
      if (!best) throw new Error('Unable to parse invoice');
      setParsed(best);
      setDoc(prev => prev ? { ...prev, prepared } : prev);
      setStatus('preview');
      setMessage('Preview and confirm');
      showToast('Invoice parsed');
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Failed to parse');
    }
  };

  const saveAll = async () => {
    if (!doc || !parsed || !doc.prepared) return;
    try {
      setStatus('saving');
      setMessage('Saving...');

      // Build before/after valuation for delta toast
      const { VehicleValuationService } = await import('../services/vehicleValuationService');
      const before = await VehicleValuationService.getValuation(vehicleId);

      // Create vehicle_documents row
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: docData, error: dbError } = await supabase
        .from('vehicle_documents')
        .insert({
          vehicle_id: vehicleId,
          uploaded_by: user.id,
          document_type: 'receipt',
          title: doc.fileName || 'Receipt',
          description: parsed.vendor_name || 'Receipt',
          document_date: parsed.receipt_date || null,
          file_url: doc.prepared.publicUrl,
          file_name: doc.fileName || 'receipt',
          file_type: doc.mimeType || 'application/octet-stream',
          file_size: doc.file?.size || null,
          privacy_level: 'owner_only',
          contains_pii: true,
          vendor_name: parsed.vendor_name || null,
          amount: typeof parsed.total === 'number' ? parsed.total : null,
          currency: 'USD'
        })
        .select()
        .single();
      if (dbError) throw dbError;

      // Persist receipts + items
      const saved = await receiptPersistService.saveForVehicleDoc({ vehicleId, documentId: (docData as any).id, parsed });
      if (saved.error) throw new Error(saved.error);

      // Recalculate valuation
      VehicleValuationService.clearCache(vehicleId);
      const after = await VehicleValuationService.getValuation(vehicleId);
      setValueDelta({ delta: Math.round((after.estimatedValue || 0) - (before.estimatedValue || 0)), newValue: Math.round(after.estimatedValue || 0), confidence: Math.round(after.confidence || 0) });

      setStatus('success');
      setMessage('Saved');
      showToast(`Vehicle value updated: ${after.estimatedValue >= before.estimatedValue ? '+' : ''}$${Math.round((after.estimatedValue - before.estimatedValue)).toLocaleString()} (Confidence: ${Math.round(after.confidence)}%)`);

      try { window.dispatchEvent(new CustomEvent('valuation_updated', { detail: { vehicleId } } as any)); } catch {}
      onSaved?.({ receiptId: saved.receiptId });
      setTimeout(() => onClose?.(), 1200);
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Failed to save');
    }
  };

  const canParse = !!doc && status !== 'uploading' && status !== 'parsing' && status !== 'saving';
  const canSave = !!parsed && !!doc?.prepared && status === 'preview';

  return (
    <div className="card" style={{ padding: 'var(--space-3)' }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="text font-bold">Smart Invoice Uploader</div>
        {onClose && (
          <button className="button button-small" onClick={onClose}>×</button>
        )}
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        {/* Input zone */}
        {!doc && (
          <div
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) onDropFiles(e.dataTransfer.files); }}
            style={{ border: '2px dashed var(--border-medium)', background: 'var(--grey-50)', padding: 'var(--space-5)', textAlign: 'center' }}
          >
            <div className="text" style={{ marginBottom: 'var(--space-2)' }}>Drag & drop invoice image or PDF here</div>
            <div className="text-small" style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>or paste text below</div>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => e.target.files && onDropFiles(e.target.files)} />
            <textarea placeholder="Paste invoice text here..." onPaste={onPaste} className="form-input" style={{ marginTop: 'var(--space-3)', width: '100%', height: 120 }} />
          </div>
        )}

        {/* Doc summary */}
        {doc && (
          <div className="card" style={{ padding: 'var(--space-2)' }}>
            <div className="text-small" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>Document: <strong>{doc.fileName}</strong> {doc.mimeType && <span style={{ color: 'var(--text-muted)' }}>({doc.mimeType})</span>}</div>
              <button className="button button-small" onClick={() => setDoc(null)}>Change</button>
            </div>
            <div style={{ marginTop: 'var(--space-2)', display: 'flex', gap: 'var(--space-2)' }}>
              <button className="button" disabled={!canParse} onClick={runParse}>Parse</button>
              <button className="button button-secondary" disabled={!canSave} onClick={saveAll}>Save</button>
              {status !== 'idle' && <div className="text-small" style={{ color: 'var(--text-muted)' }}>{status.toUpperCase()} {message && `• ${message}`}</div>}
            </div>
          </div>
        )}

        {/* Preview */}
        {parsed && (
          <div className="card" style={{ padding: 'var(--space-2)' }}>
            <div className="text font-bold" style={{ marginBottom: 8 }}>Preview</div>
            <div className="text-small" style={{ marginBottom: 8, color: 'var(--text-muted)' }}>
              Vendor: <strong>{parsed.vendor_name || '—'}</strong> • Date: <strong>{parsed.receipt_date || '—'}</strong> • Total: <strong>{typeof parsed.total === 'number' ? `$${parsed.total.toFixed(2)}` : '—'}</strong>
            </div>
            <div className="text-small" style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border-light)', padding: 6 }}>
              {(parsed.items || []).map((it: any, i: number) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, borderBottom: '1px solid var(--border-light)', padding: '4px 0' }}>
                  <div>{it.description || '—'}</div>
                  <div>{it.part_number || it.vendor_sku || '—'}</div>
                  <div>{typeof it.quantity === 'number' ? it.quantity : '—'}</div>
                  <div>{typeof it.total_price === 'number' ? `$${it.total_price.toFixed(2)}` : '—'}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Value Delta */}
        {valueDelta && (
          <div className="card" style={{ padding: 'var(--space-2)' }}>
            <div className="text-small">
              Vehicle value updated: <strong>{valueDelta.delta >= 0 ? '+' : ''}${valueDelta.delta.toLocaleString()}</strong>
              {' '}→ <strong>${valueDelta.newValue.toLocaleString()}</strong> ({valueDelta.confidence}% confidence)
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className="card" style={{ position: 'fixed', top: 16, right: 16, padding: '6px 8px', fontSize: 12 }}>
          {toast}
        </div>
      )}
    </div>
  );
};

export default SmartInvoiceUploader;
