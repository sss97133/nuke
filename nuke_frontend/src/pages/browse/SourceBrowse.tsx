/**
 * SourceBrowse — /browse?source=<slug>[&make=<make>[&model=<model>]]: one source's own holdings, three levels deep
 * (makes, then models, then listings), from one typed read (browse_source_read) under one clock. The reader's as_of is
 * the page's clock; holdings.folded_at dates the daily count under every number. The page composes the kit and sets no
 * type of its own, and species, not names, choose its words (labelsFor). Counts here are this source's listings on
 * public vehicles with a make and a model, not a make's sales anywhere else; the Sources board counts something else
 * (the source's lots matched to Nuke's own collection list), and the live count of the last 24 hours is of every row
 * recorded, on a public vehicle or not, so each is worded as a count of its own and never as a part of another. The page
 * shows no median price: one over every model year and listing date of a source mixes different cars (owner, 2026-10-16:
 * "median doesnt matter"), so price discovery is the card sort at the last level. Its words are a visitor's: the daily
 * count is "counted", a row is a listing, lot or post, and the species is a hover. A new order of the same listings keeps
 * the cards and the sort control where they are (the cards dimmed, the grid marked busy) until the new order lands, so
 * keyboard focus is not lost.
 */
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CoverageView, Masthead, Text, day, type Coverage } from '../../kit';
import { resolveSourceLogo } from '../../kit/Claim';
import { PrefetchLink } from '../../components/PrefetchLink';
import { MakeLogo } from '../../components/common/MakeIdentity';
import { useViewHistory } from '../../hooks/useViewHistory';
import { sourceLogoInk } from '../market/sourceLogoInk';
import {
  PAGE_SIZE, SORTS, agree, appendRows, counted, labelsFor, priceLine, readSourceBrowse, statusLabel, totalHow, yearOfClock, yearSpan,
  type ListingRow, type SourceBoard, type SourceBrowseRead, type SourceHoldings, type SourceLabels, type SourceSort, type Tally, type TopModel,
} from './sourceBrowseRead';
import './SourceBrowse.css';

const enc = encodeURIComponent;
const num = (v: number) => v.toLocaleString('en-US');
/** A category the way a visitor reads it: "social_media" is "Social media"; null when the source has none. */
const plainKind = (category: string | null): string | null => {
  const words = category?.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
};
/**
 * "412 listings recorded from this source in the last 24 hours, whether or not they are counted above". The live count is of
 * every row Nuke recorded from the source, on a public vehicle with a make and a model or not, while the figure above it
 * is the daily count of the ones that are, so it is never a part of that figure and is never worded as one.
 */
const recordedToday = (n: number, noun: string): string => `${num(n)} ${agree(n, noun)} recorded from this source in the last 24 hours, whether or not they are counted above`;

const BOARD_NOTE = "The board counts the source's lots matched to Nuke's collection list. This page counts every listing the source put on a public vehicle with a make and a model.";
const RECORDED_NOTE = 'The days Nuke recorded these listings. The listings themselves can be older.';
const ARCHIVE_NOTE = 'Pages the source no longer serves, read from an internet archive';

/**
 * The source's own total, how it was measured, how sure that is and when. A count: "of 270,391 the source lists · counted
 * from its own listings · 98% confidence · Oct 17, 2026". An estimate says so, and that it is not a count: "an estimate of
 * 80,000 (a reference figure, not a count) · 40% confidence · Oct 17, 2026". A method this page has no words for is never
 * printed, and its total is not worded as a count. A part the board does not know is left out; null when it has no total.
 */
function populationText(board: SourceBoard | null): string | null {
  if (!board || board.population === null) return null;
  const n = num(board.population);
  const how = totalHow(board.population_method);
  return [
    how === null ? `a total of ${n}, unknown whether counted or estimated` : how.count ? `of ${n} the source lists` : `an estimate of ${n} (${how.words})`,
    how?.count ? how.words : null,
    board.population_confidence !== null ? `${Math.round(board.population_confidence * 100)}% confidence` : null,
    board.population_at ? day(board.population_at) : null,
  ].filter(Boolean).join(' · ');
}

