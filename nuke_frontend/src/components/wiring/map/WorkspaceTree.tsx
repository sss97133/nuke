// map/WorkspaceTree.tsx — the MAP workspace's project tree: section → device → connector → pin, from the typed rows
// (harness_endpoints sections, wire_termination_specs cavities) with devices grouped by the public end positions.
// Select anything; the path to the selection opens by itself and what the selection links to is tinted.

import React, { useEffect, useMemo, useState } from 'react';
import type { Colorway } from '../connector-inspector/colorways';
import { rule } from '../connector-inspector/colorways';
import { SECTIONS, type WiringMapData } from './useWiringMap';
import { kindOf, valOf, type Rel, type SiteFiles, type WsIndex } from './useWorkspaceSelection';

interface TNode { key: string; id: string | null; label: string; tag?: string; count?: string; kids: TNode[]; dim?: boolean }

export function WorkspaceTree({ cw, map, ix, site, sel, rel, onSelect }: {
  cw: Colorway; map: WiringMapData; ix: WsIndex; site: SiteFiles; sel: string | null; rel: Rel; onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const roots = useMemo<TNode[]>(() => SECTIONS.map(s => {
    const nodes = map.nodes.filter(n => n.section === s.id);
    const devs = new Map<string, typeof nodes>();
    nodes.forEach(n => { const d = ix.devOf(n.code); devs.set(d, [...(devs.get(d) ?? []), n]); });
    const wires = map.wires.filter(w => w.section === s.id).length;
    return {
      key: 'y:' + s.id, id: 'y:' + s.id, label: s.label, count: `${wires} wires`,
      kids: [...devs.entries()].sort((a, b) => (site.ends[a[1][0].code]?.dev_name ?? a[0]).localeCompare(site.ends[b[1][0].code]?.dev_name ?? b[0]))
        .map(([dev, ns]) => {
          const conn = (n: typeof nodes[number]): TNode => ({
            key: 'y:' + s.id + '/n:' + n.code, id: 'n:' + n.code, tag: n.code, label: n.name,
            count: String((ix.pinsByNode.get(n.code) ?? []).length || ''),
            kids: (ix.pinsByNode.get(n.code) ?? []).map(p => ({
              key: 'y:' + s.id + '/n:' + n.code + '/p:' + p.cav, id: 'p:' + n.code + '|' + p.cav, tag: p.cav || '—', label: p.wires.join(' '), kids: [],
            })),
          });
          if (ns.length === 1 && dev === ns[0].code) return conn(ns[0]);
          return { key: 'y:' + s.id + '/d:' + dev, id: 'd:' + dev, label: site.ends[ns[0].code]?.dev_name ?? dev, count: `${ns.length}`, kids: ns.map(conn) };
        }),
    };
  }), [map.nodes, map.wires, ix, site.ends]);

  // open the path to the selection
  useEffect(() => {
    if (!sel) return;
    const k = kindOf(sel), v = valOf(sel);
    const code = k === 'n' ? v : k === 'p' ? v.split('|')[0] : k === 'w' ? (ix.chain.get(v) ?? [])[0]?.code : null;
    const node = code ? ix.byCode.get(code) : null;
    setOpen(prev => {
      const next = new Set(prev);
      if (k === 'y') next.add(sel);
      if (node?.section) {
        next.add('y:' + node.section);
        const dev = ix.devOf(node.code);
        if (dev !== node.code) next.add('y:' + node.section + '/d:' + dev);
        if (k === 'p') next.add('y:' + node.section + '/n:' + node.code);
      }
      return next;
    });
  }, [sel, ix]);

  const lit = (id: string | null) => {
    if (!id || !sel) return false;
    const k = kindOf(id), v = valOf(id);
    return (k === 'n' && rel.nodes.has(v)) || (k === 'p' && rel.pins.has(v)) || (k === 'd' && rel.devs.has(v)) || (k === 'y' && rel.sections.has(v));
  };
  const rows: { n: TNode; depth: number; isOpen: boolean }[] = [];
  const ql = q.trim().toLowerCase();
  const walk = (n: TNode, depth: number): boolean => {
    const self = !ql || ((n.tag ?? '') + ' ' + n.label).toLowerCase().includes(ql);
    const isOpen = !!ql || open.has(n.key);
    const at = rows.length;
    let any = false;
    rows.push({ n, depth, isOpen });
    if (isOpen || ql) n.kids.forEach(k => { if (walk(k, depth + 1)) any = true; });
    if (ql && !self && !any) { rows.splice(at, 1); return false; }
    return self || any;
  };
  roots.forEach(r => walk(r, 0));
  const shown = rows.slice(0, 700);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ padding: '6px 8px', borderBottom: rule(cw) }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="FIND A SECTION, DEVICE, CONNECTOR OR PIN" aria-label="Filter the project tree"
          style={{ width: '100%', boxSizing: 'border-box', border: `2px solid ${cw.border}`, background: cw.surface, color: cw.ink, fontFamily: cw.fontBody, fontSize: 12, padding: '4px 6px' }} />
      </div>
      <div role="tree" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 0', fontSize: 12.5 }}>
        {shown.map(({ n, depth, isOpen }) => {
          const on = !!n.id && n.id === sel, tint = !on && lit(n.id);
          return (
            <div key={n.key} role="treeitem" aria-level={depth + 1} aria-expanded={n.kids.length ? isOpen : undefined}
              onClick={() => { if (n.id) onSelect(n.id); if (n.kids.length && !isOpen) setOpen(p => new Set(p).add(n.key)); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, minHeight: 23, paddingLeft: 6 + depth * 14, paddingRight: 8, cursor: 'pointer', whiteSpace: 'nowrap',
                background: on ? cw.accent : tint ? `${cw.accent}1f` : 'transparent', color: on ? cw.onAccent : cw.ink,
              }}>
              <span onClick={e => { e.stopPropagation(); setOpen(p => { const x = new Set(p); if (x.has(n.key)) x.delete(n.key); else x.add(n.key); return x; }); }}
                style={{ width: 14, flexShrink: 0, textAlign: 'center', fontSize: 10, opacity: 0.7 }}>{n.kids.length ? (isOpen ? '▾' : '▸') : ''}</span>
              {n.tag && <span style={{ fontFamily: cw.fontMono, fontWeight: 700, flexShrink: 0 }}>{n.tag}</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, fontWeight: depth === 0 ? 700 : 400 }}>{n.label}</span>
              {n.count && <span style={{ marginLeft: 'auto', paddingLeft: 8, fontFamily: cw.fontMono, fontSize: 11, opacity: 0.6 }}>{n.count}</span>}
            </div>
          );
        })}
        {rows.length > 700 && <div style={{ padding: '4px 12px', color: cw.inkMuted }}>FIRST 700 SHOWN. TYPE MORE TO NARROW IT.</div>}
      </div>
    </div>
  );
}
