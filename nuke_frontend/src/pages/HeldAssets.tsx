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
  identity_basis: string | null; presentations: number; public_sale_recorded: boolean };
export type HeldAssets = { assets: Held[]; total: number; by_type: Record<string, number>; as_of: string };

const TYPE_WORDS: Record<string, string> = { artwork: 'artworks', publication: 'publications', automobilia: 'automobilia', memorabilia: 'memorabilia' };
export function ledgerLine(h: HeldAssets): string {
  const parts = Object.entries(h.by_type).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n.toLocaleString('en-US')} ${TYPE_WORDS[k] ?? k}`);
  const sold = h.assets.filter(a => a.public_sale_recorded).length;
  return `${h.total.toLocaleString('en-US')} work${h.total === 1 ? '' : 's'} declared${parts.length ? `: ${parts.join(', ')}` : ''} · ${sold} with a public sale recorded`;
}

export default function HeldAssetsPage() {
  const { user, loading } = useAuth();
  const [held, setHeld] = useState<HeldAssets | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  usePageTitle('Your works');
  useEffect(() => {
    if (!user) { setHeld(null); return; }
    let live = true;
    supabase.rpc('held_assets_read', { p_limit: 500 }).then(({ data, error: e }) => {
      if (!live) return;
      if (e) { setError(e.message); setHeld(null); } else setHeld((data as HeldAssets | null) ?? { assets: [], total: 0, by_type: {}, as_of: new Date().toISOString() });
    });
    return () => { live = false; };
  }, [user]);

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
    {held.assets.length === 0 && <p className="ad-notice"><Text role="body">Nothing declared yet. The first painting takes a minute.</Text></p>}
    {held.assets.length > 0 && <Section title="Declared works" coverage={coverage}>
      <ul className="ad-list">{held.assets.map(a => <li key={a.id} className="ad-item">
        <PrefetchLink to={`/assets/${a.id}`} className="ad-item__link">
          <span className="ad-item__head"><Text role="entity" dense>{a.title ?? 'Untitled'}</Text><Text role="caption">{a.visibility}</Text></span>
          <Text role="caption">{[TYPE_WORDS[a.asset_type] ? a.asset_type : a.asset_type, a.declared?.medium, a.declared?.year, a.declared?.dimensions, a.declared?.edition].filter(Boolean).join(' · ')}</Text>
          <Text role="caption">{`${a.public_sale_recorded ? 'a public sale is recorded' : 'no public sale recorded'} · ${a.presentations} presentation${a.presentations === 1 ? '' : 's'} · declared ${day(a.created_at)}`}</Text>
        </PrefetchLink>
      </li>)}</ul>
    </Section>}
    {held.assets.length > 0 && <Rows title="By type">{Object.entries(held.by_type).map(([k, n]) => <Row key={k} label={TYPE_WORDS[k] ?? k} role="measure">{n.toLocaleString('en-US')}</Row>)}</Rows>}
  </main>;
}
