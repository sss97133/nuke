/**
 * DeckPage — standalone data-driven presentation page.
 * Route: /deck/:deckId (e.g. /deck/luxe-fleet-ford)
 * No AppLayout. Uses deck-style-guide.css for styling, scoped under .deck-root.
 * Templates render structured content; legacy slides fall back to raw HTML.
 */
import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useDeckData } from '../components/deck/useDeckData';
import DeckSlide from '../components/deck/DeckSlide';
import SlideEditor from '../components/deck/SlideEditor';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import '../styles/deck-style-guide.css';

/** Legacy v2 CSS — kept for raw-HTML fallback slides that still use .slide/.card/.dark etc. */
const LEGACY_CSS = `
.deck-root .slide { min-height:100vh; padding:80px; display:flex; flex-direction:column; justify-content:center; position:relative; border-bottom:1px solid var(--dk-border); }
.deck-root .slide-mark { position:absolute; top:40px; left:80px; font-size:11px; letter-spacing:4px; text-transform:uppercase; font-weight:500; color:var(--dk-muted); }
.deck-root .slide-num { position:absolute; top:40px; right:80px; font-size:11px; letter-spacing:3px; color:var(--dk-muted); }
.deck-root .dark { background:var(--dk-charcoal); color:#e8e4de; }
.deck-root .dark h2,.deck-root .dark h3,.deck-root .dark h4{color:#e8e4de}
.deck-root .dark p,.deck-root .dark li,.deck-root .dark td{color:#bbb5aa}
.deck-root .dark .slide-mark,.deck-root .dark .slide-num{color:#555}
.deck-root .dark .card{background:#222233;border-color:rgba(255,255,255,0.06)}
.deck-root .dark .card h4{color:#e8e4de}.deck-root .dark .card p{color:#bbb5aa}
.deck-root .dark blockquote{border-color:var(--dk-sand)}
.deck-root .dark h3{color:var(--dk-sand)}
.deck-root .dark ul li::before{background:var(--dk-sand)}
.deck-root .dark ul li strong{color:#e8e4de}
.deck-root .dark th{color:#666;border-color:rgba(255,255,255,0.08)}
.deck-root .dark td{border-color:rgba(255,255,255,0.08)}
.deck-root .ford-blue{background:var(--dk-brand-primary);color:#fff}
.deck-root .ford-blue h2,.deck-root .ford-blue h3,.deck-root .ford-blue h4,.deck-root .ford-blue p,.deck-root .ford-blue li,.deck-root .ford-blue td{color:#fff}
.deck-root .ford-blue .slide-mark,.deck-root .ford-blue .slide-num{color:rgba(255,255,255,0.35)}
.deck-root .ford-blue .card{background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.12)}
.deck-root .ford-blue .card h4,.deck-root .ford-blue .card p{color:#fff}
.deck-root .ford-blue h3{color:var(--dk-brand-accent)}
.deck-root .ford-blue ul li::before{background:#fff}
.deck-root .ford-blue .stat .num{color:#fff}
.deck-root .ford-blue .stat .label{color:rgba(255,255,255,0.5)}
.deck-root .marsh{background:var(--dk-marsh);color:#fff}
.deck-root .marsh h2,.deck-root .marsh h3,.deck-root .marsh h4,.deck-root .marsh p,.deck-root .marsh li{color:#fff}
.deck-root .marsh .slide-mark,.deck-root .marsh .slide-num{color:rgba(255,255,255,0.35)}
.deck-root .marsh .card{background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.12)}
.deck-root .marsh .card h4,.deck-root .marsh .card p{color:#fff}
.deck-root .marsh h3{color:rgba(255,255,255,0.6)}
.deck-root .g2{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:32px}
.deck-root .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:32px;margin-top:32px}
.deck-root .g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:24px;margin-top:32px}
.deck-root .card{padding:32px;background:#ebe6e0;border:1px solid var(--dk-border);border-radius:2px}
.deck-root .card h4{font-size:16px;font-weight:600;margin-bottom:10px}
.deck-root .card p{font-size:14px;line-height:1.6;margin-bottom:0;max-width:none}
.deck-root .stat-row{display:flex;gap:64px;margin:32px 0;flex-wrap:wrap}
.deck-root .stat .num{font-size:56px;font-weight:300;color:var(--dk-brand-primary)}
.deck-root .dark .stat .num{color:#fff}
.deck-root .stat .label{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--dk-muted);margin-top:6px}
.deck-root .dark .stat .label{color:#888}
.deck-root .conf{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--dk-muted);position:absolute;bottom:20px;left:80px}
.deck-root .img-caption{font-size:10px;color:var(--dk-muted);margin-top:4px}
.deck-root .dark .img-caption{color:#666}
`;