/** A registered source that holds no public listing yet but has a count on the Sources board: the board's number is all there is to show. */
const boardOnly = (read: SourceBrowseRead): SourceBoard | null =>
  read.status === 'ok' && read.holdings.episodes === 0 ? read.holdings.board : null;

/**
 * A read that landed. `key` is the page and the order it answers, `place` the page alone (source, make, model). `outdated`
 * marks rows kept on screen while the same page is read in another order. `note` is said to a screen reader, out of sight:
 * what the last More added, or that a new order has landed.
 */
type Ready = { key: string; place: string; phase: 'ready'; outdated: boolean; read: SourceBrowseRead; rows: ListingRow[]; page: number; total: number; note: string };
type View = { key: string; place: string; phase: 'loading' } | { key: string; place: string; phase: 'error' } | Ready;
type MoreState = 'idle' | 'busy' | 'failed';

// MARK: - Identity: who the source is and what it holds

function Identity({ read }: { read: SourceBrowseRead }) {
  const { source, holdings, status } = read;
  const [logoFailed, setLogoFailed] = useState(false);
  if (status === 'unknown_source') {
    return <Masthead result={<PrefetchLink to="/sources" className="sb-link"><Text role="label">All sources</Text></PrefetchLink>}>
      <div className="sb-identity__text">
        <Text role="entity" as="h1">Nothing to browse</Text>
        <Text role="body" as="div">{`Only market sources have a browse page: auction houses, dealers, classifieds, marketplaces and aggregators. Nothing is published under ${source.slug}.`}</Text>
      </div>
    </Masthead>;
  }
  const labels = labelsFor(read);
  const logo = source.logo_url ?? resolveSourceLogo(source.name, source.base_url);
  const ink = sourceLogoInk(logo);
  const kind = plainKind(source.category);
  const board = holdings.board;
  const onlyBoard = boardOnly(read);
  const population = populationText(board);
  // The source's own total, with the way it was measured; "unknown" when no one has measured it.
  const total = population
    ? <Text role="caption" as="div" title={`How many ${labels.noun} the source has in all, how Nuke got that number, how sure Nuke is of it (its confidence), and the day it was measured. An estimate is not a count.`}>{population}</Text>
    : <Text role="caption" as="div" title={`How many ${labels.noun} the source has in all. This page does not have that figure.`}>source total unknown</Text>;
  let result: React.ReactNode;
  if (status !== 'ok') {
    result = <Text role="body" as="div">{`Nuke has not counted this source's ${labels.noun} yet. It counts once a day.`}</Text>;
  } else if (onlyBoard) {
    result = <>
      <Text role="label" as="div">{`${agree(onlyBoard.lots, labels.noun)} on the Sources board`}</Text>
      <Text role="figure" as="div">{num(onlyBoard.lots)}</Text>
      <Text role="caption" as="div" title={BOARD_NOTE}>{`board count · ${day(onlyBoard.day)}`}</Text>
      {total}
    </>;
  } else {
    result = <>
      <Text role="label" as="div">{labels.held}</Text>
      <Text role="figure" as="div">{num(holdings.episodes)}</Text>
      <Text role="caption" as="div" title="Nuke counts each source once a day">{holdings.folded_at ? `counted ${day(holdings.folded_at)}` : 'count date unknown'}</Text>
      {total}
      {board && <Text role="caption" as="div" title={BOARD_NOTE}>{`Sources board counts ${num(board.lots)} ${agree(board.lots, labels.noun)} matched to Nuke's own list · ${day(board.day)}`}</Text>}
      {holdings.landed_24h > 0 && <Text role="caption" as="div">{recordedToday(holdings.landed_24h, labels.noun)}</Text>}
    </>;
  }
  return <>
    <Masthead result={result}>
      <div className="sb-identity">
        {logo && !logoFailed && <img className={`sb-logo${ink ? ` sb-logo--${ink}` : ''}`} src={logo} alt={`${source.name} logo`}
          width="64" height="32" onError={() => setLogoFailed(true)} />}
        <div className="sb-identity__text">
          <Text role="entity" as="h1">{source.name}</Text>
          {kind && <Text role="caption" as="div" title={source.species_label ?? undefined}>{kind}</Text>}
        </div>
      </div>
    </Masthead>
    {onlyBoard && <div className="sb-state"><Text role="body">No listing recorded under this name is on a public vehicle with a make and a model, so there is nothing to browse here.</Text></div>}
  </>;
}

