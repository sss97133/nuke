import React, { useEffect, useRef, useState } from 'react';
import { loadPrivateSource, saveReviewedSource, sourceRasterPng, type SourceMask } from '../../services/financialSourceReview';

export default function FinancialSourceReview({ documentId, onComplete }: { documentId: string; onComplete: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const held = useRef<Awaited<ReturnType<typeof loadPrivateSource>> | null>(null);
  const bitmap = useRef<ImageBitmap | null>(null);
  const generation = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [state, setState] = useState<'closed' | 'loading' | 'masking' | 'preview' | 'saving' | 'saved'>('closed');
  const [error, setError] = useState('');
  const [masks, setMasks] = useState<SourceMask[]>([]);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [region, setRegion] = useState<SourceMask>({ x: 0, y: 0, width: 1, height: 1 });
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  useEffect(() => () => { generation.current++; bitmap.current?.close(); held.current = null; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    const context = canvas.current?.getContext('2d', { alpha: false });
    if (!context || !bitmap.current || state !== 'masking') return;
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, bounds.width, bounds.height);
    context.drawImage(bitmap.current, 0, 0);
    context.fillStyle = '#000000';
    masks.forEach(mask => context.fillRect(mask.x, mask.y, mask.width, mask.height));
  }, [masks, bounds, state]);

  async function open() {
    const run = ++generation.current;
    setState('loading'); setError('');
    try {
      const source = await loadPrivateSource(documentId);
      const image = await createImageBitmap(source.blob, { imageOrientation: 'from-image' });
      if (generation.current !== run) { image.close(); return; }
      if (!image.width || image.width * image.height > 40_000_000) { image.close(); throw new Error('Image is too large for browser review'); }
      held.current = source; bitmap.current?.close(); bitmap.current = image;
      setBounds({ width: image.width, height: image.height }); setMasks([]); setState('masking');
    } catch (e) {
      if (generation.current !== run) return;
      setError(e instanceof Error ? e.message : 'This source format cannot be reviewed as an image. Your original remains private.'); setState('closed');
    }
  }
  function addMask(mask: SourceMask) {
    if (![mask.x, mask.y, mask.width, mask.height].every(Number.isSafeInteger) || mask.x < 0 || mask.y < 0 || mask.width <= 0 || mask.height <= 0 || mask.x + mask.width > bounds.width || mask.y + mask.height > bounds.height) {
      setError('Choose a rectangle within the image.'); return;
    }
    setError(''); setMasks(previous => [...previous, mask]); setReviewed(false);
  }
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(bounds.width, Math.round((event.clientX - rect.left) * bounds.width / rect.width))),
      y: Math.max(0, Math.min(bounds.height, Math.round((event.clientY - rect.top) * bounds.height / rect.height))) };
  }
  async function preparePreview() {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const run = generation.current;
    setError('');
    try {
      const pixels = context.getImageData(0, 0, bounds.width, bounds.height);
      const blob = await sourceRasterPng(pixels.data, bounds.width, bounds.height);
      if (generation.current !== run) return;
      // Re-decode the exact bytes that will be uploaded and verify every pixel.
      const decoded = await createImageBitmap(blob);
      const check = document.createElement('canvas'); check.width = bounds.width; check.height = bounds.height;
      const ctx = check.getContext('2d', { alpha: false });
      if (!ctx) { decoded.close(); throw new Error('Image verification unavailable'); }
      ctx.drawImage(decoded, 0, 0); decoded.close();
      const roundtrip = ctx.getImageData(0, 0, bounds.width, bounds.height).data;
      if (roundtrip.length !== pixels.data.length || roundtrip.some((value, index) => value !== pixels.data[index])) throw new Error('Image pixel verification failed');
      if (generation.current !== run) return;
      setPreview({ blob, url: URL.createObjectURL(blob) }); setReviewed(false); setState('preview');
    } catch (e) { if (generation.current === run) setError(e instanceof Error ? e.message : 'Preview could not be created'); }
  }
  async function save() {
    if (!held.current || !preview || !reviewed) return;
    const run = generation.current;
    setState('saving'); setError('');
    try {
      await saveReviewedSource(documentId, held.current.userId, held.current.document.content_sha256, preview.blob, bounds.width, bounds.height);
      if (generation.current !== run) return;
      setState('saved'); setPreview(null); bitmap.current?.close(); bitmap.current = null; held.current = null; onComplete();
    } catch (e) { if (generation.current === run) { setError(e instanceof Error ? e.message : 'Review could not be saved'); setState('preview'); } }
  }
  return <section aria-label="Private source review">
    {state === 'closed' && <button type="button" onClick={open}>Review source privacy</button>}
    {state === 'loading' && <p role="status">Loading your private source…</p>}
    {error && <p role="alert">{error}</p>}
    {state === 'masking' && <>
      <p>Your private original is shown only to you. Drag over personal details to cover them. Check names, contact details, account numbers, signatures, faces, codes and vehicle identifiers. Original evidence stays intact.</p>
      <canvas ref={canvas} width={bounds.width} height={bounds.height} aria-label="Private source; drag to cover a region or use rectangle controls below"
        style={{ maxWidth: '100%', height: 'auto', touchAction: 'none', border: '2px solid currentColor' }}
        onPointerDown={event => { start.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerUp={event => { if (start.current) { const end = point(event), begin = start.current; start.current = null;
          addMask({ x: Math.min(begin.x, end.x), y: Math.min(begin.y, end.y), width: Math.abs(end.x - begin.x), height: Math.abs(end.y - begin.y) }); } }} />
      <fieldset><legend>Cover a rectangle in image pixels ({bounds.width} × {bounds.height})</legend>
        {(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key} <input type="number" min={key === 'x' || key === 'y' ? 0 : 1} value={region[key]} onChange={e => setRegion(previous => ({ ...previous, [key]: Number(e.target.value) }))} /></label>)}
        <button type="button" onClick={() => addMask(region)}>Cover region</button>
      </fieldset>
      <p>{masks.length} covered regions.</p>
      <button type="button" disabled={!masks.length} onClick={() => setMasks(previous => previous.slice(0, -1))}>Undo last region</button>{' '}
      <button type="button" onClick={preparePreview}>Preview redacted copy</button>
    </>}
    {(state === 'preview' || state === 'saving') && preview && <>
      <p>Review the exact copy below. Hidden image text and metadata were removed; you must check all visible pixels for remaining personal details.</p>
      <label><input type="checkbox" checked={actualSize} onChange={e => setActualSize(e.target.checked)} /> Show actual size for inspection</label>
      <div style={{ overflow: 'auto', maxHeight: '70vh' }}><img src={preview.url} width={bounds.width} height={bounds.height} alt="Redacted copy awaiting your privacy review" style={{ maxWidth: actualSize ? 'none' : '100%', height: 'auto' }} /></div>
      <label><input type="checkbox" checked={reviewed} disabled={state === 'saving'} onChange={e => setReviewed(e.target.checked)} /> I inspected this entire copy and confirm the personal details are covered.</label>
      <div><button type="button" disabled={state === 'saving'} onClick={() => { setPreview(null); setReviewed(false); setState('masking'); }}>Edit covered regions</button>{' '}
        <button type="button" disabled={!reviewed || state === 'saving'} onClick={save}>{state === 'saving' ? 'Saving reviewed copy…' : 'Save reviewed private copy'}</button></div>
    </>}
    {state === 'saved' && <p role="status">Reviewed private copy saved. The original is unchanged.</p>}
  </section>;
}
