import React from 'react';
import type { FacetItem, FacetItemSource } from './types';
import { Text } from './Text';
import { Rows } from './Section';
import { day } from './format';
import { resolveSourceLogo } from './Claim';
import { optimizeImageUrl } from '../lib/imageOptimizer';

/**
 * A header token's line items (vehicle_facet_items), rendered as they are read: one row per item, in the reader's
 * order, grouped by facet. The reader decides every status, lead and source order; this renders and folds nothing.
 * A missing item names the evidence that would establish it.
 */

const FACET_TITLE: Record<FacetItem['facet'], string> = { decode: 'Decoded', as_built: 'As built', current: 'Current', derived: 'Derived' };
/** Key segments that place the item (its facet, or the source list it belongs to), not its name. */
const FACET_SEGMENTS = new Set(['as_built', 'current', 'derived', 'sources']);

/** The item's name from its key: `transmission.current.case_casting` → "Case casting". */
export function itemLabel(item: Pick<FacetItem, 'key' | 'facet'>): string {
  const words = item.key.split('.').slice(1).filter(s => !FACET_SEGMENTS.has(s)).join(' ').replace(/_/g, ' ').trim();
  const text = words || FACET_TITLE[item.facet];
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const numberText = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(n));

/** Machine codes the reader sent without a label (`not_original_unit`), as words. The reader's label wins when present. */
export const codeText = (s: string) => s.replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g, code => code.replace(/_/g, ' '));

/** Gear and axle ratios read to two places (1 → "1.00"), the way ratio charts print them. */
export const ratioText = (v: unknown): string | null => {
  const list = Array.isArray(v) ? v : [v];
  const parts = list.map(n => (typeof n === 'number' ? n.toFixed(2) : null)).filter((t): t is string => !!t);
  return parts.length ? parts.join(' / ') : null;
};

/** An equation as the reader wrote it, with its variable and item names as words: `top_gear_ratio` → "top gear ratio",
 * `as_built.type` → "as built type", `<>` → "≠", `pi()` → "π". The arithmetic is unchanged. */
export const equationText = (s: string) =>
  codeText(s.replace(/\bpi\(\)/g, 'π').replace(/<>/g, '≠').replace(/([a-z_])\.([a-z_])/g, '$1 $2'));

const AVAILABLE: Record<string, string> = { true: 'available', false: 'not available', implied: 'available by inference' };

/** A value as words. Arrays are sequences (gear ratios), objects are the area shapes the location items carry. */
export function valueText(value: unknown, unit?: string | null): string | null {
  if (value == null) return null;
  const withUnit = (t: string) => (unit ? `${t} ${unit}` : t);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return withUnit(numberText(value));
  if (typeof value === 'string') return value.trim() ? withUnit(value) : null;
  if (Array.isArray(value)) {
    const parts = value.map(v => valueText(v)).filter((v): v is string => !!v);
    return parts.length ? withUnit(parts.join(' / ')) : null;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.label === 'string') return o.label;
    if (Array.isArray(o.areas)) return o.areas.map(a => areaText(a as Record<string, unknown>)).join('; ') || null;
    if (typeof o.observations === 'number') {
      return `${numberText(o.observations)} ${o.observations === 1 ? 'observation' : 'observations'}, ${day(o.first_at as string)} to ${day(o.last_at as string)}`;
    }
  }
  return null;
}

function areaText(a: Record<string, unknown>): string {
  const n = (k: string) => (typeof a[k] === 'number' ? numberText(a[k] as number) : null);
  return [a.label, n('photos') && `${n('photos')} photos`, n('days') && `${n('days')} days`,
    a.first_taken_at && a.last_taken_at ? `${day(a.first_taken_at as string)} to ${day(a.last_taken_at as string)}` : null]
    .filter(Boolean).join(' · ');
}

export function StatusChip({ status }: { status: FacetItem['status'] }) {
  return <span className="k-status" data-status={status}>{status}</span>;
}