// MARK: - Where you are

function Crumbs({ read, labels, inScope }: { read: SourceBrowseRead; labels: SourceLabels; inScope: number }) {
  const { source, scope, holdings } = read;
  const base = `/browse?source=${enc(source.slug)}`;
  const trail: Array<{ label: string; to?: string }> = [
    { label: 'Sources', to: '/sources' },
    { label: source.name, to: scope.make ? base : undefined },
  ];
  if (scope.make) trail.push({ label: scope.make, to: scope.model ? `${base}&make=${enc(scope.make)}` : undefined });
  if (scope.make && scope.model) trail.push({ label: scope.model });
  const places = trail.map((crumb, i) => <React.Fragment key={`${i}:${crumb.label}`}>
    {i > 0 && <Text role="caption" aria-hidden>/</Text>}
    {crumb.to
      ? <PrefetchLink to={crumb.to} className="sb-crumb"><Text role="label">{crumb.label}</Text></PrefetchLink>
      : <span className="sb-crumb sb-crumb--here" aria-current="page"><Text role="label">{crumb.label}</Text></span>}
  </React.Fragment>);
  // The trail is a navigation landmark, the kit strip's own markup as a nav. At the first level everything the source holds
  // is in scope, so the only fraction is n of n, which says nothing: the trail stands without one there, and the masthead
  // states the count, its date and the source's own total. Below it the strip ends with n of N in the source's unit.
  return <div className="sb-scope">
    <nav className="k-section k-strip" aria-label="Where you are">
      {places}
      {scope.make && <CoverageView c={{ n: inScope, of: holdings.episodes, grain: labels.noun, as_of: holdings.folded_at }} className="k-strip__coverage" />}
    </nav>
  </div>;
}

// MARK: - What the source carries (the source as a whole, shown at the first level)

type Block = { label: string; value: string; cover?: Coverage };
type Part = { key: string; text: string; title?: string };

/** The history line, in order, each part only when known. The first part opens the line, so it takes the capital. */
function historyParts(h: SourceHoldings, noun: string): Part[] {
  const parts: Part[] = [];
  const from = yearOfClock(h.dated_min);
  const to = yearOfClock(h.dated_max);
  if (from !== null && to !== null) parts.push({ key: 'dated', text: `Listings dated ${yearSpan(from, to)}` });
  const years = yearSpan(h.year_min, h.year_max);
  if (years) parts.push({ key: 'years', text: `model years ${years}` });
  if (h.archived > 0) {
    const copies = h.archived === 1 ? "a saved copy of the source's page" : "saved copies of the source's pages";
    parts.push({ key: 'archived', text: `${num(h.archived)} of ${num(h.episodes)} ${agree(h.episodes, noun)} read from ${copies}`, title: ARCHIVE_NOTE });
  }
  // first_seen and last_seen are the days Nuke recorded these listings, not the days the listings ran.
  if (h.first_seen) parts.push({ key: 'first', text: `first recorded ${day(h.first_seen)}`, title: RECORDED_NOTE });
  if (h.last_seen) parts.push({ key: 'last', text: `last recorded ${day(h.last_seen)}`, title: RECORDED_NOTE });
  return parts.map((p, i) => (i === 0 ? { ...p, text: p.text.charAt(0).toUpperCase() + p.text.slice(1) } : p));
}

