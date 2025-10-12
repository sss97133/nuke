import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { secureDocumentService } from '../../services/secureDocumentService';
import { receiptExtractionService } from '../../services/receiptExtractionService';
import { receiptPersistService } from '../../services/receiptPersistService';
import '../../design-system.css';

export type DocumentScope = 'org' | 'user' | 'vehicle';

interface DocumentVaultProps {
  scope: DocumentScope;
  id: string;
  allowUpload?: boolean;
  openOnMount?: boolean;
}

interface OrgDocRow {
  id: string;
  shop_id: string;
  document_type: string;
  title?: string | null;
  file_url?: string | null;
  storage_path?: string | null;
  visibility: 'public'|'shop_members'|'admin_only';
  created_at: string;
}

const ORG_DOC_TYPES = ['state_business_license','ein_assignment_notice','insurance_policy','brand_asset','other'];
const USER_DOC_TYPES = ['id_document','proof_of_address','other'];
const VEHICLE_DOC_TYPES = ['receipt','invoice','title','registration','insurance','service_record','parts_order','shipping_document','legal_document','other'];

const DocumentVault: React.FC<DocumentVaultProps> = ({ scope, id, allowUpload = true, openOnMount = false }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('state_business_license');
  const [visibility, setVisibility] = useState<'public'|'shop_members'|'admin_only'>('admin_only');
  const [extractingId, setExtractingId] = useState<string | null>(null);

      const fetchDocs = async () => {
        if (!id) return;
        try {
          setLoading(true);
          setError(null);
          if (scope === 'org') {
            const { data, error } = await supabase
              .from('shop_documents')
              .select('id, shop_id, document_type, title, file_url, storage_path, visibility, mime_type, created_at')
              .eq('shop_id', id)
              .order('created_at', { ascending: false })
              .limit(100);
            if (error) throw error;
            setDocs((data as OrgDocRow[]) || []);
          } else if (scope === 'user') {
            const list = await secureDocumentService.getUserDocuments();
            setDocs(list as any[]);
          } else if (scope === 'vehicle') {
            const { data, error } = await supabase
              .from('vehicle_documents')
              .select('id, document_type, title, file_url, privacy_level, created_at, file_type')
              .eq('vehicle_id', id)
              .order('created_at', { ascending: false })
              .limit(100);
            if (error) throw error;
            setDocs((data as any[]) || []);
          }
        } catch (e: any) {
          setError(e?.message || 'Failed to load documents');
          setDocs([]);
        } finally {
          setLoading(false);
        }
      };

  useEffect(() => { fetchDocs(); }, [scope, id]);

  useEffect(() => {
    if (openOnMount && allowUpload && (scope === 'org' || scope === 'user')) {
      setTimeout(() => fileInputRef.current?.click(), 0);
    }
  }, [openOnMount, allowUpload, scope]);

  // Ensure a valid default doc type for current scope
  useEffect(() => {
    if (scope === 'org') setDocType(ORG_DOC_TYPES[0]);
    else if (scope === 'user') setDocType(USER_DOC_TYPES[0]);
    else if (scope === 'vehicle') setDocType(VEHICLE_DOC_TYPES[0]);
  }, [scope]);

      const upload = async () => {
        if (!file) return;
        try {
          setLoading(true);
          if (scope === 'org') {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');
            const path = `${user.id}/shops/${id}/${Date.now()}_${file.name}`;
            const { data: uploadData, error: uploadErr } = await supabase.storage
              .from('user-documents')
              .upload(path, file, { cacheControl: '3600', upsert: false });
            if (uploadErr) throw uploadErr;
            const { data: signed, error: signErr } = await supabase.storage
              .from('user-documents')
              .createSignedUrl(uploadData.path, 60 * 60 * 24 * 365);
            if (signErr) throw signErr;
            const fileUrl = signed.signedUrl;
            const { error: insertErr } = await supabase
              .from('shop_documents')
              .insert({
                shop_id: id,
                document_type: docType,
                title: title || file.name,
                storage_path: uploadData.path,
                file_url: fileUrl,
                mime_type: file.type,
                file_size: file.size,
                is_sensitive: true,
                visibility
              });
            if (insertErr) throw insertErr;
          } else if (scope === 'user') {
            const { document, error } = await secureDocumentService.uploadSecureDocument(file, docType, { source: 'DocumentVault' });
            if (error) throw new Error(error);
          } else if (scope === 'vehicle') {
            setError('Upload not available here. Use VehicleDocumentManager.');
            return;
          }
          setFile(null);
          setTitle('');
          await fetchDocs();
        } catch (e: any) {
          alert(`Upload failed: ${e?.message || e}`);
        } finally {
          setLoading(false);
        }
      };

  return (
    <div className="space-y-2">
      {allowUpload && (scope === 'org' || scope === 'user') && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <input ref={fileInputRef} className="form-input" type="file" onChange={(e)=>setFile(e.target.files?.[0] || null)} />
          <input className="form-input" placeholder="Title (optional)" value={title} onChange={(e)=>setTitle(e.target.value)} />
          <select className="form-input" value={docType} onChange={(e)=>setDocType(e.target.value)}>
            {(scope === 'org' ? ORG_DOC_TYPES : USER_DOC_TYPES).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {scope === 'org' && (
            <select className="form-input" value={visibility} onChange={(e)=>setVisibility(e.target.value as any)}>
              <option value="admin_only">admin_only</option>
              <option value="shop_members">shop_members</option>
              <option value="public">public</option>
            </select>
          )}
          <button className="button button-small" onClick={upload} disabled={!file || loading}>Upload</button>
        </div>
      )}

      {loading && <div className="text text-small text-muted">Loading…</div>}
      {error && <div className="text text-small" style={{ color: '#b91c1c' }}>{error}</div>}

      {!loading && !error && (
        <div className="grid grid-cols-2 gap-2" style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:8 }}>
          {docs.length === 0 ? (
            <div className="text text-small text-muted">No documents.</div>
          ) : docs.map((d: any) => (
            <div key={d.id} className="card">
              <div className="card-body" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                <div>
                  <div className="text text-small">
                    {d.document_type} — {d.title || d.file_name || d.file_url || ''}
                  </div>
                  <div className="text text-small text-muted">
                    {new Date(d.created_at).toLocaleDateString()}
                    {scope === 'org' && d.visibility ? ` • ${d.visibility}` : ''}
                    {scope === 'user' && d.verification_status ? ` • ${d.verification_status}` : ''}
                    {scope === 'vehicle' && d.privacy_level ? ` • ${d.privacy_level}` : ''}
                  </div>
                </div>
                <div>
                  {scope === 'org' && d.file_url && (
                    <a className="button button-small" href={d.file_url} target="_blank" rel="noreferrer">View</a>
                  )}
                  {scope === 'org' && (d.document_type === 'receipt' || d.document_type === 'invoice') && (
                    <button
                      className="button button-small"
                      disabled={!!extractingId}
                      onClick={async ()=>{
                        try {
                          setExtractingId(d.id);
                          const parsed = await receiptExtractionService.extract({ url: d.file_url, mimeType: d.mime_type });
                          const res = await receiptPersistService.saveForOrgDoc({ shopId: id, documentId: d.id, parsed });
                          if (res.error) alert(`Extract failed: ${res.error}`); else alert('Receipt extracted and saved');
                        } catch (e: any) {
                          alert(`Extract failed: ${e?.message || e}`);
                        } finally {
                          setExtractingId(null);
                        }
                      }}
                    >
                      {extractingId === d.id ? 'Extracting…' : 'Extract'}
                    </button>
                  )}
                  {scope === 'user' && (
                    <button className="button button-small" onClick={async ()=>{
                      const url = await secureDocumentService.getSecureDocumentUrl(d.id, 'DocumentVault view');
                      if (url) window.open(url, '_blank');
                    }}>View</button>
                  )}
                  {scope === 'vehicle' && d.file_url && (
                    <a className="button button-small" href={d.file_url} target="_blank" rel="noreferrer">View</a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DocumentVault;