function SourceLine({ source }: { source: FacetItemSource }) {
  const url = source.url && /^https?:\/\//i.test(source.url) ? source.url : null;
  const name = source.label || source.slug || source.kind || 'source';
  const logo = resolveSourceLogo(name, url);
  const said = source.value_label ?? (typeof source.value === 'string' ? codeText(source.value) : valueText(source.value));
  const thumb = source.witness?.kind === 'image' && source.witness.thumb ? optimizeImageUrl(source.witness.thumb, 'thumbnail') : null;
  const decoded = source.decoded ? Object.entries(source.decoded).filter(([, v]) => v != null && v !== '') : [];
  const identity = <span className="k-claim__source-identity">
    {logo ? <img className="k-claim__logo" src={logo} alt={name} width={40} height={16} /> : <Text role="label">{name}</Text>}
  </span>;
  return <li className="k-item__source">
    {thumb && <img className="k-item__thumb" src={thumb} alt={`Photo witness for ${name}`} width={40} height={40} loading="lazy" />}
    <span className="k-item__source-body">
      <span className="k-item__source-head">
        {url ? <a href={url} target="_blank" rel="noreferrer">{identity}</a> : identity}
        <Text role="caption">{day(source.observed_at)}</Text>
      </span>
      {said && <Text role="caption">{said}</Text>}
      {decoded.length > 0 && <Text role="caption">{decoded.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${valueText(v) ?? ''}`).join(' · ')}</Text>}
      {source.limitation && <Text role="caption">Limitation: {source.limitation}</Text>}
    </span>
  </li>;
}

function Sources({ sources }: { sources: FacetItemSource[] }) {
  if (!sources.length) return null;
  return <ul className="k-item__sources">{sources.map((s, i) => <SourceLine key={`${s.witness?.id ?? s.slug ?? s.label}-${i}`} source={s} />)}</ul>;
}

function RuleLine({ rule }: { rule: Record<string, unknown> }) {
  const url = typeof rule.citation_url === 'string' && /^https?:\/\//i.test(rule.citation_url) ? rule.citation_url : null;
  const key = typeof rule.label === 'string' ? rule.label : typeof rule.key === 'string' ? codeText(rule.key) : 'rule';
  return <Text role="caption" as="p" className="k-item__line">
    Rule: {url ? <a href={url} target="_blank" rel="noreferrer">{key}</a> : key}
    {typeof rule.code === 'string' && ` · code ${rule.code}`}
    {typeof rule.effect === 'string' && ` · ${rule.effect}`}
  </Text>;
}

function EquationLine({ equation }: { equation: Record<string, unknown> }) {
  const expression = typeof equation.expression === 'string' ? equation.expression : null;
  if (!expression) return null;
  return <Text role="caption" as="p" className="k-item__line">Computed: {equationText(expression)}</Text>;
}

/** One item: name, value and status on one row, then its sources, rule or equation, and what would establish it. */
export function ItemRow({ item, after }: { item: FacetItem; after?: React.ReactNode }) {
  const value = valueText(item.value, item.unit);
  return <div className="k-item" data-key={item.key} data-status={item.status}>
    <div className="k-row">
      <Text role="label">{itemLabel(item)}</Text>
      <span className="k-item__value">
        {value && <Text role="measure">{value}</Text>}
        <StatusChip status={item.status} />
      </span>
    </div>
    {item.stated && <Text role="caption" as="p" className="k-item__line">Stated: {item.stated}</Text>}
    {item.sides?.length ? <ul className="k-item__sides">{item.sides.map((side, i) => <li key={i}>
      <Text role="body">{valueText(side.value) ?? 'No value'}</Text>
      <Sources sources={side.sources} />
    </li>)}</ul> : <Sources sources={item.sources} />}
    {item.candidates?.length ? <ul className="k-item__sides">{item.candidates.map((c, i) => <li key={i}>
      <Text role="body">{[c.code, ratioText(c.gears), c.reverse != null ? `reverse ${ratioText(c.reverse)}` : null,
        c.countershaft_in ? `${c.countershaft_in} in countershaft` : null].filter(Boolean).join(' · ')}</Text>
      {typeof c.citation_url === 'string' && /^https?:\/\//i.test(c.citation_url) &&
        <Text role="caption"> <a href={c.citation_url} target="_blank" rel="noreferrer">{String(c.citation_title ?? 'citation')}</a></Text>}
    </li>)}</ul> : null}
    {item.examined?.length ? <ul className="k-item__sides">{item.examined.map((e, i) => <li key={i}>
      <Text role="caption">Examined: {codeText(String(e.result ?? e.method ?? ''))} · {day(e.observed_at as string)}</Text>
    </li>)}</ul> : null}
    {item.availability?.length ? <ul className="k-item__sides">{item.availability.map((a, i) => <li key={String(a.rule_id ?? i)}>
      <Text role="body">{[a.market, AVAILABLE[String(a.available)] ?? null, a.transmission].filter(Boolean).map(String).join(' · ')}</Text>
      {typeof a.quoted === 'string' && <Text role="caption" as="p" className="k-item__line">Quoted: “{a.quoted}”</Text>}
      {typeof a.inference === 'string' && <Text role="caption" as="p" className="k-item__line">Inference: {a.inference}</Text>}
      {typeof a.conflicts_with === 'string' && <Text role="caption" as="p" className="k-item__line">Disagrees with: {a.conflicts_with}</Text>}
      {typeof a.citation_url === 'string' && /^https?:\/\//i.test(a.citation_url) &&
        <Text role="caption" as="p" className="k-item__line"><a href={a.citation_url} target="_blank" rel="noreferrer">{String(a.citation_title ?? 'citation')}</a>
          {typeof a.citation_locator === 'string' && ` · ${a.citation_locator}`}</Text>}
    </li>)}</ul> : null}
    {item.rule && <RuleLine rule={item.rule} />}
    {item.equation && <EquationLine equation={item.equation} />}
    {item.needed && item.status !== 'established' && <Text role="caption" as="p" className="k-item__line">Needed: {item.needed}</Text>}
    {after}
  </div>;
}

/** A token's items grouped by facet, in the reader's order. `after` adds a renderer for one item (the location map). */
export function ItemList({ items, after }: { items: FacetItem[]; after?: (item: FacetItem) => React.ReactNode }) {
  const groups: Array<{ facet: FacetItem['facet']; items: FacetItem[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.facet === item.facet) last.items.push(item); else groups.push({ facet: item.facet, items: [item] });
  }
  return <div className="k-items">
    {groups.map((g, i) => <Rows key={`${g.facet}-${i}`} title={FACET_TITLE[g.facet]}>
      {g.items.map(item => <ItemRow key={item.key} item={item} after={after?.(item)} />)}
    </Rows>)}
  </div>;
}
