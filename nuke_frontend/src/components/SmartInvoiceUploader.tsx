import React, { useCallback, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { receiptExtractionService } from '../services/receiptExtractionService';
import { receiptPersistService } from '../services/receiptPersistService';
import { ValuationEngine as VehicleValuationService } from '../services/valuationEngine';
import type { ParsedReceipt } from '../services/receiptExtractionService';
import { formatSupabaseInvokeError } from '../utils/formatSupabaseInvokeError';

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

type DocCategory = 'receipt' | 'invoice' | 'title' | 'registration' | 'insurance' | 'service_record' | 'parts_order' | 'warranty' | 'manual';

/**
 * Smart Invoice Uploader - REBUILT
 * 
 * Clean, single upload zone for all documents
 * AI-powered parsing (Azure → OpenAI → Tesseract)
 * Category selection → Upload → Parse → Save
 */
export const SmartInvoiceUploader: React.FC<SmartInvoiceUploaderProps> = ({ vehicleId, onClose, onSaved }) => {
  const [category, setCategory] = useState<DocCategory>('receipt');
  const [doc, setDoc] = useState<UploadableDoc | null>(null);
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [status, setStatus] = useState<'idle'|'uploading'|'parsing'|'preview'|'saving'|'success'|'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const [valueDelta, setValueDelta] = useState<{ delta: number; newValue: number; confidence: number } | null>(null);

  const categories: { id: DocCategory; label: string; icon: string; desc: string }[] = [
    { id: 'receipt', label: 'Receipt', icon: '🧾', desc: 'Purchase receipts for parts/services' },
    { id: 'invoice', label: 'Invoice', icon: '📄', desc: 'Service invoices and bills' },
    { id: 'service_record', label: 'Service Record', icon: '🔧', desc: 'Maintenance and repair logs' },
    { id: 'title', label: 'Title', icon: '📜', desc: 'Vehicle title document' },
    { id: 'registration', label: 'Registration', icon: '🪪', desc: 'Current registration' },
    { id: 'insurance', label: 'Insurance', icon: '🛡️', desc: 'Insurance card/policy' },
    { id: 'warranty', label: 'Warranty', icon: '✅', desc: 'Warranty certificates' },
    { id: 'manual', label: 'Manual/Guide', icon: '📖', desc: 'Owner/service manuals' },
  ];

  const onDropFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const file = arr[0];
    
    // Auto-parse receipts/invoices
    const shouldAutoParse = category === 'receipt' || category === 'invoice' || category === 'service_record';
    
    setDoc({ 
      id: Math.random().toString(36).slice(2), 
      file, 
      type: 'file', 
      fileName: file.name, 
      mimeType: file.type 
    });
    setParsed(null);
    setStatus('idle');
    setMessage('');
    
    if (shouldAutoParse) {
      // Auto-trigger parse after short delay
      setTimeout(() => triggerParse(file), 300);
    }
  }, [category]);

  const triggerParse = async (file: File) => {
    setStatus('uploading');
    setMessage('Uploading...');
    
    try {
      // Upload to storage first
      const prepared = await uploadToStorage(file, file.name, file.type);
      setDoc(prev => prev ? { ...prev, prepared } : prev);
      
      // Start parsing
      await runParse(prepared, file.type);
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Upload failed');
    }
  };

  const uploadToStorage = async (blob: Blob, name: string, mimeType: string): Promise<{ filePath: string; publicUrl: string }> => {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error('Authentication required');
    
    const ext = name.split('.').pop() || 'bin';
    const filePath = `${vehicleId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(filePath, blob, { contentType: mimeType, upsert: false });
    
    if (uploadError) throw uploadError;
    
    const { data: { publicUrl } } = supabase.storage.from('documents').getPublicUrl(filePath);
    return { filePath, publicUrl };
  };

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
      const amounts = text.matchAll(/\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/g);
      for (const m of amounts) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
          if (!total || val > total) total = val;
        }
      }
      return { subtotal, tax, total };
    };
    const { subtotal, tax, total } = getTotals();
    return {
      vendor_name: lines[0] || 'Unknown Vendor',
      receipt_date: getDate(),
      invoice_number: getInvoiceNumber(),
      subtotal,
      tax,
      total,
      items: []
    };
  };

  const runParse = async (prepared: { filePath: string; publicUrl: string }, mimeType: string) => {
    try {
      setStatus('parsing');
      setMessage('Parsing with AI...');
      const tasks: Promise<ParsedReceipt | undefined>[] = [];
      
      // 1. Try Azure Form Recognizer (fast, structured)
      tasks.push(receiptExtractionService.extract({ url: prepared.publicUrl, mimeType: mimeType || 'application/octet-stream' }).catch(() => undefined));

      // 2. For PDFs: Try OpenAI Vision (best for scanned documents/appraisals)
      if (mimeType && /application\/pdf/.test(mimeType)) {
        setMessage('Analyzing PDF with GPT-4 Vision...');
        tasks.push((async () => {
          try {
            // Convert first page of PDF to image
            const pdfjs = await import('pdfjs-dist');
            pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
            const pdf = await pdfjs.getDocument(prepared.publicUrl).promise;
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d')!;
            await page.render({ canvasContext: ctx, viewport }).promise;
            const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);

            // Send to OpenAI Vision
            const openaiKey = import.meta.env.VITE_OPENAI_API_KEY;
            if (!openaiKey) throw new Error('OpenAI API key not configured');
            
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiKey}`
              },
              body: JSON.stringify({
                model: 'gpt-4-vision-preview',
                messages: [{
                  role: 'user',
                  content: [
                    { type: 'text', text: 'Extract receipt/invoice data from this document. Return JSON with: vendor_name, receipt_date (YYYY-MM-DD), total, tax, subtotal, items (array of {description, quantity, unit_price, total_price}). For appraisals, treat appraised value as total.' },
                    { type: 'image_url', image_url: { url: imageDataUrl } }
                  ]
                }],
                max_tokens: 1000
              })
            });

            if (!response.ok) throw new Error('OpenAI Vision failed');
            const result = await response.json();
            const content = result.choices?.[0]?.message?.content || '';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              return parsed as ParsedReceipt;
            }
          } catch (err) {
            console.warn('PDF Vision parse failed:', err);
          }
          return undefined;
        })());
      }

      // 3. For images: Try Tesseract OCR
      if (mimeType && /image\//.test(mimeType)) {
        setMessage('Running OCR...');
        const Tesseract = (await import('tesseract.js')).default as any;
        try { if (Tesseract.setLogging) Tesseract.setLogging(false); } catch {}
        const ocrSrc = await prepareOcrImage(prepared.publicUrl);
        const result = await Tesseract.recognize(ocrSrc, 'eng', { logger: () => {}, tessedit_pageseg_mode: 6 });
        const text: string = String(result?.data?.text || '');
        tasks.push(Promise.resolve(parseTextToReceipt(text)));
      }

      const results = await Promise.all(tasks);
      const best = results.find(Boolean) as ParsedReceipt | undefined;
      if (!best) throw new Error('Unable to parse. Try a clearer image or different format.');
      setParsed(best);
      setStatus('preview');
      setMessage('Review and save');
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Parsing failed');
      console.error('Parse error:', e);
    }
  };

  const saveAll = async () => {
    if (!doc?.prepared || !parsed) return;
    try {
      setStatus('saving');
      setMessage('Saving...');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication required');

      // Get valuation before
      const before = await VehicleValuationService.calculateValuation(vehicleId);

      // Save to vehicle_documents
      const { data: docData, error: dbError } = await supabase
        .from('vehicle_documents')
        .insert({
          vehicle_id: vehicleId,
          uploaded_by: user.id,
          document_type: category,
          title: doc.fileName || category.charAt(0).toUpperCase() + category.slice(1),
          description: parsed.vendor_name || category,
          document_date: parsed.receipt_date || null,
          file_url: doc.prepared.publicUrl,
          file_name: doc.fileName || 'document',
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

      // Trigger smart-receipt-linker for AI extraction & image linking
      try {
        await supabase.functions.invoke('smart-receipt-linker', {
          body: {
            documentId: (docData as any).id,
            vehicleId,
            documentUrl: doc.prepared.publicUrl
          }
        });
        console.log('[SmartInvoiceUploader] Triggered smart-receipt-linker for document', (docData as any).id);
      } catch (linkerError) {
        console.warn('[SmartInvoiceUploader] smart-receipt-linker failed (non-fatal):', linkerError);
        // Non-fatal: continue with document save even if linker fails
      }

      // Create timeline event (now without circular dependency)
      const { data: eventData, error: eventError } = await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: vehicleId,
          user_id: user.id,
          event_type: category === 'service_record' ? 'maintenance' : 'purchase',
          event_category: 'maintenance',
          title: `${category === 'receipt' ? 'Receipt' : category === 'invoice' ? 'Invoice' : 'Service Record'}: ${parsed.vendor_name || 'Document'}`,
          description: `${parsed.items?.length || 0} items for ${parsed.total ? `$${parsed.total}` : 'unknown amount'}`,
          event_date: parsed.receipt_date || new Date().toISOString().split('T')[0],
          source_type: 'receipt',
          receipt_amount: typeof parsed.total === 'number' ? parsed.total : null,
          receipt_currency: 'USD',
          affects_value: true,
          metadata: {
            document_id: (docData as any).id,
            vendor: parsed.vendor_name,
            item_count: parsed.items?.length || 0
          }
        })
        .select()
        .single();

      if (!eventError && eventData) {
        // Link document to timeline event (no more circular dependency!)
        await supabase.from('timeline_event_documents').insert({
          event_id: eventData.id,
          document_id: (docData as any).id
        });
      }

      // Trigger expert agent for AI-powered valuation (replaces legacy calculation)
      setStatus('analyzing');
      setMessage('Running AI valuation...');
      
      try {
        const { data: expertResult, error: expertError } = await supabase.functions.invoke('vehicle-expert-agent', {
          body: { vehicleId }
        });

        if (!expertError && expertResult) {
          const newValue = expertResult.estimatedTotalValue || 0;
          setValueDelta({ 
            delta: Math.round(newValue - (before.estimatedValue || 0)), 
            newValue: Math.round(newValue), 
            confidence: Math.round(expertResult.confidence || 0) 
          });
        } else {
          if (expertError) {
            console.warn('Expert agent failed:', await formatSupabaseInvokeError(expertError));
          } else {
            console.warn('Expert agent failed, using legacy calculation as fallback');
          }
          VehicleValuationService.clearCache(vehicleId);
          const after = await VehicleValuationService.calculateValuation(vehicleId);
          setValueDelta({ 
            delta: Math.round((after.estimatedValue || 0) - (before.estimatedValue || 0)), 
            newValue: Math.round(after.estimatedValue || 0), 
            confidence: Math.round(after.confidence || 0) 
          });
        }
      } catch (expertErr) {
        console.error('Expert agent error:', expertErr);
        // Fallback to legacy
        VehicleValuationService.clearCache(vehicleId);
        const after = await VehicleValuationService.calculateValuation(vehicleId);
        setValueDelta({ 
          delta: Math.round((after.estimatedValue || 0) - (before.estimatedValue || 0)), 
          newValue: Math.round(after.estimatedValue || 0), 
          confidence: Math.round(after.confidence || 0) 
        });
      }

      setStatus('success');
      setMessage('✅ Saved & Analyzed!');

      try { window.dispatchEvent(new CustomEvent('valuation_updated', { detail: { vehicleId } } as any)); } catch {}
      onSaved?.({ receiptId: saved.receiptId });
      setTimeout(() => onClose?.(), 1500);
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Save failed');
    }
  };

  // Render as fullscreen modal overlay
  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 'var(--space-3)'
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div 
        className="card" 
        style={{ 
          maxWidth: '600px', 
          width: '100%', 
          maxHeight: '90vh', 
          overflow: 'auto',
          background: 'var(--surface)',
          border: '2px solid var(--border)'
        }}
      >
        {/* Header */}
        <div 
          className="card-header" 
          style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            padding: 'var(--space-3)',
            borderBottom: '2px solid var(--border)',
            position: 'sticky',
            top: 0,
            background: 'var(--surface)',
            zIndex: 1
          }}
        >
          <div style={{ fontSize: '11pt', fontWeight: 'bold' }}>📄 Upload Document</div>
          <button 
            className="button button-small" 
            onClick={onClose}
            style={{ fontSize: '14pt', padding: '4px 8px' }}
          >
            ×
          </button>
        </div>

        <div className="card-body" style={{ padding: 'var(--space-3)', display: 'grid', gap: 'var(--space-3)' }}>
          {/* Step 1: Category Selection */}
          {!doc && (
            <div>
              <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                1. Select Document Type
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-2)' }}>
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setCategory(cat.id)}
                    style={{
                      padding: 'var(--space-2)',
                      border: `2px solid ${category === cat.id ? 'var(--accent)' : 'var(--border)'}`,
                      background: category === cat.id ? 'var(--accent-light)' : 'var(--surface-hover)',
                      borderRadius: '2px',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.12s ease'
                    }}
                  >
                    <div style={{ fontSize: '16pt' }}>{cat.icon}</div>
                    <div style={{ fontSize: '8pt', fontWeight: 'bold', marginTop: '4px' }}>{cat.label}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Upload */}
          {!doc && (
            <div>
              <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                2. Upload File
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onDragLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-medium)'; }}
                onDrop={(e) => { 
                  e.preventDefault(); 
                  e.currentTarget.style.borderColor = 'var(--border-medium)';
                  if (e.dataTransfer.files?.length) onDropFiles(e.dataTransfer.files); 
                }}
                style={{ 
                  border: '2px dashed var(--border-medium)', 
                  background: 'var(--grey-50)', 
                  padding: 'var(--space-5)', 
                  textAlign: 'center',
                  borderRadius: '2px',
                  transition: 'border-color 0.12s ease'
                }}
              >
                <div style={{ fontSize: '32pt', marginBottom: 'var(--space-2)', opacity: 0.5 }}>📎</div>
                <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
                  Drag & drop here
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
                  PDF, JPG, PNG, WebP (max 10MB)
                </div>
                <input 
                  type="file" 
                  accept=".pdf,.jpg,.jpeg,.png,.webp" 
                  onChange={(e) => e.target.files && onDropFiles(e.target.files)}
                  style={{
                    padding: '8px 12px',
                    fontSize: '8pt',
                    border: '2px solid var(--border)',
                    background: 'var(--surface)',
                    borderRadius: '2px',
                    cursor: 'pointer'
                  }}
                />
              </div>
            </div>
          )}

          {/* Step 3: Processing/Preview */}
          {doc && (
            <div>
              <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                {status === 'preview' ? '3. Review & Save' : '3. Processing...'}
              </div>
              
              {/* Doc Info */}
              <div className="card" style={{ padding: 'var(--space-2)', background: 'var(--grey-50)', marginBottom: 'var(--space-2)' }}>
                <div style={{ fontSize: '8pt', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{doc.fileName}</strong>
                    {doc.mimeType && <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>({doc.mimeType})</span>}
                  </div>
                  <button className="button button-small" onClick={() => { setDoc(null); setParsed(null); setStatus('idle'); }}>
                    Change
                  </button>
                </div>
              </div>

              {/* Status */}
              {(status === 'uploading' || status === 'parsing') && (
                <div style={{ padding: 'var(--space-3)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '8pt' }}>
                  <div style={{ marginBottom: 'var(--space-2)' }}>{message}</div>
                  <div style={{ width: '100%', height: '4px', background: 'var(--grey-200)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: '60%', background: 'var(--accent)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  </div>
                </div>
              )}

              {/* Preview */}
              {parsed && status === 'preview' && (
                <div className="card" style={{ padding: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                  <div style={{ fontSize: '8pt', marginBottom: 'var(--space-2)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                      <div>
                        <strong>Vendor:</strong> {parsed.vendor_name || '—'}
                      </div>
                      <div>
                        <strong>Date:</strong> {parsed.receipt_date || '—'}
                      </div>
                      <div>
                        <strong>Total:</strong> {typeof parsed.total === 'number' ? `$${parsed.total.toFixed(2)}` : '—'}
                      </div>
                      <div>
                        <strong>Items:</strong> {parsed.items?.length || 0}
                      </div>
                    </div>
                  </div>
                  {parsed.items && parsed.items.length > 0 && (
                    <div style={{ maxHeight: '150px', overflow: 'auto', fontSize: '7pt', border: '1px solid var(--border)', padding: 'var(--space-1)' }}>
                      {parsed.items.map((item: any, i: number) => (
                        <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--border-light)' }}>
                          {item.description} {item.quantity && `× ${item.quantity}`} {item.total_price && `— $${item.total_price.toFixed(2)}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {status === 'error' && (
                <div style={{ padding: 'var(--space-2)', background: '#fee', border: '1px solid #fcc', borderRadius: '2px', fontSize: '8pt', color: '#c00' }}>
                  ❌ {message}
                </div>
              )}

              {/* Success */}
              {status === 'success' && valueDelta && (
                <div style={{ padding: 'var(--space-2)', background: '#efe', border: '1px solid #cfc', borderRadius: '2px', fontSize: '8pt' }}>
                  ✅ Saved! Value updated: <strong>{valueDelta.delta >= 0 ? '+' : ''}${valueDelta.delta.toLocaleString()}</strong> → ${valueDelta.newValue.toLocaleString()} ({valueDelta.confidence}% confidence)
                </div>
              )}

              {/* Actions */}
              {status === 'preview' && (
                <button 
                  className="button button-primary" 
                  onClick={saveAll}
                  style={{ width: '100%', padding: 'var(--space-2)', fontSize: '9pt', fontWeight: 'bold' }}
                >
                  💾 Save Document
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SmartInvoiceUploader;
