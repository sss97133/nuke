import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { receiptExtractionService } from '../services/receiptExtractionService';
import { receiptPersistService } from '../services/receiptPersistService';
import {
  ArrowUpOnSquareIcon,
  ShieldCheckIcon,
  LockClosedIcon,
  EyeIcon,
  TrashIcon,
  TagIcon,
  CurrencyDollarIcon,
  CalendarIcon
} from '@heroicons/react/24/outline';

type DocumentCategory =
  | 'receipt'
  | 'invoice'
  | 'title'
  | 'registration'
  | 'insurance'
  | 'service_record'
  | 'parts_order'
  | 'shipping_document'
  | 'legal_document'
  | 'other';

type DocumentPrivacy = 'public' | 'owner_only' | 'restricted';

interface VehicleDocument {
  id: string;
  vehicle_id: string;
  document_type: DocumentCategory;
  title: string;
  description?: string | null;
  document_date?: string | null;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size?: number | null;
  privacy_level: DocumentPrivacy;
  contains_pii: boolean;
  pii_redacted_url?: string | null;
  extracted_data?: any;
  vendor_name?: string | null;
  amount?: number | null;
  currency?: string | null;
  parts_ordered?: string[] | null;
  service_performed?: string | null;
  timeline_event_created: boolean;
  timeline_event_id?: string | null;
  uploaded_by?: string | null;
  created_at: string;
}

interface Props {
  vehicleId: string;
  isOwner: boolean;
  hasContributorAccess?: boolean;
}

const allowedMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
];

const categoryOptions: { value: DocumentCategory; label: string }[] = [
  { value: 'receipt', label: 'Receipt' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'title', label: 'Title' },
  { value: 'registration', label: 'Registration' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'service_record', label: 'Service Record' },
  { value: 'parts_order', label: 'Parts Order' },
  { value: 'shipping_document', label: 'Shipping Document' },
  { value: 'legal_document', label: 'Legal Document' },
  { value: 'other', label: 'Other' }
];

