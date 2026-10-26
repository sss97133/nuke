import { useEffect, useRef, useState } from 'react';
import { fetchAccountingOriginal } from '../../services/accountingCloseout';
export default function SharedAccountingOriginal({ ownerId, documentId }: { ownerId: string; documentId: string }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  useEffect(() => { epoch.current++; setBusy(false); setMessage(''); return () => { epoch.current++; }; }, [ownerId, documentId]);
  return <section><button type="button" disabled={busy} onClick={async () => {
    const current = ++epoch.current; setBusy(true); setMessage('Checking private original access…');
    try {
      const { blob, filename } = await fetchAccountingOriginal(ownerId, documentId);
      if (current !== epoch.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('Private original downloaded.');
    } catch { if (current === epoch.current) setMessage('Original unavailable or access revoked.'); }
    finally { if (current === epoch.current) setBusy(false); }
  }}>Download private original</button>{message && <p role="status">{message}</p>}</section>;
}
