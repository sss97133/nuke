import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
export default function SharedAccountingOriginal({ ownerId, documentId }: { ownerId: string; documentId: string }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  useEffect(() => { epoch.current++; setBusy(false); setMessage(''); return () => { epoch.current++; }; }, [ownerId, documentId]);
  return <section><button type="button" disabled={busy} onClick={async () => {
    const current = ++epoch.current; setBusy(true); setMessage('Checking private original access…');
    try {
      const result = await supabase.functions.invoke('ingest-observation', { body: { mode: 'financial_evidence_v1', action: 'original', owner_user_id: ownerId, document_id: documentId } });
      if (current !== epoch.current) return;
      const source = result.data?.data;
      if (result.error || !source?.bytes_base64) throw new Error('Original unavailable or access revoked.');
      const bytes = Uint8Array.from(atob(source.bytes_base64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: source.mime_type || 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = source.source_filename || 'accounting-original'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('Private original downloaded.');
    } catch { if (current === epoch.current) setMessage('Original unavailable or access revoked.'); }
    finally { if (current === epoch.current) setBusy(false); }
  }}>Download private original</button>{message && <p role="status">{message}</p>}</section>;
}