const VehicleDocumentManager: React.FC<Props> = ({ vehicleId, isOwner, hasContributorAccess = false }) => {
  const [docs, setDocs] = useState<VehicleDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Auto-extraction is always on for receipts/invoices
  const [attachState, setAttachState] = useState<{ open: boolean; doc?: VehicleDocument | null; fieldName: string; fieldValue: string }>(
    { open: false, doc: null, fieldName: '', fieldValue: '' }
  );

  // Debug access permissions (removed noisy log - causes console spam)
  // console.log('VehicleDocumentManager access:', { isOwner, hasContributorAccess, canAccess: isOwner || hasContributorAccess });

  const [form, setForm] = useState({
    privacy_level: 'owner_only' as DocumentPrivacy
  });

  useEffect(() => {
    loadDocuments();
  }, [vehicleId]);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('vehicle_documents')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setDocs((data as unknown as VehicleDocument[]) || []);
    } catch (e) {
      console.error('Error loading documents:', e);
    } finally {
      setLoading(false);
    }
  };

  const onPickFile = () => fileInputRef.current?.click();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id || null;
      for (const file of files) {
        if (!allowedMimeTypes.includes(file.type)) {
          console.warn('Skipping unsupported file type:', file.name);
          continue;
        }
        const ts = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `vehicles/${vehicleId}/documents/${ts}_${safeName}`;

        const { error: upErr } = await supabase.storage
          .from('vehicle-data')
          .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;

        const { data: pub } = supabase.storage
          .from('vehicle-data')
          .getPublicUrl(storagePath);

        const payload: any = {
          vehicle_id: vehicleId,
          document_type: 'receipt',
          title: file.name,
          description: null,
          document_date: null,
          file_url: pub?.publicUrl,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          privacy_level: form.privacy_level,
          contains_pii: true,
          vendor_name: null,
          amount: null,
          currency: 'USD',
          uploaded_by: userId
        };

        const { data: ins, error: insErr } = await supabase
          .from('vehicle_documents')
          .insert([payload])
          .select('*')
          .single();
        if (insErr) throw insErr;

        // Always auto-extract for receipts/invoices after upload
        if (payload.document_type === 'receipt' || payload.document_type === 'invoice') {
          try {
            setExtractingId(ins.id);
            const parsed = await receiptExtractionService.extract({ url: pub?.publicUrl, mimeType: file.type });
            await receiptPersistService.saveForVehicleDoc({ vehicleId, documentId: ins.id, parsed });
          } catch (ex) {
            console.warn('Auto-extract failed for', file.name, ex);
          } finally {
            setExtractingId(null);
          }
        }
      }
      await loadDocuments();
      try {
        window.dispatchEvent(new CustomEvent('valuation_updated', { detail: { vehicleId } } as any));
      } catch {}
      alert(`Uploaded ${files.length} file(s)`);
    } catch (err: any) {
      console.error('Upload error:', err?.message || err);
      alert('Failed to upload one or more documents');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Removed manual batch extraction; processing is automated after upload

  const deleteDocument = async (doc: VehicleDocument) => {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      // Best-effort delete file from storage
      try {
        const url = new URL(doc.file_url);
        const marker = '/object/public/vehicle-data/';
        const idx = url.pathname.indexOf(marker);
        if (idx !== -1) {
          const path = url.pathname.substring(idx + marker.length);
          await supabase.storage.from('vehicle-data').remove([path]);
        }
      } catch {}
      await supabase.from('vehicle_documents').delete().eq('id', doc.id);
      await loadDocuments();
      try {
        window.dispatchEvent(new CustomEvent('valuation_updated', { detail: { vehicleId } } as any));
      } catch {}
    } catch (e) {
      console.error('Delete document error:', e);
    }
  };

  const DocumentRow: React.FC<{ d: VehicleDocument }> = ({ d }) => {
    const isPdf = d.file_type === 'application/pdf' || d.file_name.toLowerCase().endsWith('.pdf');
    return (
      <div className="border border-gray-200 rounded p-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-gray-100 rounded">
          </div>
          <div>
            <div className="flex items-center gap-2">
              <a href={d.file_url} target="_blank" rel="noreferrer" className="font-medium text-blue-700">
                {d.title}
              </a>
              <span className="text-xs text-gray-500">{d.document_type.replace('_', ' ')}</span>
              {d.privacy_level !== 'public' && (
                <span className="text-xs text-gray-600 flex items-center gap-1">
                  <LockClosedIcon className="w-3.5 h-3.5" /> {d.privacy_level}
                </span>
              )}
            </div>
            {d.description && (
              <div className="text-sm text-gray-600">{d.description}</div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 mt-1">
              {d.document_date && (
                <span className="inline-flex items-center gap-1"><CalendarIcon className="w-3.5 h-3.5" />{new Date(d.document_date).toLocaleDateString()}</span>
              )}
              {d.vendor_name && (
                <span className="inline-flex items-center gap-1"><TagIcon className="w-3.5 h-3.5" />{d.vendor_name}</span>
              )}
              {(d.amount ?? null) !== null && (
                <span className="inline-flex items-center gap-1"><CurrencyDollarIcon className="w-3.5 h-3.5" />{d.currency} {d.amount}</span>
              )}
              <span>{isPdf ? 'PDF' : d.file_type}</span>
              {d.contains_pii && (
                <span className="inline-flex items-center gap-1 text-rose-700"><ShieldCheckIcon className="w-3.5 h-3.5" />PII Protected</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={d.file_url} target="_blank" rel="noreferrer" className="button button-small" title="View">
            <EyeIcon className="w-4 h-4" />
          </a>
          {/* Manual extract removed — handled automatically on upload */}
          <button
            className="button button-small"
            title="Attach as Source"
            onClick={() => setAttachState({ open: true, doc: d, fieldName: '', fieldValue: d.amount?.toString() || '' })}
          >
            Attach Source
          </button>
          <button className="button button-danger button-small" onClick={() => deleteDocument(d)}>
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
    <div className="card">
      <div className="card-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 style={{ fontSize: '10pt' }} className="font-semibold">Documents</h3>
          </div>
          <button className="button button-primary" onClick={onPickFile} disabled={uploading}>
            <ArrowUpOnSquareIcon className="w-4 h-4 mr-1" /> Upload
          </button>
        </div>
      </div>
      <div className="card-body">
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-sm text-gray-700">Privacy</label>
            <select className="w-full border rounded px-2 py-1" value={form.privacy_level} onChange={e => setForm(prev => ({ ...prev, privacy_level: e.target.value as DocumentPrivacy }))}>
              <option value="owner_only">Owner Only</option>
              <option value="restricted">Restricted</option>
              <option value="public">Public</option>
            </select>
          </div>
        </div>

        <input ref={fileInputRef} type="file" multiple accept={allowedMimeTypes.join(',')} className="hidden" onChange={handleUpload} />

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : docs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No documents uploaded</p>
            <p className="text-sm">Receipts, invoices, titles, registration, and more</p>
          </div>
        ) : (
          <div className="space-y-3">
            {docs.map(d => (
              <DocumentRow key={d.id} d={d} />
            ))}
          </div>
        )}
      </div>
    </div>
    {attachState.open && attachState.doc && (
      <div className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={() => setAttachState(prev => ({ ...prev, open: false }))}
      >
        <div className="bg-white rounded shadow-xl border" style={{ width: 'min(560px, 95vw)' }} onClick={(e) => e.stopPropagation()}>
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="text font-bold">Attach Document as Source</h3>
            <button className="button button-small" onClick={() => setAttachState(prev => ({ ...prev, open: false }))}>Close</button>
          </div>
          <div className="p-4 space-y-3">
            <div className="text-sm text-gray-600">{attachState.doc?.title} • {attachState.doc?.document_type.replace('_',' ')} • {attachState.doc?.amount ? `${attachState.doc?.currency} ${attachState.doc?.amount}` : attachState.doc?.file_type}</div>
            <div>
              <label className="text-sm text-gray-700">Field Name</label>
              <input className="w-full border rounded px-2 py-1" placeholder="e.g., parts_cost, engine_rebuild_cost, market_value"
                value={attachState.fieldName}
                onChange={(e) => setAttachState(prev => ({ ...prev, fieldName: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm text-gray-700">Field Value</label>
              <input className="w-full border rounded px-2 py-1" placeholder="e.g., 245.00"
                value={attachState.fieldValue}
                onChange={(e) => setAttachState(prev => ({ ...prev, fieldValue: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                className="button button-primary"
                onClick={async () => {
                  try {
                    if (!attachState.fieldName.trim()) {
                      alert('Enter a field name');
                      return;
                    }
                    const { data: authData } = await supabase.auth.getUser();
                    const userId = authData.user?.id || null;
                    const metadata = {
                      document_url: attachState.doc?.file_url,
                      document_type: attachState.doc?.document_type,
                      vendor: attachState.doc?.vendor_name,
                      amount: attachState.doc?.amount,
                      currency: attachState.doc?.currency,
                      document_date: attachState.doc?.document_date
                    };
                    const payload: any = {
                      vehicle_id: vehicleId,
                      field_name: attachState.fieldName.trim(),
                      field_value: attachState.fieldValue.trim(),
                      source_type: 'document',
                      source_name: attachState.doc?.document_type || 'document',
                      confidence_score: 85,
                      metadata,
                      user_id: userId,
                      updated_at: new Date().toISOString()
                    };
                    // Upsert into provenance table
                    await supabase.from('vehicle_field_sources').upsert(payload, { onConflict: 'vehicle_id,field_name' });
                    // Emit refresh events
                    window.dispatchEvent(new CustomEvent('timeline_updated', { detail: { vehicleId } } as any));
                    setAttachState({ open: false, doc: null, fieldName: '', fieldValue: '' });
                    alert('Attached as source');
                  } catch (e) {
                    console.error('Attach source failed:', e);
                    alert('Failed to attach source');
                  }
                }}
              >Attach</button>
              <button className="button" onClick={() => setAttachState({ open: false, doc: null, fieldName: '', fieldValue: '' })}>Cancel</button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default VehicleDocumentManager;