function Carries({ read, labels }: { read: SourceBrowseRead; labels: SourceLabels }) {
  const h = read.holdings;
  if (h.episodes === 0) return null;
  // Every status block is n of all of the source's listings, in its own noun, on the day of the count it was read from.
  const share = (n: number): Coverage => ({ n, of: h.episodes, grain: agree(h.episodes, labels.noun), as_of: h.folded_at });
  // Plain blocks, not kit Measures: a Measure with no rank prints "unranked · 0 peers", which says nothing here.
  const blocks: Block[] = [];
  if (h.sold > 0) blocks.push({ label: 'Sold', value: num(h.sold), cover: share(h.sold) });
  // Live as of the day's count, and for a listing with no end clock only as of the last time its row was written: never "now".
  if (h.active > 0) blocks.push({ label: 'Live at last check', value: num(h.active), cover: share(h.active) });
  if (h.upcoming > 0) blocks.push({ label: 'Upcoming', value: num(h.upcoming), cover: share(h.upcoming) });
  if (h.ended > 0) blocks.push({ label: 'Ended', value: num(h.ended), cover: share(h.ended) });
  if (h.unknown > 0) blocks.push({ label: 'Status not recorded', value: num(h.unknown), cover: share(h.unknown) });
  if (h.vehicles > 0) blocks.push({ label: 'With photos', value: num(h.with_image), cover: { n: h.with_image, of: h.vehicles, grain: 'vehicles', as_of: h.folded_at } });
  blocks.push({ label: 'Makes', value: num(h.makes) }, { label: 'Models', value: num(h.models) });
  const history = historyParts(h, labels.noun);
  // Not the kit Section: its head always prints a coverage, and the only one here would be n of n. Each block carries its own.
  return <Body title="What this source carries" line={null}>
    <div className="sb-measures">
      {blocks.map(b => <div key={b.label} className="sb-measure" role="group" aria-label={b.label}>
        <Text role="label">{b.label}</Text>
        <Text role="measure">{b.value}</Text>
        {b.cover && <CoverageView c={b.cover} />}
      </div>)}
    </div>
    {history.length > 0 && <div className="sb-note sb-history">
      {history.map((p, i) => <React.Fragment key={p.key}>
        {i > 0 && <Text role="caption">{' · '}</Text>}
        <Text role="caption" title={p.title}>{p.text}</Text>
      </React.Fragment>)}
    </div>}
  </Body>;
}

// MARK: - Makes and models: a cell per group

function Cell({ to, name, emblemOf, tally, labels, top }: {
  to: string; name: string; emblemOf?: string; tally: Tally; labels: SourceLabels; top?: TopModel[];
}) {
  const years = yearSpan(tally.year_min, tally.year_max);
  return <PrefetchLink to={to} className="sb-cell">
    <span className="sb-cell__name">
      {emblemOf && <MakeLogo make={emblemOf} />}
      <Text role="entity" dense title={name}>{name}</Text>
    </span>
    <span className="sb-cell__count">
      <Text role="measure" dense>{num(tally.episodes)}</Text>
      <Text role="caption">{agree(tally.episodes, labels.noun)}</Text>
    </span>
    {tally.sold > 0 && <Text role="caption">{`${num(tally.sold)} sold`}</Text>}
    {years && <Text role="caption">{years}</Text>}
    {top && top.length > 0 && <ul className="sb-top" aria-label={`Top models of ${name}`}>
      {top.slice(0, 3).map(t => <li key={t.model}><Text role="label">{t.model}</Text><Text role="measure" dense>{num(t.episodes)}</Text></li>)}
    </ul>}
  </PrefetchLink>;
}

function FilterBox({ value, onChange, what }: { value: string; onChange: (v: string) => void; what: string }) {
  return <div className="sb-controls">
    <input className="sb-input k-body" type="text" value={value} aria-label={`Filter ${what}`} placeholder={`Filter ${what}`}
      onChange={e => onChange(e.target.value)} />
  </div>;
}

/** A grid's frame: its name and how much of it is shown. The strip above already carries the scope's coverage. */
function Body({ title, line, children }: { title: string; line: string | null; children: React.ReactNode }) {
  return <section className="sb-body" aria-label={title}>
    <div className="sb-head">
      <Text role="label" as="h2">{title}</Text>
      {line && <Text role="caption">{line}</Text>}
    </div>
    {children}
  </section>;
}

