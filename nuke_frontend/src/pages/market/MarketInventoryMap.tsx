import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MakeIdentity } from '../../components/common/MakeIdentity';
import { squarify } from '../../lib/squarify';
import { MAP_GROUPS, inventoryGroups, type InventoryMapGroup, type InventoryMapLens, type MapDimension, type MapSubdivision } from './inventoryMap';
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
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setHovered(null), [lens.group, lens.inside, lens.focus]);

  const height = width < 640 ? 400 : 460;
  const groups = useMemo(() => inventoryGroups(auctions, lens.group, taxonomy), [auctions, lens.group, taxonomy]);
  const rects = useMemo(() => {
    const focused = groups.filter(g => lens.focus == null || g.key === lens.focus);
    return squarify(focused.map(node => ({ node, area: node.lots.length })), 0, 0, width, height).map(rect => {
      const expanded = lens.inside !== 'none' && rect.w >= 84 && rect.h >= 88;
      const children = expanded ? squarify(inventoryGroups(rect.node.lots, lens.inside as MapDimension | 'lot', taxonomy)
        .map(node => ({ node, area: node.lots.length })), 0, 0, rect.w - 4, rect.h - 34) : [];
      return { ...rect, expanded, children };
    });
  }, [groups, lens.focus, lens.inside, taxonomy, width, height]);
  const needsTaxonomy = lens.group === 'type' || lens.group === 'body';
  const pending = needsTaxonomy && taxonomyLoading;
  const failed = needsTaxonomy && taxonomyError;
  const updates = auctions.filter(a => risenIds.has(a.id)).length;
  const select = (dimension: MapDimension | 'lot', group: InventoryMapGroup, child = false) => onSelect(dimension, group, child);
  const describe = (group: InventoryMapGroup, dimension: MapDimension | 'lot') => {
    const changes = group.lots.filter(a => risenIds.has(a.id)).length;
    return `${group.name}: ${group.lots.length} captured ${dimension === 'make' ? 'live ' : ''}lots${dimension === 'model' ? '. Filter this recorded model' : ''}${changes ? `. ${changes} recorded bid${changes === 1 ? '' : 's'} increased since refresh` : ''}`;
  };
  const identity = (group: InventoryMapGroup, dimension: MapDimension | 'lot', roomy: boolean) => dimension === 'make' && roomy
    ? <MakeIdentity make={group.name} /> : group.name;
  const active = (g: InventoryMapGroup) => lens.child === g.key || (lens.group === 'model' && selectedModel != null && g.lots.every(a => (a.model?.trim() || 'Model unrecorded') === selectedModel));

  return <section className="inventory-map" aria-label="Inventory map">
    <div className="inventory-map-controls">
      <label>Group by <select aria-label="Group inventory by" value={lens.group} onChange={e => onLensChange({ group: e.target.value as MapDimension, focus: null, child: null })}>
        {MAP_GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
      </select></label>
      <label>Sub-boxes <select aria-label="Inventory sub-boxes" value={lens.inside} onChange={e => onLensChange({ inside: e.target.value as MapSubdivision, child: null })}>
        <option value="none">Off</option><option value="make">Brands</option><option value="model">Models</option><option value="year">Years</option><option value="lot">Individual lots</option>
      </select></label>
      <label className="inventory-map-pulse-control"><input type="checkbox" checked={pulses} onChange={e => setPulses(e.target.checked)} /> Bid update pulses</label>
      {lens.focus != null && <button type="button" onClick={() => onLensChange({ focus: null, child: null })}>All {MAP_GROUPS.find(g => g.id === lens.group)?.label.toLowerCase()} groups</button>}
      {lens.child != null && <button type="button" onClick={() => onLensChange({ child: null })}>Clear sub-box selection</button>}
    </div>
    <p className="inventory-map-note">Bring a Trailer · {auctions.length.toLocaleString('en-US')} captured open vehicle lots · area = captured lot count. Complete platform coverage is unknown.</p>
    {needsTaxonomy && <p className="inventory-map-note">Current recorded {lens.group === 'type' ? 'vehicle type' : 'body style'}; unrecorded classifications stay in the map.</p>}
    <div className="inventory-map-description" aria-live="polite">{hovered ?? 'Select a group to focus, or a lot to inspect its listing activity.'}</div>
    {pending && <p role="status">Reading recorded classifications…</p>}
    {failed && <p role="status">Recorded classifications could not be loaded. <button onClick={onRetryTaxonomy}>Retry classifications</button></p>}
    {!pending && !failed && width > 0 && rects.length === 0 && <p role="status">No captured lots remain in this map group. <button onClick={() => onLensChange({ focus: null, child: null })}>Show all map groups</button></p>}
    <div ref={ref} className="inventory-map-canvas" style={{ height: pending || failed || (width > 0 && rects.length === 0) ? 0 : height }} aria-label={`Captured inventory by ${MAP_GROUPS.find(g => g.id === lens.group)?.label}`} onMouseLeave={() => setHovered(null)}>
      {!pending && !failed && rects.map(({ node, x, y, w, h, expanded, children }) => {
        const changes = pulses && node.lots.some(a => risenIds.has(a.id));
        const roomy = w >= 120 && h >= 64;
        return <div key={node.key} className="inventory-map-region" data-map-group={node.key}
          style={{ left: x + 1, top: y + 1, width: Math.max(0, w - 2), height: Math.max(0, h - 2) }}>
          <button type="button" className={`inventory-map-group ${expanded ? 'inventory-map-heading' : 'inventory-map-whole'}${changes && !expanded ? ' inventory-map-pulse' : ''}`}
            style={{ padding: w > 50 && h > 28 ? '5px 6px' : 0 }}
            aria-label={describe(node, lens.group)} aria-pressed={active(node)} title={describe(node, lens.group)}
            onMouseEnter={() => setHovered(describe(node, lens.group))} onFocus={() => setHovered(describe(node, lens.group))} onClick={() => select(lens.group, node)}>
            {w > 50 && h > 28 && <><span className="inventory-map-name">{identity(node, lens.group, roomy)}</span><span className="inventory-map-count">{node.lots.length}</span></>}
          </button>
          {expanded && <div className="inventory-map-children">{children.map(child => {
            const changed = pulses && child.node.lots.some(a => risenIds.has(a.id));
            const dimension = lens.inside as MapDimension | 'lot';
            return <button type="button" key={child.node.key} data-map-lot={dimension === 'lot' ? child.node.lots[0].id : undefined}
              className={`inventory-map-child${changed ? ' inventory-map-pulse' : ''}`} aria-pressed={active(child.node)}
              style={{ left: child.x + 1, top: child.y + 1, width: Math.max(0, child.w - 2), height: Math.max(0, child.h - 2), padding: child.w > 54 && child.h > 25 ? '5px 6px' : 0 }}
              aria-label={describe(child.node, dimension)} title={describe(child.node, dimension)}
              onMouseEnter={() => setHovered(describe(child.node, dimension))} onFocus={() => setHovered(describe(child.node, dimension))}
              onClick={() => select(dimension, child.node, true)}>
              {child.w > 54 && child.h > 25 && <span className="inventory-map-name">{identity(child.node, dimension, child.w >= 130 && child.h >= 50)}</span>}
              {dimension !== 'lot' && child.w > 54 && child.h > 42 && <span className="inventory-map-count">{child.node.lots.length}</span>}
            </button>;
          })}</div>}
        </div>;
      })}
    </div>
    <p className="inventory-map-note">Pulses show recorded bid increases between 60-second refreshes, not every individual bid. Source delay is unknown.{updates > 0 && pulses ? ` ${updates} lot${updates === 1 ? '' : 's'} updated.` : ''}</p>
    {!pending && !failed && <details className="inventory-map-list"><summary>Read {groups.length} groups as a list</summary>
      <div>{groups.map(g => <button type="button" key={g.key} onClick={() => select(lens.group, g)} aria-label={`Focus ${g.name}: ${g.lots.length} captured lots`}>
        <span>{identity(g, lens.group, true)}</span><span>{g.lots.length}</span>
      </button>)}</div>
    </details>}
  </section>;
}
