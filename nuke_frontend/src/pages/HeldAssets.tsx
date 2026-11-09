// /assets/mine: the signed-in holder's works, from held_assets_read. The production ledger the owner asked to "look at the
// numbers" of (case ledger §21.1): counts by type, each work with its declared words and whether a public sale is recorded.
import React, { useEffect, useState } from 'react';
import { PrefetchLink } from '../components/PrefetchLink';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { supabase } from '../lib/supabase';
import { Row, Rows, Section, Text, day } from '../kit';
import type { Coverage } from '../kit';
import './asset-declare.css';

type Declared = { medium?: string; year?: string; dimensions?: string; edition?: string; notes?: string };
type Held = { id: string; asset_type: string; title: string | null; visibility: string; created_at: string; declared: Declared | null;
  identity_basis: string | null; presentations: number; photos?: number; public_sale_recorded: boolean };
export type Proposed = { id: string; title: string | null; kind: string | null; labels: string[] | null; photos: number; span_from: string | null; span_to: string | null;
  filenames: string[] | null; labeller: string | null; proposed_at: string | null };
export type HeldAssets = { assets: Held[]; total: number; by_type: Record<string, number>; proposed?: Proposed[]; proposed_total?: number; as_of: string };

const TYPE_WORDS: Record<string, string> = { artwork: 'artworks', publication: 'publications', automobilia: 'automobilia', memorabilia: 'memorabilia' };
export function ledgerLine(h: HeldAssets): string {
  const parts = Object.entries(h.by_type).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n.toLocaleString('en-US')} ${TYPE_WORDS[k] ?? k}`);
  const sold = h.assets.filter(a => a.public_sale_recorded).length;
  const found = h.proposed_total ?? 0;
  return `${h.total.toLocaleString('en-US')} work${h.total === 1 ? '' : 's'} confirmed${parts.length ? `: ${parts.join(', ')}` : ''}${found ? ` · ${found.toLocaleString('en-US')} found in your photos, awaiting you` : ''} · ${sold} with a public sale recorded`;
}
const KIND_WORDS: Record<string, string> = { painting: 'painting', drawing: 'drawing', sketch: 'sketch', billboard: 'billboard', mural: 'mural', sculpture: 'sculpture', street_art: 'street art', gallery: 'gallery sitting', artwork: 'work' };
export function proposalLine(p: Proposed): string {
  const span = p.span_from && p.span_to && p.span_from.slice(0, 10) !== p.span_to.slice(0, 10) ? `${day(p.span_from)} to ${day(p.span_to)}` : p.span_from ? day(p.span_from) : 'undated';
  return `${KIND_WORDS[p.kind ?? ''] ?? p.kind ?? 'work'} · ${p.photos} photo${p.photos === 1 ? '' : 's'} · ${span}${p.labels?.length ? ` · ${p.labels.join(', ')}` : ''}`;
}

export default function HeldAssetsPage() {
  const { user, loading } = useAuth();
  const [held, setHeld] = useState<HeldAssets | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  usePageTitle('Your works');
  const read = () => supabase.rpc('held_assets_read', { p_limit: 500 }).then(({ data, error: e }) => {
    if (e) { setError(e.message); setHeld(null); } else setHeld((data as HeldAssets | null) ?? { assets: [], total: 0, by_type: {}, as_of: new Date().toISOString() });
  });
  useEffect(() => {
    if (!user) { setHeld(null); return; }
    let live = true;
    supabase.rpc('held_assets_read', { p_limit: 500 }).then(({ data, error: e }) => {
      if (!live) return;
      if (e) { setError(e.message); setHeld(null); } else setHeld((data as HeldAssets | null) ?? { assets: [], total: 0, by_type: {}, as_of: new Date().toISOString() });
    });
    return () => { live = false; };
  }, [user]);
  const dismiss = async (id: string) => {
    setBusy(id);
    const { error: e } = await supabase.rpc('dismiss_held_asset', { p_asset_id: id, p_reason: 'not my work' });
    if (e) setError(e.message); else await read();
    setBusy(null);
  };

  if (loading) return <main className="ad-page"><div role="status" className="ad-notice"><Text role="body">Checking who you are…</Text></div></main>;
  if (!user) return <main className="ad-page">
    <Text role="entity" as="h1">Your works</Text>
    <p className="ad-notice"><Text role="body">Your works are yours to see, signed in. </Text><PrefetchLink to="/login" className="ad-link">Sign in</PrefetchLink></p>
  </main>;
  if (held === undefined) return <main className="ad-page"><div role="status" className="ad-notice"><Text role="body">Reading your ledger…</Text></div></main>;
  if (held === null) return <main className="ad-page"><div role="alert" className="ad-notice"><Text role="body">{`Your ledger could not be read${error ? `: ${error}` : ''}.`}</Text></div></main>;

  const coverage: Coverage = { n: held.assets.length, of: held.total, grain: 'work', as_of: held.as_of };
  return <main className="ad-page">
    <header className="ad-head">
      <Text role="entity" as="h1">Your works</Text>
      <Text role="body" as="p" className="ad-lede">{ledgerLine(held)}</Text>
      <div className="ad-actions"><PrefetchLink to="/assets/new" className="ad-sign ad-sign--link"><Text role="label">Declare a work</Text></PrefetchLink></div>
    </header>
    {(held.proposed?.length ?? 0) > 0 && <Section title="Found in your photos" coverage={{ n: held.proposed!.length, of: held.proposed_total ?? held.proposed!.length, grain: 'work', as_of: held.as_of }}>
      <Text role="caption" as="p" className="ad-lede">Works the analysis found in your photo library, grouped by visual identity across time. Open one to see its photographs and dates; say "Not mine" for anything that is not your work. Naming it is optional.</Text>
      <ul className="ad-list">{held.proposed!.map(p => <li key={p.id} className="ad-item">
        <div className="ad-item__row">
          <PrefetchLink to={`/assets/${p.id}`} className="ad-item__link">
            <span className="ad-item__head"><Text role="entity" dense>{p.title ?? 'Proposed work'}</Text><Text role="caption">{p.labeller ? 'labelled on device' : ''}</Text></span>
            <Text role="caption">{proposalLine(p)}</Text>
          </PrefetchLink>
          <div className="ad-item__verbs">
            <PrefetchLink to={`/assets/new?confirm=${p.id}`} className="ad-link"><Text role="label">Name it</Text></PrefetchLink>
            <button type="button" className="ad-verb" disabled={busy === p.id} onClick={() => void dismiss(p.id)}><Text role="label">{busy === p.id ? '…' : 'Not mine'}</Text></button>
          </div>
        </div>
      </li>)}</ul>
    </Section>}
    {held.assets.length === 0 && (held.proposed?.length ?? 0) === 0 && <p className="ad-notice"><Text role="body">Nothing recorded yet. The analysis of your photo library lands works here; a work no photo shows can be declared.</Text></p>}
    {held.assets.length > 0 && <Section title="Your works" coverage={coverage}>
      <ul className="ad-list">{held.assets.map(a => <li key={a.id} className="ad-item">
        <PrefetchLink to={`/assets/${a.id}`} className="ad-item__link">
          <span className="ad-item__head"><Text role="entity" dense>{a.title ?? 'Untitled'}</Text><Text role="caption">{a.visibility}</Text></span>
          <Text role="caption">{[TYPE_WORDS[a.asset_type] ? a.asset_type : a.asset_type, a.declared?.medium, a.declared?.year, a.declared?.dimensions, a.declared?.edition].filter(Boolean).join(' · ')}</Text>
          <Text role="caption">{`${a.public_sale_recorded ? 'a public sale is recorded' : 'no public sale recorded'} · ${a.presentations} presentation${a.presentations === 1 ? '' : 's'}${a.photos ? ` · ${a.photos} photo${a.photos === 1 ? '' : 's'}` : ''} · ${a.identity_basis === 'photo_proposal' ? 'found in your photos' : 'declared'} ${day(a.created_at)}`}</Text>
        </PrefetchLink>
      </li>)}</ul>
    </Section>}
    {held.assets.length > 0 && <Rows title="By type">{Object.entries(held.by_type).map(([k, n]) => <Row key={k} label={TYPE_WORDS[k] ?? k} role="measure">{n.toLocaleString('en-US')}</Row>)}</Rows>}
  </main>;
}
