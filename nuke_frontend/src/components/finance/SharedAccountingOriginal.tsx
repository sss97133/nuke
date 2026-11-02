import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { bounded, fetchAccountingOriginal } from '../../services/accountingCloseout';
import './shared-accounting-original.css';

function TextOriginal({ blob }: { blob: Blob }) {
  const [source, setSource] = useState<{ blob: Blob; text: string; error?: boolean } | null>(null);
  const [extent, setExtent] = useState({ blob, chars: 64_000 });
  const chars = extent.blob === blob ? extent.chars : 64_000;
  useEffect(() => {
    let cancelled = false;
    void blob.text().then(text => { if (!cancelled) setSource({ blob, text }); })
      .catch(() => { if (!cancelled) setSource({ blob, text: '', error: true }); });
    return () => { cancelled = true; };
  }, [blob]);
  if (source?.blob !== blob) return <p role="status">Reading original text…</p>;
  if (source.error) return <p role="status">This text original could not be displayed.</p>;
  return <div className="accounting-original-text">
    <pre>{source.text.slice(0, chars)}</pre>
    {source.text.length > chars && <><p>Showing {chars.toLocaleString()} of {source.text.length.toLocaleString()} characters.</p>
      <button type="button" onClick={() => setExtent({ blob, chars: chars + 64_000 })}>Show more original text</button></>}
  </div>;
}

function PdfOriginal({ blob }: { blob: Blob }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1), [width, setWidth] = useState(0), [error, setError] = useState('');
  const frame = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false, task: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined;
    setPdf(null); setPage(1); setError('');
    void (async () => {
      const [library, data] = await Promise.all([
        import('pdfjs-dist'), blob.arrayBuffer(),
      ]);
      if (cancelled) return;
      library.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      task = library.getDocument({ data, isEvalSupported: false });
      const document = await task.promise;
      if (!cancelled) setPdf(document);
    })().catch(() => { if (!cancelled) setError('This PDF could not be displayed.'); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [blob]);
  useEffect(() => {
    if (!frame.current) return;
    const observer = new ResizeObserver(() => setWidth(frame.current?.clientWidth ?? 0));
    observer.observe(frame.current);
    setWidth(frame.current.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !width || !canvas.current) return;
    let cancelled = false, render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    const target = canvas.current;
    void pdf.getPage(page).then(source => {
      if (cancelled) return;
      const scale = width / source.getViewport({ scale: 1 }).width;
      const viewport = source.getViewport({ scale: scale * Math.min(window.devicePixelRatio || 1, 2) });
      target.width = viewport.width; target.height = viewport.height;
      render = source.render({ canvas: target, viewport });
      return render.promise;
    }).catch(() => { if (!cancelled) setError('This PDF page could not be displayed.'); });
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, page, width]);
  return <div ref={frame} className="accounting-original-pdf">
    {error ? <p role="status">{error}</p> : !pdf ? <p role="status">Reading PDF…</p> : <>
      <nav aria-label="Original document pages">
        <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous page</button>
        <span aria-live="polite">Page {page} of {pdf.numPages}</span>
        <button type="button" disabled={page === pdf.numPages} onClick={() => setPage(value => value + 1)}>Next page</button>
      </nav>
      <canvas ref={canvas} role="img" aria-label={`Original document, page ${page}`} />
    </>}
  </div>;
}

/** An original stays inside its selected financial record; blob URLs die with the preview. */
export function OriginalDocumentPreview({ blob, filename, onClose }: { blob: Blob; filename: string; onClose: () => void }) {
  const [source, setSource] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setSource({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  const url = source?.blob === blob ? source.url : null;
  const image = /^image\/(jpeg|png|webp|gif|avif)$/.test(blob.type);
  const text = /^(text\/(plain|csv|tab-separated-values)|application\/json)(;|$)/.test(blob.type) || /\.(csv|txt|tsv|json)$/i.test(filename);
  return <section className="accounting-original-preview" aria-label="Original document">
    <div className="accounting-original-toolbar"><button type="button" onClick={onClose}>Close original</button><span>{filename}</span></div>
    {blob.type === 'application/pdf' ? <PdfOriginal blob={blob} /> : image && url
      ? <img src={url} width={1000} height={1400} alt={`Original: ${filename}`} />
      : text ? <TextOriginal blob={blob} /> : <p>This file does not support an inline preview.</p>}
    {url && <a href={url} download={filename}>Download original</a>}
  </section>;
}

export default function SharedAccountingOriginal({ ownerId, documentId }: { ownerId: string; documentId: string }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [original, setOriginal] = useState<{ key: string; blob: Blob; filename: string } | null>(null);
  const key = `${ownerId}:${documentId}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const epoch = useRef(0);
  useEffect(() => { epoch.current++; setBusy(false); setMessage(''); setOriginal(null); return () => { epoch.current++; }; }, [key]);
  return <section><button ref={trigger} type="button" disabled={busy} onClick={async () => {
    const current = ++epoch.current; setBusy(true); setOriginal(null); setMessage('Checking private original access…');
    try {
      const { blob, filename } = await bounded(() => fetchAccountingOriginal(ownerId, documentId));
      if (current !== epoch.current) return;
      setOriginal({ key, blob, filename }); setMessage('');
    } catch { if (current === epoch.current) setMessage('Original unavailable or access revoked.'); }
    finally { if (current === epoch.current) setBusy(false); }
  }}>Read private original</button>{message && <p role="status">{message}</p>}
    {original?.key === key && <OriginalDocumentPreview blob={original.blob} filename={original.filename}
      onClose={() => { setOriginal(null); trigger.current?.focus(); }} />}
  </section>;
}
