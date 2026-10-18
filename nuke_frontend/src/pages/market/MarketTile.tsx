import React from 'react';
import { moveFill, moveText, moveTextShort, pct, textWidth, tileClass, tileName, GATE_MIN, type Baseline, type Callout, type Move } from './mapScale';
import { venueOf } from './FamilySalesChart';
import './MarketMap.css';

/**
 * A tile of the market map, its card and its legend (map design study, 2026-10-15). The fill is the tile's Bring a
 * Trailer move relative to BaT overall (mapScale); a tile with too few BaT sales is hatched and shows its count, a tile
 * with none is blank; the name is centered, sized to the tile and whole, or left out; hover keeps the fill.
 */
export interface MarketNode {
  name: string;
  count: number;
  usd?: number | null;
  sold_any?: number | null;
  offered?: number | null;
  dated?: number | null;
  sold_12m?: number | null;
  sold_prior_12m?: number | null;
  usd_12m?: number | null;
  usd_prior_12m?: number | null;
  familyKey?: string;
  models?: number | null;
}

const num = (n: number) => n.toLocaleString('en-US');
export const money = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '')}M`
  : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
const countShort = (n: number) => n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;

/** The tile's lines that fit whole: the name, the move (shortened to the percentage when the full form is too wide)
 *  and, on large tiles, the ledger figures the tile's area is drawn from. */
export type MapBasis = 'bat12' | 'ledger';

export function tileLines(node: MarketNode, move: Move, w: number, h: number, basis: MapBasis = 'bat12') {
  const cls = tileClass(w, h);
  const named = tileName(node.name, w, h);
  if (named == null) return { cls, name: '', nameSize: null, moveSize: 0, move: '', stat: '' };
  const nameSize = named.size;
  const room = w - 12;
  const moveSize = Math.max(10, Math.round(nameSize * 0.75));
  const full = moveText(move);
  const short = moveTextShort(move);
  const moveLine = [full, short].find((t) => t && textWidth(t) * moveSize <= room) ?? '';
  // The figures the tile's area is drawn from: BaT's last 12 months, or every venue and year.
  const usd = basis === 'bat12' ? node.usd_12m : node.usd;
  const sold = basis === 'bat12' ? node.sold_12m : node.count;
  let stat = '';
  if ((cls === 'XL' || cls === 'L') && usd && sold != null) {
    const statSize = cls === 'XL' ? 12 : 11;
    const forms = cls === 'XL' ? [`${money(usd)} · ${num(sold)} sold`, `${money(usd)} · ${countShort(sold)} sold`, money(usd)]
      : [`${countShort(sold)} sold`];
    stat = forms.find((t) => t.length * statSize * 0.6 <= room) ?? '';
  }
  return { cls, name: named.text, nameSize, moveSize, move: moveLine, stat };
}

export function tileFill(move: Move): string {
  return move.kind === 'move' ? moveFill(move.rel) : move.kind === 'few' ? 'var(--map-4)' : 'var(--map-none)';
}

interface TileProps {
  node: MarketNode;
  move: Move;
  basis: MapBasis;
  x: number;
  y: number;
  w: number;
  h: number;
  onClick: (e: React.MouseEvent | React.KeyboardEvent) => void;
  title?: string;
}

export function MarketTile({ node, move, basis, x, y, w, h, onClick, title }: TileProps) {
  const t = tileLines(node, move, w, h, basis);
  const style = { left: x, top: y, width: w, height: h, backgroundColor: tileFill(move),
    '--name-size': `${t.nameSize ?? 0}px`, '--move-size': `${t.moveSize}px` } as React.CSSProperties;
  return (
    <div className={`market-tile market-tile--${move.kind}`} style={style} aria-label={node.name} title={title}
      role="button" tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } }}>
      {t.nameSize != null && <div className="market-tile__name">{t.name}</div>}
      {t.move && <div className="market-tile__move">{t.move}</div>}
      {t.stat && <div className={`market-tile__stat${t.cls === 'L' ? ' market-tile__stat--small' : ''}`}>{t.stat}</div>}
    </div>
  );
}

function CardBody({ node, move, base, windowLabel, gateMin = GATE_MIN }: { node: MarketNode; move: Move; base: Baseline | null; windowLabel?: string; gateMin?: number }) {
  const dollars = node.usd_12m != null && node.usd_prior_12m != null && node.usd_prior_12m > 0
    ? `${money(node.usd_12m)} vs ${money(node.usd_prior_12m)} (${pct(node.usd_12m / node.usd_prior_12m - 1)})` : null;
  return (
    <>
      <div className="market-card__head">{node.name}</div>
      <div className="market-card__window">{windowLabel ?? 'last 12 months against the 12 before'} · {MEASURED}</div>
      {move.kind === 'move' && (
        <div className="market-card__move">
          <span className="market-card__big">{pct(move.rel)} against the market</span>
          <span>sales {pct(move.raw)} ({num(move.prior)} → {num(move.sold)}){base ? ` · the market ${pct(base.move)}` : ''}</span>
        </div>
      )}
      {move.kind === 'few' && (
        <div className="market-card__move">
          <span className="market-card__big">too few to say</span>
          <span>{move.why === 'count'
            ? `${num(move.prior)} → ${num(move.sold)} measured sales; the color needs ${gateMin} in each window`
            : `mostly sold at houses we cannot yet measure a year apart: under half of its ${num(node.count)} confirmed sales are measured`}</span>
        </div>
      )}
      {move.kind === 'none' && <div className="market-card__move"><span className="market-card__big">no measured sales</span></div>}
      <dl className="market-card__rows">
        {dollars && <><dt>measured dollars</dt><dd>{dollars}</dd></>}
        {node.offered && node.offered >= 20 && node.sold_any != null
          ? <><dt>sell-through</dt><dd>{Math.round((100 * node.sold_any) / node.offered)}% of {num(node.offered)} offered · all venues, all years</dd></> : null}
        {node.usd ? <><dt>ledger</dt><dd>{num(node.count)} confirmed sales · {money(node.usd)} · all venues and years</dd></> : null}
        {node.models ? <><dt>names</dt><dd>{num(node.models)} model names sold</dd></> : null}
      </dl>
      {node.familyKey === 'other' && <div className="market-card__note">names not yet keyed to a model family, and families with under 3 sales</div>}
    </>
  );
}

/** The hover card on a desktop, kept on screen. */
export function MarketCard({ node, move, base, x, y, windowLabel, gateMin }: { node: MarketNode; move: Move; base: Baseline | null; x: number; y: number; windowLabel?: string; gateMin?: number }) {
  const left = typeof window !== 'undefined' && x > window.innerWidth - 320 ? x - 316 : x + 14;
  const top = typeof window !== 'undefined' && y > window.innerHeight - 240 ? Math.max(8, y - 220) : y + 14;
  return (
    <div className="market-card" style={{ left, top }} role="tooltip">
      <CardBody node={node} move={move} base={base} windowLabel={windowLabel} gateMin={gateMin} />
      <div className="market-card__foot">click to open</div>
    </div>
  );
}

/** On a phone a tap opens the card; Open drills, the close button or a tap outside dismisses it. */
export function MarketSheet({ node, move, base, onOpen, onClose, windowLabel, gateMin }: { node: MarketNode; move: Move; base: Baseline | null; onOpen: () => void; onClose: () => void; windowLabel?: string; gateMin?: number }) {
  return (
    <div className="market-sheet__scrim" onClick={onClose}>
      <div className="market-sheet" role="dialog" aria-label={node.name} onClick={(e) => e.stopPropagation()}>
        <CardBody node={node} move={move} base={base} windowLabel={windowLabel} gateMin={gateMin} />
        <div className="market-sheet__actions">
          <button type="button" className="market-sheet__open" onClick={onOpen}>Open {node.name} →</button>
          <button type="button" className="market-sheet__close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const SWATCHES = ['−50%', '−33%', '−17%', '0', '+17%', '+33%', '+50%'];

/** The legend: seven swatches with their values, the hatch and the blank, and one line of what the map counts. */
export function MapLegend({ base, clock, basis, windowLabel }: { base: Baseline | null; clock: string; basis: MapBasis; windowLabel?: string }) {
  const winPhrase = windowLabel ? ` (${windowLabel})` : ' than a year ago';
  return (
    <div className="map-legend">
      <div className="map-legend__scale" aria-label="color scale">
        {SWATCHES.map((label, i) => (
          <span key={label} className="map-legend__stop">
            <span className={`map-legend__swatch map-legend__swatch--${i + 1}`} />
            <span className="map-legend__value">{label}</span>
          </span>
        ))}
        <span className="map-legend__stop"><span className="map-legend__swatch map-legend__swatch--few" /><span className="map-legend__value">{basis === 'ledger' ? 'too few measured sales, or mostly sold at houses not yet measured' : 'too few measured sales'}</span></span>
        <span className="map-legend__stop"><span className="map-legend__swatch map-legend__swatch--none" /><span className="map-legend__value">no measured sales</span></span>
      </div>
      <div className="map-legend__receipt">
        Color: is each tile selling more or less{winPhrase}, after taking out the market’s own growth
        {base ? ` (${pct(base.move)}, ${num(base.prior)} → ${num(base.sold)})` : ''}; the strongest colors mean 50% or more either way, and
        the label gives the exact figure. A move is measured only at auction houses we hold in full in both years: today
        Bring a Trailer, Mecum and Bonhams; others join as their records fill in. Size: {basis === 'bat12' ? 'measured dollars, last 12 months' : 'dollars of confirmed sales at every auction house, all years; striped where the measured houses hold under half the sales'}. Prices not adjusted for inflation{clock}.
      </div>
    </div>
  );
}

/** Where a 12-month move is measured: the auction houses held in full in both years (source_census.by_year). */
export const MEASURED = 'measured at Bring a Trailer, Mecum and Bonhams, the houses held in full both years';
const CALLOUT_LABEL: Record<Callout['kind'], string> = { gain: 'Biggest gain', loss: 'Biggest drop', largest: 'Biggest' };
/** The map's counted callouts, one line above it: the clearest gain and loss against BaT and the largest tile's move,
 *  led by the window every one of them counts (the hover card's words). */
export function MapCallouts({ items, onPick, windowLabel }: { items: Callout[]; onPick: (name: string) => void; windowLabel?: string }) {
  if (!items.length) return null;
  return (
    <div className="map-callouts" aria-label="What moved most">
      <span className="map-callouts__window">{windowLabel ?? 'last 12 months against the 12 before'}</span>
      {items.map((c) => (
        <button key={c.kind} type="button" className={`map-callouts__item map-callouts__item--${c.kind}`} onClick={() => onPick(c.name)}>
          <span className="map-callouts__label">{CALLOUT_LABEL[c.kind]}</span>
          <span className="map-callouts__name">{c.name}</span>
          <span className="map-callouts__move">{pct(c.rel)}</span>
          <span className="map-callouts__n">{c.prior.toLocaleString('en-US')} → {c.sold.toLocaleString('en-US')} sold</span>
        </button>
      ))}
    </div>
  );
}

export type HouseRow = { house: string | null; sales: number; amount: number };
/** Each house's share of the map's confirmed sales (treemap_populations().by_house, written at each refresh): a
 *  100% bar in the venue colors, the larger houses named with their share, the rest grouped. Absent until the refresh
 *  writes it. The owner, 2026-10-15: the site "is supposed to be all the markets not just one". */
export function VenueMix({ rows, clock }: { rows: HouseRow[] | null | undefined; clock: string }) {
  const clean = (rows ?? []).filter((r) => r && typeof r.sales === 'number' && r.sales > 0);
  const total = clean.reduce((a, r) => a + r.sales, 0);
  if (!clean.length || total <= 0) return null;
  const named = clean.filter((r) => r.house && r.sales / total >= 0.01);
  const restSales = total - named.reduce((a, r) => a + r.sales, 0);
  const share = (n: number) => { const p = (100 * n) / total; return p >= 1 ? `${Math.round(p)}%` : '<1%'; };
  const parts = [...named.map((r) => ({ key: r.house as string, label: r.house as string, sales: r.sales, color: venueOf(r.house).color })),
    ...(restSales > 0 ? [{ key: 'rest', label: 'other houses and venue unrecorded', sales: restSales, color: 'var(--text-disabled)' }] : [])];
  return (
    <div className="venue-mix" aria-label="Confirmed sales by house">
      <span className="venue-mix__label">Sales by house</span>
      <div className="venue-mix__bar" title={parts.map((p) => `${p.label}: ${p.sales.toLocaleString('en-US')} (${share(p.sales)})`).join(' · ')}>
        {parts.map((p) => <span key={p.key} className="venue-mix__seg" style={{ flexGrow: p.sales, background: p.color }} />)}
      </div>
      <span className="venue-mix__names">
        {parts.map((p) => <span key={p.key}>{p.key === 'rest' ? 'rest' : p.label} {share(p.sales)}</span>)}
        <span className="venue-mix__n">{total.toLocaleString('en-US')} confirmed sales with an amount{clock}</span>
      </span>
    </div>
  );
}