function MakesLevel({ read, labels }: { read: SourceBrowseRead; labels: SourceLabels }) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const rows = useMemo(() => (q ? read.makes.filter(r => r.make.toLowerCase().includes(q)) : read.makes), [read.makes, q]);
  const held = rows.reduce((sum, r) => sum + r.episodes, 0);
  const slug = enc(read.source.slug);
  const line = read.makes.length === 0 ? null
    : q ? `${num(rows.length)} of ${num(read.makes.length)} makes matching “${filter.trim()}” · ${num(held)} of ${num(read.holdings.episodes)} ${labels.noun}`
      : counted(rows.length, 'makes');
  return <Body title="Makes" line={line}>
    {read.makes.length > 0 && <FilterBox value={filter} onChange={setFilter} what="makes" />}
    {rows.length > 0 && <div className="sb-grid">
      {rows.map(r => <Cell key={r.make} to={`/browse?source=${slug}&make=${enc(r.make)}`} name={r.make} emblemOf={r.make} tally={r} labels={labels} top={r.top_models} />)}
    </div>}
    {read.makes.length === 0 && <Text role="body" as="div" className="sb-note">No vehicles are recorded for this source yet.</Text>}
    {read.makes.length > 0 && rows.length === 0 && <Text role="body" as="div" className="sb-note">{`No make matches “${filter.trim()}”.`}</Text>}
  </Body>;
}

function ModelsLevel({ read, labels }: { read: SourceBrowseRead; labels: SourceLabels }) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const make = read.scope.make ?? '';
  const rows = useMemo(() => (q ? read.models.filter(r => r.model.toLowerCase().includes(q)) : read.models), [read.models, q]);
  const held = rows.reduce((sum, r) => sum + r.episodes, 0);
  const all = read.models.reduce((sum, r) => sum + r.episodes, 0);
  const slug = enc(read.source.slug);
  const line = read.models.length === 0 ? null
    : q ? `${num(rows.length)} of ${num(read.models.length)} models matching “${filter.trim()}” · ${num(held)} of ${num(all)} ${labels.noun}`
      : `${counted(rows.length, 'models')} · ${counted(held, labels.noun)}`;
  return <Body title={`${make} models`} line={line}>
    {read.models.length > 0 && <FilterBox value={filter} onChange={setFilter} what={`${make} models`} />}
    {rows.length > 0 && <div className="sb-grid">
      {rows.map(r => <Cell key={r.model} to={`/browse?source=${slug}&make=${enc(make)}&model=${enc(r.model)}`} name={r.model} tally={r} labels={labels} />)}
    </div>}
    {read.models.length === 0 && <Text role="body" as="div" className="sb-note">
      {`This source holds no ${make} models. `}<PrefetchLink to={`/browse?source=${slug}`} className="sb-link">All makes</PrefetchLink>
    </Text>}
    {read.models.length > 0 && rows.length === 0 && <Text role="body" as="div" className="sb-note">{`No ${make} model matches “${filter.trim()}”.`}</Text>}
  </Body>;
}

// MARK: - Listings: a card per listing

