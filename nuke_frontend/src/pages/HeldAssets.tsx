// /assets/mine: the signed-in person's records, from held_assets_read, each under its standing (PR #3190). Works they hold;
// works they kept as documentation from their own photos (no role claim needed to stay here); other records (the earlier single
// confirmation, their own statements, records they created) with the reason each is here; and works found in their photos, awaiting
// them. Keeping a found work records documentation only: it never says the person made or holds it.
import React, { useEffect, useState } from 'react';
import { PrefetchLink } from '../components/PrefetchLink';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { supabase } from '../lib/supabase';
import { Row, Rows, Section, Text, day } from '../kit';
import type { Coverage } from '../kit';
import './asset-declare.css';

type Declared = { medium?: string; year?: string; dimensions?: string; edition?: string; notes?: string };
type MyRole = { role: string; claim_id: string; qualification: string | null };
export type Held = { id: string; asset_type: string; title: string | null; visibility: string; created_at: string; declared: Declared | null;
  identity_basis: string | null; presentations: number; photos?: number; public_sale_recorded: boolean;
  standing?: 'held' | 'documented' | 'recorded'; reasons?: string[] | null; my_roles?: MyRole[] | null; legacy_compound?: boolean; documentation_records?: number };
export type Proposed = { id: string; title: string | null; kind: string | null; labels: string[] | null; photos: number; span_from: string | null; span_to: string | null;
  filenames: string[] | null; labeller: string | null; proposed_at: string | null };
export type HeldAssets = { assets: Held[]; total: number; by_type: Record<string, number>;
  documented?: Held[]; documented_total?: number; recorded?: Held[]; recorded_total?: number;
  proposed?: Proposed[]; proposed_total?: number; as_of: string };

