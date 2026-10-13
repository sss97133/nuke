import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MakeIdentity } from '../../components/common/MakeIdentity';
import { Text } from '../../kit';
import { squarify } from '../../lib/squarify';
import { MAP_GROUPS, inventoryGroups, mapValue, readableInventoryLayout, type InventoryMapGroup, type InventoryMapLens, type MapDimension, type MapSubdivision } from './inventoryMap';
import type { InventoryTaxonomy, LiveAuction } from './useMarketPulse';
import './MarketInventoryMap.css';

interface Props {
  auctions: LiveAuction[];
  lens: InventoryMapLens;
  taxonomy: Map<string, InventoryTaxonomy>;
  taxonomyLoading: boolean;
  taxonomyError: boolean;
  onRetryTaxonomy: () => void;
  risenIds: Set<string>;
  onLensChange: (change: Partial<InventoryMapLens>) => void;
  onSelect: (dimension: MapDimension | 'lot', group: InventoryMapGroup, child?: boolean) => void;
  selectedModel: string | null;
}

export default function MarketInventoryMap({ auctions, lens, taxonomy, taxonomyLoading, taxonomyError, onRetryTaxonomy,
  risenIds, onLensChange, onSelect, selectedModel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pulses, setPulses] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  const [list, setList] = useState<{ keys: string[]; dimension: MapDimension | 'lot'; parent?: string; parentKey?: string } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setHovered(null); setList(null); }, [lens.group, lens.inside, lens.focus]);

  const height = width < 640 ? 480 : 520;
  const groups = useMemo(() => inventoryGroups(auctions, lens.group, taxonomy), [auctions, lens.group, taxonomy]);
  const listedGroups = useMemo(() => list ? inventoryGroups(auctions.filter(a => list.parentKey == null
    || mapValue(a, lens.group, taxonomy) === list.parentKey), list.dimension, taxonomy).filter(g => list.keys.includes(g.key)) : [],
  [auctions, lens.group, taxonomy, list]);
  const rects = useMemo(() => {
    const focused = groups.filter(g => lens.focus == null || g.key === lens.focus);
    return readableInventoryLayout(focused, width, height).map(rect => {
      const roomy = rect.w >= 160 && rect.h >= 154;
      // The groups too small for a readable box of their own keep their area as cells inside one box, each
      // sized by its lots (the long tail is shown, not summarised); the box's heading still opens them as a list.
      if (rect.node.remainder) {
        const children = roomy ? squarify(rect.node.remainder.map(node => ({ node, area: node.lots.length })), 0, 0, rect.w - 4, rect.h - 48) : [];
        return { ...rect, expanded: roomy, children, childDimension: lens.group as MapDimension | 'lot' };
      }
      // Inside a box every member keeps its area, down to a pixel: a brand's decades read as a distribution,
      // labelled where there is room and identified by hover or focus elsewhere.
      const expanded = lens.inside !== 'none' && lens.inside !== lens.group && roomy;
      const childGroups = expanded ? inventoryGroups(rect.node.lots, lens.inside as MapDimension | 'lot', taxonomy) : [];
      const children = squarify(childGroups.map(node => ({ node, area: lens.inside === 'lot' ? 1 : node.lots.length })), 0, 0, rect.w - 4, rect.h - 48);
      return { ...rect, expanded, children, childDimension: lens.inside as MapDimension | 'lot' };
    });
  }, [groups, lens.focus, lens.inside, lens.group, taxonomy, width, height]);
  const needsTaxonomy = lens.group === 'type' || lens.group === 'body';
  const pending = needsTaxonomy && taxonomyLoading;
  const failed = needsTaxonomy && taxonomyError;
  const updates = auctions.filter(a => risenIds.has(a.id)).length;
  const select = (dimension: MapDimension | 'lot', group: InventoryMapGroup, child = false) => { setList(null); setHovered(null); onSelect(dimension, group, child); };
  const plural = (dimension: MapDimension | 'lot') => ({ make: 'brands', model: 'models', type: 'vehicle types', body: 'body styles', era: 'decades', year: 'years', lot: 'vehicles' })[dimension];
  const count = (group: InventoryMapGroup) => <span className="inventory-map-count">{group.lots.length.toLocaleString('en-US')} <span>{group.lots.length === 1 ? 'lot' : 'lots'}</span></span>;
  const showList = (groups: InventoryMapGroup[], dimension: MapDimension | 'lot', parent?: string, parentKey?: string) => {
    setHovered(null); setList({ keys: groups.map(g => g.key), dimension, parent, parentKey });
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('.inventory-map-back')?.focus({ preventScroll: true }));
  };
  const describe = (group: InventoryMapGroup, dimension: MapDimension | 'lot') => {
    const changes = group.lots.filter(a => risenIds.has(a.id)).length;
    if (dimension === 'lot') return `${group.name} · Select to inspect this vehicle`;
    return `${group.name}: ${group.lots.length} captured ${dimension === 'make' ? 'live ' : ''}lots${dimension === 'model' ? '. Filter this recorded model' : ''}${changes ? `. ${changes} recorded bid${changes === 1 ? '' : 's'} increased since refresh` : ''}`;
  };
  const identity = (group: InventoryMapGroup, dimension: MapDimension | 'lot', roomy: boolean) => dimension === 'make' && roomy
    ? <MakeIdentity make={group.name} /> : group.name;
  const active = (g: InventoryMapGroup) => lens.child === g.key || (lens.group === 'model' && selectedModel != null && g.lots.every(a => (a.model?.trim() || 'Model unrecorded') === selectedModel));

  return <section className="inventory-map" aria-label="Inventory map">
    <div className="inventory-map-controls">
      <label className="market-scope__cohort"><Text role="label">Group by</Text><select className="market-control k-body" aria-label="Group inventory by" value={lens.group} onChange={e => onLensChange({ group: e.target.value as MapDimension, focus: null, child: null })}>
        {MAP_GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
      </select></label>
      <label className="market-scope__cohort"><Text role="label">Inside each box</Text><select className="market-control k-body" aria-label="Inventory sub-boxes" value={lens.inside} onChange={e => onLensChange({ inside: e.target.value as MapSubdivision, child: null })}>
        <option value="none">Total lots</option><option value="make">Brands</option><option value="model">Models</option><option value="era">Decades</option><option value="year">Years</option><option value="lot">Individual vehicles</option>
      </select></label>
      {lens.focus != null && <button type="button" className="market-control" onClick={() => onLensChange({ focus: null, child: null })}><Text role="label">← All {plural(lens.group)}</Text></button>}
      {lens.child != null && <button type="button" className="market-control" onClick={() => onLensChange({ child: null })}><Text role="label">Clear sub-box selection</Text></button>}
    </div>
    <div className="inventory-map-key"><Text role="caption">Box size = number of open lots{lens.inside === 'lot' ? ' · Each small box = one vehicle' : ''}</Text><Text role="caption">{lens.inside === 'lot' ? 'Hover or focus to identify · Select to inspect' : `Select ${lens.group === 'make' ? 'a brand to see its models' : 'a box to narrow the inventory'}`}</Text></div>
    {pending && <p role="status" className="k-body">Reading recorded classifications…</p>}
    {failed && <p role="status" className="k-body">Recorded classifications could not be loaded. <button type="button" className="market-control" onClick={onRetryTaxonomy}><Text role="label">Retry classifications</Text></button></p>}
    {!pending && !failed && width > 0 && rects.length === 0 && <p role="status" className="k-body">No captured lots remain in this map group. <button type="button" className="market-control" onClick={() => onLensChange({ focus: null, child: null })}><Text role="label">Show all map groups</Text></button></p>}
    <div ref={ref} className="inventory-map-canvas" style={{ height: list ? 'auto' : pending || failed || (width > 0 && rects.length === 0) ? 0 : height }} aria-label={`Captured inventory by ${MAP_GROUPS.find(g => g.id === lens.group)?.label}`} onMouseLeave={() => setHovered(null)}>
      {!pending && !failed && list && <div className="inventory-map-remainder">
        <div className="inventory-map-list-heading"><button type="button" className="inventory-map-back" onClick={() => { setList(null); requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[data-map-more]')?.focus({ preventScroll: true })); }}>← Back to map</button>
          <strong>{list.parent ? `${list.parent} · ` : ''}{listedGroups.length} {plural(list.dimension)}</strong></div>
        {listedGroups.length === 0 && <p>No matching lots remain in this list.</p>}
        <div className="inventory-map-list-grid">{listedGroups.map(g => <button type="button" key={g.key}
          className={pulses && g.lots.some(a => risenIds.has(a.id)) ? 'inventory-map-pulse' : undefined}
          onClick={() => select(list.dimension, g, !!list.parent)} aria-label={describe(g, list.dimension)}>
          <span>{identity(g, list.dimension, true)}</span>{list.dimension !== 'lot' && count(g)}<span aria-hidden="true">→</span>
        </button>)}</div>
      </div>}
      {!pending && !failed && !list && rects.map(({ node, x, y, w, h, expanded, children, childDimension }) => {
        const changes = pulses && node.lots.some(a => risenIds.has(a.id));
        const roomy = w >= 160 && h >= 100;
        const moreLabel = node.remainder ? `${node.remainder.length} more ${plural(lens.group)}` : null;
        return <div key={node.key} className={`inventory-map-region${roomy ? ' inventory-map-roomy' : ''}`} data-map-group={node.remainder ? undefined : node.key}
          style={{ left: x + 1, top: y + 1, width: Math.max(0, w - 2), height: Math.max(0, h - 2) }}>
          <button type="button" className={`inventory-map-group ${expanded ? 'inventory-map-heading' : 'inventory-map-whole'}${changes && !expanded ? ' inventory-map-pulse' : ''}`}
            data-map-more={!!node.remainder || undefined}
            aria-label={moreLabel ? `${moreLabel}: ${node.lots.length} lots. Open list` : describe(node, lens.group)} aria-pressed={active(node)} title={moreLabel ?? describe(node, lens.group)}
            onMouseEnter={() => setHovered(moreLabel ? `${moreLabel} · ${node.lots.length} lots · Open list` : describe(node, lens.group))}
            onFocus={() => setHovered(moreLabel ? `${moreLabel} · ${node.lots.length} lots · Open list` : describe(node, lens.group))}
            onClick={() => node.remainder ? showList(node.remainder, lens.group) : select(lens.group, node)}>
            <span className="inventory-map-name">{moreLabel ?? identity(node, lens.group, roomy)}</span>
            {count(node)}
            {!expanded && roomy && <span className="inventory-map-action">{moreLabel ? 'Open list' : 'Explore'} <span aria-hidden="true">→</span></span>}
          </button>
          {expanded && <div className="inventory-map-children">{children.map(child => {
            const changed = pulses && child.node.lots.some(a => risenIds.has(a.id));
            const dimension = childDimension;
            const more = 'remainder' in child.node ? child.node.remainder as InventoryMapGroup[] | undefined : undefined;
            const labeled = child.w >= 56 && child.h >= 44;
            const lot = dimension === 'lot' ? child.node.lots[0] : null;
            const vehicleLabel = lot ? [lot.year, lens.group === 'make' ? null : lot.make, lot.model].filter(Boolean).join(' ') : null;
            return <button type="button" key={child.node.key} data-map-lot={dimension === 'lot' && !more ? child.node.lots[0].id : undefined}
              data-map-more={!!more || undefined}
              className={`inventory-map-child${!labeled ? ' inventory-map-pixel' : ''}${changed ? ' inventory-map-pulse' : ''}`} aria-pressed={active(child.node)}
              style={{ left: child.x + 1, top: child.y + 1, width: Math.max(0, child.w - 2), height: Math.max(0, child.h - 2) }}
              aria-label={more ? `${more.length} more ${plural(dimension)} in ${node.name}` : describe(child.node, dimension)} title={describe(child.node, dimension)}
              onMouseEnter={() => setHovered(describe(child.node, dimension))} onFocus={() => setHovered(describe(child.node, dimension))}
              onClick={() => more ? showList(more, dimension, node.name, node.key) : select(dimension, child.node, !node.remainder)}>
              {labeled && <span className="inventory-map-name">{more ? `${more.length} more ${plural(dimension)}` : vehicleLabel || identity(child.node, dimension, child.w >= 160)}</span>}
              {labeled && dimension !== 'lot' && count(child.node)}
              {labeled && (more || (dimension === 'lot' && child.w >= 88 && child.h >= 68)) && <span className="inventory-map-action">{more ? 'Open list' : 'Inspect'} →</span>}
            </button>;
          })}</div>}
        </div>;
      })}
    </div>
    <Text role="body" as="div" className="inventory-map-description" aria-live="polite">{hovered ?? `${auctions.length.toLocaleString('en-US')} captured lots · Bring a Trailer${needsTaxonomy ? ' · Unrecorded classifications are included' : ''}`}</Text>
    {!pending && !failed && <details className="inventory-map-notes"><summary><Text role="label">Map notes · {groups.length} groups as a list</Text></summary>
      <label className="inventory-map-pulse-control k-body"><input type="checkbox" checked={pulses} onChange={e => setPulses(e.target.checked)} /> Pulse on recorded bid increases <span>· 60-second refreshes</span></label>
      <p className="inventory-map-note k-caption">Pulses show recorded bid increases between 60-second refreshes, not every individual bid. Source delay and complete platform coverage are unknown. Bid numbers have unverified currency.{updates > 0 && pulses ? ` ${updates} lot${updates === 1 ? '' : 's'} updated.` : ''}</p>
      <div className="inventory-map-list">{groups.map(g => <button type="button" key={g.key} onClick={() => select(lens.group, g)} aria-label={`Focus ${g.name}: ${g.lots.length} captured lots`}>
        <span>{identity(g, lens.group, true)}</span><span>{g.lots.length}</span>
      </button>)}</div>
    </details>}
  </section>;
}