export default function DeckPage() {
  const { deckId } = useParams<{ deckId: string }>();
  const { slides, orgs, loading, error, refetch } = useDeckData(deckId || '');
  const { user } = useAuth();
  const canEdit = true; // deck editing always enabled — auth handled at route level
  const [exporting, setExporting] = useState(false);
  const [brandSlug, setBrandSlug] = useState<string | null>(null);
  const [editingSlideIdx, setEditingSlideIdx] = useState<number | null>(null);
  const deckRef = useRef<HTMLDivElement>(null);

  // Break out of Nuke app shell — #root has height:100% which clips the deck
  useEffect(() => {
    const root = document.getElementById('root');
    const html = document.documentElement;
    const body = document.body;
    if (root) root.style.height = 'auto';
    if (html) html.style.height = 'auto';
    if (body) { body.style.height = 'auto'; body.style.overflow = 'auto'; body.style.background = '#f0efe9'; }
    return () => {
      if (root) root.style.height = '';
      if (html) html.style.height = '';
      if (body) { body.style.height = ''; body.style.overflow = ''; body.style.background = ''; }
    };
  }, []);

  // Fetch deck manifest for brand_slug
  useEffect(() => {
    if (!deckId) return;
    supabase
      .from('decks')
      .select('brand_slug')
      .eq('id', deckId)
      .single()
      .then(({ data }) => {
        if (data?.brand_slug) setBrandSlug(data.brand_slug);
      });
  }, [deckId]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const el = deckRef.current;
      if (!el) return;
      // Grab computed styles from the style guide CSS
      const styleSheets = Array.from(document.styleSheets);
      let cssText = '';
      for (const sheet of styleSheets) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule.cssText.includes('deck-root') || rule.cssText.includes('dk-')) {
              cssText += rule.cssText + '\n';
            }
          }
        } catch { /* cross-origin sheets */ }
      }
      const exportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${deckId || 'Deck'}</title>
<style>${cssText}</style>
</head>
<body class="deck-root"${brandSlug ? ` data-brand="${brandSlug === 'ford-motor-company' ? 'ford' : brandSlug}"` : ''}>
${el.innerHTML}
</body>
</html>`;
      const blob = new Blob([exportHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deckId || 'deck'}-export.html`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [deckId, brandSlug]);

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0efe9', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ fontSize: 11, letterSpacing: 5, textTransform: 'uppercase', color: '#777' }}>Loading deck...</div>
      </div>
    );
  }

  if (error || slides.length === 0) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0efe9', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 300, color: '#1a1a2e', marginBottom: 12 }}>Deck not found</div>
          <div style={{ fontSize: 14, color: '#777' }}>{error || `No slides for "${deckId}"`}</div>
        </div>
      </div>
    );
  }

  // Map brand_slug → data-brand attribute value
  const dataBrand = brandSlug === 'ford-motor-company' ? 'ford' : brandSlug || undefined;

  return (
    <>
      {/* Legacy CSS for raw-HTML fallback slides */}
      <style>{LEGACY_CSS}</style>

      {canEdit && (
        <div className="deck-toolbar" style={{
          position: 'fixed', top: 0, right: 0, zIndex: 100,
          padding: '12px 20px', display: 'flex', gap: 12, alignItems: 'center',
          background: 'rgba(26,26,46,0.85)', backdropFilter: 'blur(8px)',
          borderBottomLeftRadius: 4,
        }}>
          <span style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
            Editing as {user?.email?.split('@')[0]}
          </span>
          <button onClick={handleExport} disabled={exporting} style={{
            padding: '6px 16px', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
            background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {exporting ? 'Exporting...' : 'Export HTML'}
          </button>
          <button onClick={refetch} style={{
            padding: '6px 16px', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
            background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Refresh
          </button>
        </div>
      )}

      <div className="deck-root" data-brand={dataBrand} ref={deckRef} style={editingSlideIdx !== null ? { marginRight: 420 } : undefined}>
        {slides.map(slide => (
          <div
            key={slide.id}
            onClick={canEdit ? () => setEditingSlideIdx(slide.slide_index) : undefined}
            style={canEdit ? { cursor: 'pointer', outline: editingSlideIdx === slide.slide_index ? '2px solid #003478' : 'none' } : undefined}
          >
            <DeckSlide
              slide={slide}
              orgs={orgs}
              canEdit={canEdit}
            />
          </div>
        ))}
      </div>

      {canEdit && editingSlideIdx !== null && (() => {
        const editSlide = slides.find(s => s.slide_index === editingSlideIdx);
        if (!editSlide) return null;
        return (
          <SlideEditor
            slide={editSlide}
            onClose={() => setEditingSlideIdx(null)}
            onSaved={refetch}
          />
        );
      })()}
    </>
  );
}