const TYPE_WORDS: Record<string, string> = { artwork: 'artworks', publication: 'publications', automobilia: 'automobilia', memorabilia: 'memorabilia' };
const n = (x: number) => x.toLocaleString('en-US');
export function ledgerLine(h: HeldAssets): string {
  const parts = Object.entries(h.by_type).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${n(c)} ${TYPE_WORDS[k] ?? k}`);
  const sold = h.assets.filter(a => a.public_sale_recorded).length;
  const documented = h.documented_total ?? 0, recorded = h.recorded_total ?? 0, found = h.proposed_total ?? 0;
  return [`${n(h.total)} held${parts.length ? `: ${parts.join(', ')}` : ''}`,
    documented ? `${n(documented)} documented from your photos` : '',
    recorded ? `${n(recorded)} other record${recorded === 1 ? '' : 's'}` : '',
    found ? `${n(found)} found in your photos, awaiting you` : '',
    `${sold} with a public sale recorded`].filter(Boolean).join(' · ');
}
const KIND_WORDS: Record<string, string> = { painting: 'painting', drawing: 'drawing', sketch: 'sketch', billboard: 'billboard', mural: 'mural', sculpture: 'sculpture', street_art: 'street art', gallery: 'gallery sitting', artwork: 'work' };
export function proposalLine(p: Proposed): string {
  const span = p.span_from && p.span_to && p.span_from.slice(0, 10) !== p.span_to.slice(0, 10) ? `${day(p.span_from)} to ${day(p.span_to)}` : p.span_from ? day(p.span_from) : 'undated';
  return `${KIND_WORDS[p.kind ?? ''] ?? p.kind ?? 'work'} · ${p.photos} photo${p.photos === 1 ? '' : 's'} · ${span}${p.labels?.length ? ` · ${p.labels.join(', ')}` : ''}`;
}
const ROLE_WORDS: Record<string, string> = { documenter: 'photographed it', creator: 'made it', fabricator: 'fabricated it', holder: 'hold it', performer: 'performed work on it', rights_holder: 'hold rights in it' };
const STANDING_WORDS: Record<string, string> = {
  stated_unverified: 'stated, not verified', stated_evidence_lapsed: 'stated; a record it cited was withdrawn or replaced',
  accepted_interim: 'accepted under the interim rule', acceptance_lapsed: 'was accepted; a record it cited was withdrawn or replaced',
};
/** Why a record sits in "Other records", in the person's words. */
export function reasonLine(h: Held): string {
  const out: string[] = [];
  for (const r of h.reasons ?? []) {
    if (r === 'legacy_compound') out.push('recorded under the earlier single confirmation: whether you hold it or made it is unresolved');
    else if (r === 'record_origin') out.push('you created this record');
    else { const [role, q] = r.split(':'); out.push(`you said you ${ROLE_WORDS[role] ?? role}${q && STANDING_WORDS[q] ? ` (${STANDING_WORDS[q]})` : ''}`); }
  }
  return out.join(' · ');
}
const empty: HeldAssets = { assets: [], total: 0, by_type: {}, as_of: new Date().toISOString() };

export default function HeldAssetsPage() {
  const { user, loading } = useAuth();
  const [held, setHeld] = useState<HeldAssets | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  usePageTitle('Your records');
  const read = () => supabase.rpc('held_assets_read', { p_limit: 500 }).then(({ data, error: e }) => {
    if (e) { setError(e.message); setHeld(null); } else setHeld((data as HeldAssets | null) ?? empty);
  });
  useEffect(() => {
    if (!user) { setHeld(null); return; }
    let live = true;
    supabase.rpc('held_assets_read', { p_limit: 500 }).then(({ data, error: e }) => {
      if (!live) return;
      if (e) { setError(e.message); setHeld(null); } else setHeld((data as HeldAssets | null) ?? empty);
    });
    return () => { live = false; };
  }, [user]);
  const discard = async (id: string) => {
    setBusy(id);
    const { error: e } = await supabase.rpc('dismiss_held_asset', { p_asset_id: id, p_reason: 'not a work' });
    if (e) setError(e.message); else await read();
    setBusy(null);
  };

  if (loading) return <main className="ad-page"><div role="status" className="ad-notice"><Text role="body">Checking who you are…</Text></div></main>;
  if (!user) return <main className="ad-page">
    <Text role="entity" as="h1">Your records</Text>
    <p className="ad-notice"><Text role="body">Your records are yours to see, signed in. </Text><PrefetchLink to="/login" className="ad-link">Sign in</PrefetchLink></p>
  </main>;
  if (held === undefined) return <main className="ad-page"><div role="status" className="ad-notice"><Text role="body">Reading your ledger…</Text></div></main>;
  if (held === null) return <main className="ad-page"><div role="alert" className="ad-notice"><Text role="body">{`Your ledger could not be read${error ? `: ${error}` : ''}.`}</Text></div></main>;

  const documented = held.documented ?? [], recorded = held.recorded ?? [], proposed = held.proposed ?? [];
  const nothing = held.assets.length === 0 && documented.length === 0 && recorded.length === 0 && proposed.length === 0;
  const item = (a: Held, line: string) => <li key={a.id} className="ad-item">
    <PrefetchLink to={`/assets/${a.id}`} className="ad-item__link">
      <span className="ad-item__head"><Text role="entity" dense>{a.title ?? 'Untitled'}</Text><Text role="caption">{a.visibility}</Text></span>
      <Text role="caption">{[a.asset_type, a.declared?.medium, a.declared?.year, a.declared?.dimensions, a.declared?.edition].filter(Boolean).join(' · ')}</Text>
      <Text role="caption">{line}</Text>
    </PrefetchLink>
  </li>;
  return <main className="ad-page">
    <header className="ad-head">
      <Text role="entity" as="h1">Your records</Text>
      <Text role="body" as="p" className="ad-lede">{ledgerLine(held)}</Text>
      <div className="ad-actions"><PrefetchLink to="/assets/new" className="ad-sign ad-sign--link"><Text role="label">Declare a work you hold</Text></PrefetchLink></div>
    </header>
    {proposed.length > 0 && <Section title="Found in your photos" coverage={{ n: proposed.length, of: held.proposed_total ?? proposed.length, grain: 'work', as_of: held.as_of }}>
      <Text role="caption" as="p" className="ad-lede">Works the analysis found in your photo library, grouped by visual identity across time. Keeping one records it as documentation of the work you photographed; it does not say you made it or hold it. Discard anything that is not a work.</Text>
      <ul className="ad-list">{proposed.map(p => <li key={p.id} className="ad-item">
        <div className="ad-item__row">
          <PrefetchLink to={`/assets/${p.id}`} className="ad-item__link">
            <span className="ad-item__head"><Text role="entity" dense>{p.title ?? 'Proposed work'}</Text><Text role="caption">{p.labeller ? 'labelled on device' : ''}</Text></span>
            <Text role="caption">{proposalLine(p)}</Text>
          </PrefetchLink>
          <div className="ad-item__verbs">
            <PrefetchLink to={`/assets/new?confirm=${p.id}`} className="ad-link"><Text role="label">Keep as documentation</Text></PrefetchLink>
            <button type="button" className="ad-verb" disabled={busy === p.id} onClick={() => void discard(p.id)}><Text role="label">{busy === p.id ? '…' : 'Not a work'}</Text></button>
          </div>
        </div>
      </li>)}</ul>
    </Section>}
    {nothing && <p className="ad-notice"><Text role="body">Nothing recorded yet. The analysis of your photo library lands works here; a work you hold that no photo shows can be declared.</Text></p>}
    {held.assets.length > 0 && <Section title="Works you hold" coverage={{ n: held.assets.length, of: held.total, grain: 'work', as_of: held.as_of } as Coverage}>
      <ul className="ad-list">{held.assets.map(a => item(a, `${a.public_sale_recorded ? 'a public sale is recorded' : 'no public sale recorded'} · ${a.presentations} presentation${a.presentations === 1 ? '' : 's'}${a.photos ? ` · ${a.photos} photo${a.photos === 1 ? '' : 's'}` : ''} · ${a.identity_basis === 'photo_proposal' ? 'found in your photos' : 'declared'} ${day(a.created_at)}`))}</ul>
    </Section>}
    {documented.length > 0 && <Section title="Documented from your photos" coverage={{ n: documented.length, of: held.documented_total ?? documented.length, grain: 'work', as_of: held.as_of }}>
      <Text role="caption" as="p" className="ad-lede">Works you photographed and kept as documentation. Who made or holds them is not stated here.</Text>
      <ul className="ad-list">{documented.map(a => item(a, [`documentation · ${a.photos ?? 0} photo${a.photos === 1 ? '' : 's'} · kept ${day(a.created_at)}`, reasonLine(a)].filter(Boolean).join(' · ')))}</ul>
    </Section>}
    {recorded.length > 0 && <Section title="Other records" coverage={{ n: recorded.length, of: held.recorded_total ?? recorded.length, grain: 'work', as_of: held.as_of }}>
      <ul className="ad-list">{recorded.map(a => item(a, reasonLine(a) || 'a record you can see'))}</ul>
    </Section>}
    {held.assets.length > 0 && <Rows title="Held, by type">{Object.entries(held.by_type).map(([k, c]) => <Row key={k} label={TYPE_WORDS[k] ?? k} role="measure">{n(c)}</Row>)}</Rows>}
  </main>;
}
