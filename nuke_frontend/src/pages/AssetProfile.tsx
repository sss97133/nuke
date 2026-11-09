// The artwork profile: one typed read (asset_profile_read), one viewer, one clock. Owner, 2026-11-08: "the artwork is the
// endpoint the artwork carries its history. its production timeframe and its events of presentation and association".
// The page renders the house's statements as claims (source, clock, trust behind every number), the creation claims with
// their party, the catalogue as the house laid it out, and every statement ever landed. Nothing here is parsed from free
// text: the house's lines, headings and figures arrive from the reader as it typed them.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { usePageTitle } from '../hooks/usePageTitle';
import { ClaimView, Row, Rows, Section, Text, day } from '../kit';
import type { Claim, Coverage } from '../kit';
import './asset-profile.css';

type Source = { slug: string | null; name: string | null; trust: number | null };
type PrintedSection = { heading: string | null; lines: string[] };
type Lot = {
  statement_id: string; source: Source; house_category: string | null; department_code: string | null; house_group: string | null;
  lot_number: string | null; sale_key: string | null; sale_name: string | null; sale_ends_at: string | null;
  result: string | null; price_basis: string | null; hammer_price: number | null; hammer_premium: number | null; high_bid: number | null;
  estimate_low: number | null; estimate_high: number | null; currency: string | null; observed_at: string; observed_at_basis: string | null;
  url: string | null; lines: string[] | null; catalog_text: string | null; printed_sections: PrintedSection[] | null; symbols: string[] | null;
  image_url: string | null; country: string | null; landed_at: string;
};
type Statement = { statement_id: string; source: string | null; observed_at: string; observed_at_basis: string | null; result: string | null;
  hammer_price: number | null; high_bid: number | null; estimate_low: number | null; estimate_high: number | null; currency: string | null;
  landed_at: string; superseded: boolean };
type Party = { id: string; kind?: 'catalogue' | 'user'; display_name: string | null; qualifier_as_printed?: string | null; claimed: boolean; lots_direct: number; priced_lots: number };
type Executor = { role: string; name_as_printed: string | null; qualifier_as_printed: string | null; party_identity_id: string | null };
type Creation = { claim_id: string; attribution: string; layout: string | null; name_as_printed: string | null; qualifier_as_printed: string | null;
  party: Party | null; executor: Executor | null; source: string | null; observed_at: string; confidence: number | null };
type Declared = { medium?: string; year?: string; dimensions?: string; edition?: string; notes?: string };
export type AssetProfile = {
  asset: { id: string; asset_type: string; title: string | null; house_category: string | null; house_category_code: string | null;
    source: string | null; identity_basis: string | null; first_seen_at: string | null; created_at: string; visibility?: string };
  viewer?: { is_holder: boolean };
  declared?: Declared | null;
  market?: 'recorded' | 'none_public';
  image_url: string | null;
  lots: Lot[];
  history: Statement[];
  creation: Creation[];
  coverage: { presentations: number; statements: number; claims: number; sources: string[]; as_of: string };
};

const ATTRIBUTION_WORDS: Record<string, string> = {
  direct: 'by', after: 'after', attributed_to: 'attributed to', circle_of: 'circle of', school_of: 'school of', follower_of: 'follower of',
  manner_of: 'manner of', studio_of: 'studio of', workshop_of: 'workshop of', style_of: 'style of', none_printed: 'no maker printed',
};
const RESULT_WORDS: Record<string, string> = {
  sold: 'Sold', not_sold: 'Not sold', upcoming: 'Upcoming', 'bid-goes-on': 'Bid goes on', bid_goes_on: 'Bid goes on', unknown: 'Result unknown',
};
const TYPE_WORDS: Record<string, string> = { artwork: 'Artwork', automobilia: 'Automobilia', memorabilia: 'Memorabilia', publication: 'Publication' };
const IDENTITY_WORDS: Record<string, string> = {
  lot_presentation: 'one presentation at one house. The same object seen again at another sale is joined by supersession, never by overwriting.',
  holder_declaration: 'declared by its holder in their own words. Presentations, publications and sales attach to it as they are recorded.',
};
const BASIS_WORDS: Record<string, string> = {
  hammer: 'hammer, premium not included', highest_bid_or_price: "the house's highest bid or price", hammer_time: 'the hammer clock',
  sale_end: "the sale's end", index_read: 'when Nuke read the index',
};