function ListingCard({ row, labels, asOf, onOpen }: { row: ListingRow; labels: SourceLabels; asOf: string | null; onOpen: (id: string) => void }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const titleId = useId();
  const title = [row.year, row.make, row.model].filter(Boolean).join(' ') || 'Vehicle';
  const price = priceLine(row, labels);
  const clock = asOf ? Date.parse(asOf) : Date.now();
  const listedAt = row.listed_at ? Date.parse(row.listed_at) : NaN;
  const endsAt = row.ends_at ? Date.parse(row.ends_at) : NaN;
  // "Listed" is the seller's own day, which the reader sends only when the source recorded one; for a lot still to come it
  // is the day the sale starts. Without it the card says when the listing was first recorded, and says that, so the day we
  // captured it never passes for the day it was listed. A listing alive by the source's word with no end clock is alive only
  // as of the last time its row was written, so the card says when that was.
  const starts = row.status === 'upcoming' && Number.isFinite(listedAt) && listedAt > clock;
  const when = [
    row.listed_at ? `${starts ? 'Starts' : 'Listed'} ${day(row.listed_at)}` : row.recorded_at ? `First recorded ${day(row.recorded_at)}` : null,
    row.ends_at ? `${Number.isFinite(endsAt) && endsAt > clock ? 'Ends' : 'Ended'} ${day(row.ends_at)}` : null,
    row.status === 'active' && !row.ends_at && row.checked_at ? `last checked ${day(row.checked_at)}` : null,
  ].filter(Boolean).join(' · ');
  // The price line already says "Sold" when it carries what it sold for.
  const where = [row.sold_price !== null && row.status === 'sold' ? null : statusLabel(row), row.location].filter(Boolean).join(' · ');
  // A listing read from a saved copy of its page opens that copy: the live address is the one the source no longer serves.
  const open = row.archive_url ? { href: row.archive_url, words: 'Open the saved page' }
    : row.listing_url ? { href: row.listing_url, words: 'Open the listing' } : null;
  // The title beside the photo names the card, so the photo adds nothing to say and its alt is empty.
  return <article className="sb-card" aria-labelledby={titleId}>
    <PrefetchLink to={`/vehicle/${enc(row.vehicle_id)}`} className="sb-card__main" onClick={() => onOpen(row.vehicle_id)}>
      {row.image_url && !photoFailed
        ? <img className="sb-card__photo" src={row.image_url} alt="" width="240" height="180" loading="lazy" onError={() => setPhotoFailed(true)} />
        : <span className="sb-card__blank"><Text role="label">no photo</Text></span>}
      <span className="sb-card__body">
        <Text role="entity" dense id={titleId}>{title}</Text>
        {price ? <Text role="measure" dense>{price}</Text> : <Text role="caption">No price shown</Text>}
        {where && <Text role="caption" className="sb-clip" title={where}>{where}</Text>}
        {when && <Text role="caption">{when}</Text>}
      </span>
    </PrefetchLink>
    {open && <a className="sb-card__link" href={open.href} target="_blank" rel="noreferrer noopener" aria-label={`${open.words}: ${title}`}>
      <Text role="caption">{open.words}</Text>
    </a>}
  </article>;
}

function ListingsLevel({ read, labels, rows, total, page, sort, onSort, moreState, onMore, refreshing }: {
  read: SourceBrowseRead; labels: SourceLabels; rows: ListingRow[]; total: number; page: number; sort: SourceSort;
  onSort: (s: SourceSort) => void; moreState: MoreState; onMore: () => void;
  /** The cards are of the order before this one: the new order is being read. */
  refreshing: boolean;
}) {
  const { recordView } = useViewHistory();
  const what = [read.scope.make, read.scope.model].filter(Boolean).join(' ');
  // The total is the daily count, and each page is re-joined to the vehicles that are public now, so a page can come back
  // short and the rows shown can stay under the total for good. The pages read say when there is nothing more to ask for.
  const unread = rows.length < total && page * read.listings.page_size < total;
  const grid = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  // More is never disabled while it reads (a disabled button cannot keep focus), only marked so and ignored. If it retires
  // while it has focus, focus goes to the first card it added, so a keyboard user is not sent back to the top of the page.
  const refocus = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (moreState === 'busy') return;
    const at = refocus.current;
    refocus.current = null;
    if (at === null || unread) return;
    grid.current?.querySelectorAll<HTMLElement>('a.sb-card__main')[Math.min(at, rows.length - 1)]?.focus();
  }, [moreState, rows.length, unread]);
  const pressMore = () => {
    if (moreState === 'busy' || refreshing) return;
    refocus.current = document.activeElement === moreButton.current ? rows.length : null;
    onMore();
  };
  return <Body title={what} line={`showing ${num(rows.length)} of ${num(total)}`}>
    <div className="sb-controls">
      <label className="sb-sort">
        <Text role="label">Sort</Text>
        <select className="sb-input k-body" value={sort} onChange={e => onSort(SORTS.find(s => s.value === e.target.value)?.value ?? 'newest')}>
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
    </div>
    {rows.length > 0
      ? <div ref={grid} className={`sb-grid sb-grid--cards${refreshing ? ' sb-grid--busy' : ''}`} aria-busy={refreshing}>
        {rows.map((row, i) => <ListingCard key={`${i}:${row.vehicle_id}`} row={row} labels={labels} asOf={read.as_of} onOpen={id => recordView(id, 'browse')} />)}
      </div>
      : <Text role="body" as="div" className="sb-note">{`This source holds no ${what} ${labels.noun}. `}
        <PrefetchLink to={`/browse?source=${enc(read.source.slug)}&make=${enc(read.scope.make ?? '')}`} className="sb-link">All {read.scope.make} models</PrefetchLink></Text>}
    {unread && <div className="sb-more">
      <button ref={moreButton} type="button" className="btn-base btn-sm btn-secondary" aria-disabled={moreState === 'busy' || refreshing} onClick={pressMore}>
        <Text role="label">{moreState === 'busy' ? 'Reading…' : 'More'}</Text>
      </button>
      {moreState === 'failed' && <span role="alert"><Text role="caption">The next page could not be read.</Text></span>}
    </div>}
  </Body>;
}

// MARK: - The page: one read, one scope

export default function SourceBrowse({ source, make, model }: { source: string; make?: string | null; model?: string | null }) {
  const scopeMake = make?.trim() || null;
  const scopeModel = scopeMake ? model?.trim() || null : null;
  const [sort, setSort] = useState<SourceSort>('newest');
  // Only the listings level has an order to choose; the others read the same way whatever was chosen before.
  const readSort: SourceSort = scopeMake && scopeModel ? sort : 'newest';
  const place = [source, scopeMake ?? '', scopeModel ?? ''].join('\u0001');
  const key = `${place}\u0001${readSort}`;
  const [view, setView] = useState<View>({ key, place, phase: 'loading' });
  const [anchor, setAnchor] = useState<{ source: string; read: SourceBrowseRead } | null>(null);
  const [moreState, setMoreState] = useState<MoreState>('idle');
  const [attempt, setAttempt] = useState(0);
  const requests = useRef(0);

  // Every read belongs to the newest request; an older answer, or one that lands after unmount, is dropped. The same page
  // read in another order keeps its cards, marked outdated, until the new order lands; any other page starts empty.
  useEffect(() => {
    const mine = ++requests.current;
    setView(v => (v.phase === 'ready' && v.place === place ? { ...v, outdated: true } : { key, place, phase: 'loading' }));
    setMoreState('idle');
    readSourceBrowse({ source, make: scopeMake, model: scopeModel, page: 1, pageSize: PAGE_SIZE, sort: readSort })
      .then(read => {
        if (requests.current !== mine) return;
        setAnchor({ source, read });
        setView(v => {
          // A new order that lands on the cards of the order before says so, since nothing else tells a screen reader it has.
          const sorted = v.phase === 'ready' && v.place === place && v.outdated;
          const note = sorted ? `Sorted by ${SORTS.find(s => s.value === readSort)?.label ?? readSort}, showing ${num(read.listings.rows.length)} of ${num(read.listings.total)}` : '';
          return { key, place, phase: 'ready', outdated: false, read, rows: read.listings.rows, page: 1, total: read.listings.total, note };
        });
      })
      .catch(() => { if (requests.current === mine) setView({ key, place, phase: 'error' }); });
    return () => { requests.current += 1; };
  }, [key, place, source, scopeMake, scopeModel, readSort, attempt]);

  // What the page shows: the read of this page in this order, else, while that is read, the same page in the order before.
  const settled = view.key === key && !(view.phase === 'ready' && view.outdated);
  const current: View = settled ? view : { key, place, phase: 'loading' };
  const ready = current.phase === 'ready' ? current : null;
  const kept = !ready && view.phase === 'ready' && view.place === place ? view : null;
  const shown = ready ?? kept;
  const loading = current.phase === 'loading';
  const frame = shown?.read ?? (anchor && anchor.source === source ? anchor.read : null);

  const more = () => {
    if (!ready || moreState === 'busy') return;
    const mine = requests.current;
    const nextPage = ready.page + 1;
    setMoreState('busy');
    readSourceBrowse({ source, make: scopeMake, model: scopeModel, page: nextPage, pageSize: PAGE_SIZE, sort: readSort })
      .then(next => {
        if (requests.current !== mine) return;
        setView(v => {
          if (v.phase !== 'ready' || v.key !== key) return v;
          const rows = appendRows(v.rows, next.listings.rows);
          // A page with nothing on it is the end of what can be shown, whatever the count said: what is shown is the total.
          // A count that shrank between two pages never reads under the rows already shown.
          const total = next.listings.rows.length === 0 ? rows.length : Math.max(next.listings.total, rows.length);
          const added = rows.length - v.rows.length;
          const noun = labelsFor(v.read).noun;
          const note = `${added > 0 ? `${num(added)} more ${agree(added, noun)}` : `No new ${noun}`}, showing ${num(rows.length)} of ${num(total)}`;
          return { ...v, rows, page: nextPage, total, note };
        });
        setMoreState('idle');
      })
      .catch(() => { if (requests.current === mine) setMoreState('failed'); });
  };

  // A new scope is a new page: it opens at the top, not wherever the last one was scrolled to.
  useEffect(() => { if (window.scrollY > 0) window.scrollTo(0, 0); }, [source, scopeMake, scopeModel]);

  // The tab says what the page is about, and gives the old title back when the page goes.
  const named = frame && frame.status === 'ok' ? frame.source.name : null;
  useEffect(() => {
    if (!named) return;
    const before = document.title;
    document.title = `${[scopeModel, scopeMake, named].filter(Boolean).join(' · ')} | Nuke`;
    return () => { document.title = before; };
  }, [named, scopeMake, scopeModel]);

  // The loading line names the source only when an earlier read did; a slug from the address bar is never a name.
  const reading = frame && frame.status !== 'unknown_source' && frame.source.name !== frame.source.slug ? frame.source.name : null;

  const labels = shown ? labelsFor(shown.read) : null;
  const inScope = !shown ? 0 : shown.read.level === 'listings' ? shown.total
    : shown.read.level === 'models' ? shown.read.models.reduce((sum, r) => sum + r.episodes, 0) : shown.read.holdings.episodes;

  // One status region for the life of the page, so a line put into it is announced: the visible reading line, or, out of
  // sight, what the last More added. Only the content region is ever marked busy, never an ancestor of the status.
  return <div className="sb-page">
    {frame && <Identity key={frame.source.slug} read={frame} />}
    <div role="status">
      {loading && !kept && <div className="sb-state"><Text role="caption">{reading ? `Reading ${reading}…` : 'Reading…'}</Text></div>}
      {ready && ready.note && <span className="sb-sr">{ready.note}</span>}
    </div>
    {current.phase === 'error' && <div className="sb-state" role="alert">
      <Text role="body">Source holdings could not be read.</Text>
      <button type="button" className="btn-base btn-sm btn-secondary" onClick={() => setAttempt(a => a + 1)}><Text role="label">Try again</Text></button>
    </div>}
    <div className="sb-content" aria-busy={loading && !kept}>
      {shown && labels && shown.read.status === 'ok' && <>
        <Crumbs read={shown.read} labels={labels} inScope={inScope} />
        {shown.read.level === 'makes' && <>
          <Carries read={shown.read} labels={labels} />
          {!boardOnly(shown.read) && <MakesLevel read={shown.read} labels={labels} />}
        </>}
        {shown.read.level === 'models' && <ModelsLevel key={shown.read.scope.make ?? ''} read={shown.read} labels={labels} />}
        {shown.read.level === 'listings' && <ListingsLevel key={`${shown.read.scope.make}|${shown.read.scope.model}`} read={shown.read} labels={labels}
          rows={shown.rows} total={shown.total} page={shown.page} sort={sort} onSort={setSort} moreState={moreState} onMore={more} refreshing={kept !== null} />}
      </>}
    </div>
  </div>;
}