export function money(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value.toLocaleString('en-US')} ${currency ?? ''}`.trim();
  }
}
const words = (table: Record<string, string>, key: string | null | undefined) => (key ? table[key] ?? key.replace(/_/g, ' ') : '');

/** The house's statement as a claim: the house is the source, the lot the pointer, the clock the one the reader typed. */
function lotClaim<T extends string | number>(lot: Lot, value: T): Claim<T> {
  return {
    value, source: { kind: 'listing', url: lot.url, id: lot.statement_id, label: lot.source.name ?? lot.source.slug ?? 'Auction house',
      lotNumber: lot.lot_number, auctionName: lot.sale_name ?? lot.sale_key, method: lot.observed_at_basis ? `clock: ${words(BASIS_WORDS, lot.observed_at_basis)}` : null },
    observed_at: lot.observed_at, trust: lot.source.trust ?? 0.5,
  };
}

/** The headline result of a presentation: the hammer when the house published one, else the high bid, else the estimate. */
export function headline(lot: Lot): { label: string; value: string } {
  if (lot.hammer_price) return { label: `${words(RESULT_WORDS, lot.result)} · ${lot.source.name ?? lot.source.slug ?? ''}`.replace(/ · $/, ''), value: money(lot.hammer_price, lot.currency) };
  if (lot.high_bid) return { label: `${words(RESULT_WORDS, lot.result)} · high bid`, value: money(lot.high_bid, lot.currency) };
  if (lot.estimate_low || lot.estimate_high) {
    const range = [lot.estimate_low, lot.estimate_high].filter((v): v is number => v != null).map(v => money(v, lot.currency)).join(' to ');
    return { label: `${words(RESULT_WORDS, lot.result)} · estimate`, value: range };
  }
  return { label: words(RESULT_WORDS, lot.result), value: 'no price stated' };
}

function Presentation({ lot, single }: { lot: Lot; single: boolean }) {
  const coverage: Coverage = { n: 1, of: 1, grain: 'statement', as_of: lot.landed_at };
  const head = headline(lot);
  const clock = `${day(lot.observed_at)}${lot.observed_at_basis ? ` · ${words(BASIS_WORDS, lot.observed_at_basis)}` : ''}`;
  return <Section title={single ? 'Presentation' : `Presentation · ${lot.source.name ?? lot.source.slug ?? ''}`} coverage={coverage} ariaLabel={`Presentation at ${lot.source.name ?? lot.source.slug ?? 'an auction house'}`}>
    <div className="ap-result">
      <Text role="label">{head.label}</Text>
      {lot.hammer_price ? <ClaimView claim={lotClaim(lot, lot.hammer_price)} role="figure" format={v => money(Number(v), lot.currency)} />
        : <Text role="figure">{head.value}</Text>}
      <Text role="caption">{clock}</Text>
    </div>
    <Rows title="As stated by the house">
      {lot.house_category && <Row label="Department">{lot.house_category}</Row>}
      {lot.house_group && <Row label="House group">{lot.house_group}</Row>}
      {(lot.sale_name || lot.sale_key) && <Row label={lot.sale_name ? 'Sale' : "Sale (the house's key)"}>{lot.sale_name ?? lot.sale_key}</Row>}
      {lot.lot_number && <Row label="Lot">{lot.lot_number}</Row>}
      {lot.sale_ends_at && <Row label="Sale ends">{day(lot.sale_ends_at)}</Row>}
      {(lot.estimate_low || lot.estimate_high) && <Row label="Estimate" role="measure">{[lot.estimate_low, lot.estimate_high].filter((v): v is number => v != null).map(v => money(v, lot.currency)).join(' to ')}</Row>}
      {lot.hammer_price && <Row label="Hammer" role="measure"><ClaimView claim={lotClaim(lot, lot.hammer_price)} format={v => money(Number(v), lot.currency)} /></Row>}
      {lot.hammer_premium && <Row label="With premium" role="measure">{money(lot.hammer_premium, lot.currency)}</Row>}
      {lot.high_bid && <Row label="High bid" role="measure">{money(lot.high_bid, lot.currency)}</Row>}
      {lot.price_basis && <Row label="Price basis" role="caption">{words(BASIS_WORDS, lot.price_basis)}</Row>}
      {lot.symbols && lot.symbols.length > 0 && <Row label="Symbols" role="caption">{lot.symbols.join(', ')}</Row>}
      {lot.country && <Row label="Country">{lot.country}</Row>}
      {lot.url && <Row label="Source" role="caption"><a className="ap-link" href={lot.url} target="_blank" rel="noopener noreferrer">{lot.source.name ?? lot.source.slug ?? 'the lot'}</a></Row>}
    </Rows>
    {lot.catalog_text && <div className="ap-printed"><Text role="label" as="h3">Catalogue entry</Text><Text role="body" as="p" className="ap-prose">{lot.catalog_text}</Text></div>}
    {foldNotes(lot.printed_sections ?? []).map((section, i) => <PrintedBlock key={`${lot.statement_id}-${i}`} section={section} />)}
  </Section>;
}

/** The house separates paragraphs of one note with blank lines; consecutive unheaded blocks are one note, headed blocks stand alone. */
export function foldNotes(sections: PrintedSection[]): PrintedSection[] {
  const out: PrintedSection[] = [];
  for (const section of sections) {
    const last = out[out.length - 1];
    if (!section.heading && last && !last.heading) last.lines = [...last.lines, ...section.lines];
    else out.push({ heading: section.heading ?? null, lines: [...section.lines] });
  }
  return out;
}

function PrintedBlock({ section }: { section: PrintedSection }) {
  const [open, setOpen] = useState(false);
  if (section.heading) {
    return <div className="ap-printed"><Text role="label" as="h3">{section.heading}</Text>
      <ol className="ap-chain">{section.lines.map((line, i) => <li key={i}><Text role="body">{line}</Text></li>)}</ol></div>;
  }
  const text = section.lines.join('\n\n');
  const long = text.length > 600;
  return <div className="ap-printed"><Text role="label" as="h3">The house's note</Text>
    <Text role="body" as="p" className="ap-prose">{open || !long ? text : `${text.slice(0, 600).trimEnd()}…`}</Text>
    {long && <button type="button" className="ap-more" aria-expanded={open} onClick={() => setOpen(v => !v)}><Text role="label">{open ? 'Show less' : 'Show the whole note'}</Text></button>}
  </div>;
}

function CreationBlock({ claims, lots }: { claims: Creation[]; lots: number }) {
  const named = claims.filter(c => c.party);
  const coverage: Coverage = { n: claims.length, of: lots, grain: 'presentation', as_of: claims[0]?.observed_at ?? null };
  return <Section title="Creation" coverage={coverage}>
    {named.length === 0 && <Text role="body" as="p" className="ap-prose">{claims.length ? 'The house printed no maker for this lot.' : 'No creation claim has been folded yet.'}</Text>}
    {named.map(c => <div key={c.claim_id} className="ap-party">
      <div className="ap-party__name">
        <Text role="caption">{words(ATTRIBUTION_WORDS, c.attribution)}</Text>
        <Text role="entity" dense as="h3">{c.party?.display_name ?? c.name_as_printed ?? ''}</Text>
        {c.qualifier_as_printed && <Text role="caption">{c.qualifier_as_printed}</Text>}
      </div>
      <Rows title="This party across Nuke">
        <Row label="Lots attributed directly" role="measure">{(c.party?.lots_direct ?? 0).toLocaleString('en-US')}</Row>
        <Row label="With a published hammer" role="measure">{(c.party?.priced_lots ?? 0).toLocaleString('en-US')}</Row>
        <Row label={c.party?.kind === 'user' ? 'The party' : 'Claimed by the artist or estate'} role="caption">{c.party?.kind === 'user' ? 'A Nuke user, declaring their own work' : c.party?.claimed ? 'Yes' : 'Not yet: the row is theirs to claim'}</Row>
        {c.executor?.name_as_printed && <Row label={`Executed by (${c.executor.role})`}>{`${c.executor.name_as_printed}${c.executor.qualifier_as_printed ? ` (${c.executor.qualifier_as_printed})` : ''}`}</Row>}
        <Row label="Claim source" role="caption">{`${c.source ?? 'the house'} · ${day(c.observed_at)} · ${c.layout === 'holder_declaration' ? "the holder's own declaration" : c.layout === 'name_colon_description' ? 'the name before the colon' : 'the first catalogue line'}`}</Row>
      </Rows>
    </div>)}
  </Section>;
}

function HistoryBlock({ statements }: { statements: Statement[] }) {
  const coverage: Coverage = { n: statements.length, of: statements.length, grain: 'statement', as_of: statements[statements.length - 1]?.landed_at ?? null };
  return <Section title="Every statement landed" coverage={coverage} ariaLabel="History of statements">
    <ol className="ap-history">{statements.map(s => <li key={s.statement_id} className={s.superseded ? 'ap-history__row ap-history__row--superseded' : 'ap-history__row'}>
      <Text role="caption">{day(s.observed_at)}</Text>
      <Text role="body">{`${words(RESULT_WORDS, s.result)}${s.hammer_price ? ` · ${money(s.hammer_price, s.currency)}` : s.high_bid ? ` · high bid ${money(s.high_bid, s.currency)}` : (s.estimate_low || s.estimate_high) ? ` · estimate ${[s.estimate_low, s.estimate_high].filter((v): v is number => v != null).map(v => money(v, s.currency)).join(' to ')}` : ''}`}</Text>
      <Text role="caption">{`${s.source ?? ''} · landed ${day(s.landed_at)}${s.superseded ? ' · superseded' : ' · current'}`}</Text>
    </li>)}</ol>
  </Section>;
}

export default function AssetProfilePage() {
  const { assetId } = useParams<{ assetId: string }>();
  const [profile, setProfile] = useState<AssetProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setProfile(undefined); setError(null);
    if (!assetId || !/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(assetId)) { setProfile(null); return; }
    supabase.rpc('asset_profile_read', { p_asset_id: assetId }).then(({ data, error: e }) => {
      if (!live) return;
      if (e) { setError(e.message); setProfile(null); } else setProfile((data as AssetProfile | null) ?? null);
    });
    return () => { live = false; };
  }, [assetId]);
  const title = profile?.asset.title ?? null;
  usePageTitle(() => (title ? title.slice(0, 80) : profile === null ? 'Asset not found' : 'Asset'));

  if (profile === undefined) return <main className="ap-page"><div role="status" className="ap-notice"><Text role="body">Reading the record…</Text></div></main>;
  if (profile === null) return <main className="ap-page"><div role="alert" className="ap-notice">
    <Text role="entity" as="h1">No such asset</Text>
    <Text role="body" as="p">{error ? `The record could not be read: ${error}` : 'Nothing public is recorded under this id.'}</Text></div></main>;

  const current = profile.lots[0] ?? null;
  const lines = current?.lines ?? [];
  const nameLine = profile.creation.find(c => c.party)?.party?.display_name ?? (lines.length >= 2 ? lines[0] : null);
  const titleLine = lines.length >= 3 ? lines.slice(2).join(' · ') : lines.length === 2 && nameLine ? lines[1] : profile.asset.title;
  const head = current ? headline(current) : null;
  const sources = profile.coverage.sources.filter(Boolean);

  return <main className="ap-page">
    <header className="ap-masthead">
      <div className="ap-masthead__identity">
        <Text role="caption">{`${words(TYPE_WORDS, profile.asset.asset_type)}${profile.asset.house_category ? ` · ${profile.asset.house_category} (the house's category)` : ''}`}</Text>
        {nameLine && <Text role="label" as="p" className="ap-masthead__name">{nameLine}</Text>}
        <Text role="entity" as="h1">{titleLine ?? profile.asset.title ?? 'Untitled'}</Text>
      </div>
      {head && current && <div className="ap-masthead__result">
        <Text role="label">{head.label}</Text>
        {current.hammer_price ? <ClaimView claim={lotClaim(current, current.hammer_price)} role="figure" format={v => money(Number(v), current.currency)} /> : <Text role="figure">{head.value}</Text>}
        <Text role="caption">{day(current.observed_at)}</Text>
      </div>}
      {!current && <div className="ap-masthead__result">
        <Text role="label">Market</Text>
        <Text role="measure">No public sale recorded</Text>
        <Text role="caption">a figure appears only when a house publishes one</Text>
      </div>}
    </header>
    {profile.declared && Object.keys(profile.declared).length > 0 && <Section title="As declared by the holder" coverage={{ n: 1, of: 1, grain: 'declaration', as_of: profile.asset.created_at }}>
      <Rows title="In the holder's words">
        {profile.declared.medium && <Row label="Medium">{profile.declared.medium}</Row>}
        {profile.declared.year && <Row label="Year">{profile.declared.year}</Row>}
        {profile.declared.dimensions && <Row label="Dimensions">{profile.declared.dimensions}</Row>}
        {profile.declared.edition && <Row label="Edition">{profile.declared.edition}</Row>}
        {profile.asset.visibility && <Row label="Visibility" role="caption">{profile.asset.visibility}</Row>}
      </Rows>
      {profile.declared.notes && <div className="ap-printed"><Text role="label" as="h3">Notes</Text><Text role="body" as="p" className="ap-prose">{profile.declared.notes}</Text></div>}
    </Section>}
    {profile.image_url && <figure className="ap-figure">
      <img src={profile.image_url} alt={profile.asset.title ?? 'The lot as photographed by the house'} width={1200} height={900} loading="eager" decoding="async" />
      <figcaption><Text role="caption">{`The house's photograph${current?.source.name ? ` · ${current.source.name}` : ''}`}</Text></figcaption>
    </figure>}
    <CreationBlock claims={profile.creation} lots={profile.coverage.presentations} />
    {profile.lots.map(lot => <Presentation key={lot.statement_id} lot={lot} single={profile.lots.length === 1} />)}
    <HistoryBlock statements={profile.history} />
    <footer className="ap-footer">
      <Text role="caption">{`Nuke holds ${profile.coverage.presentations.toLocaleString('en-US')} presentation${profile.coverage.presentations === 1 ? '' : 's'}, ${profile.coverage.statements.toLocaleString('en-US')} statement${profile.coverage.statements === 1 ? '' : 's'} and ${profile.coverage.claims.toLocaleString('en-US')} creation claim${profile.coverage.claims === 1 ? '' : 's'} for this asset${sources.length ? ` from ${sources.join(', ')}` : ''} · as of ${day(profile.coverage.as_of)}.`}</Text>
      <Text role="caption">{`Identity: ${IDENTITY_WORDS[profile.asset.identity_basis ?? ''] ?? profile.asset.identity_basis ?? 'as recorded'}`}</Text>
    </footer>
  </main>;
}
