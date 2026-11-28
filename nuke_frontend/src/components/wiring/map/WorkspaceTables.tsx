// map/WorkspaceTables.tsx — the MAP workspace's linked tables: wire list, pin list and connectors for everyone, and the
// calls and decisions for the owner. A row the selection links to is tinted; clicking a row selects it everywhere.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Colorway } from '../connector-inspector/colorways';
import { frame, rule } from '../connector-inspector/colorways';
import type { WiringMapData } from './useWiringMap';
import { kindOf, mask, valOf, type Rel, type SiteFiles, type WsIndex } from './useWorkspaceSelection';
import { scheduleCellValue, wiringWorkbookBytes, type ScheduleRow, type SourceRecordTarget } from './wiringSchedule';
import { buildPhysicalPieceSchedule, type PieceScheduleFilter } from './physicalPieceSchedule';
import { readPhysicalSourceWorkspace } from './physicalHarnessModel';
import type { PhysicalHarnessRead } from './usePhysicalHarnessModel';
import { supabase } from '../../../lib/supabase';

type Tab = 'wires' | 'pins' | 'conns' | 'circuits' | 'open';
interface Col<T> { h: string; v: (r: T) => string | number; td?: (r: T) => React.ReactNode; mono?: boolean; num?: boolean; w?: number; searchable?: boolean }
interface DisplayTable { rows: ScheduleRow[]; id: (r: ScheduleRow) => string; linked: (r: ScheduleRow) => boolean; cols: Col<ScheduleRow>[] }

export function WorkspaceTables({ cw, map, sel, rel, isOwner, onSelect, vehicleId, physicalRead, selectedRecord, onRecord }: {
  cw: Colorway; map: WiringMapData; ix: WsIndex; site: SiteFiles; sel: string | null; rel: Rel; isOwner: boolean; onSelect: (id: string) => void; vehicleId?: string;
  physicalRead: PhysicalHarnessRead; selectedRecord: SourceRecordTarget | null; onRecord: (target: SourceRecordTarget) => void;
}) {
  const [tab, setTab] = useState<Tab>('wires');
  const [q, setQ] = useState('');
  const [onlyLinked, setOnlyLinked] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const linkedFilter = useMemo<PieceScheduleFilter>(() => {
    const model = physicalRead.model;
    if (selectedRecord) return { query: '',
      ...(selectedRecord.kind === 'segments' ? { linkedPieceIds: new Set([selectedRecord.id]) }
        : selectedRecord.kind === 'ends' ? { linkedEndIds: new Set([selectedRecord.id]) }
        : selectedRecord.kind === 'endpoints' ? { linkedEndpointIds: new Set([selectedRecord.id]) }
        : { linkedCircuitIds: new Set([selectedRecord.id]) }) };
    if (!sel || !model) return { query: '' };
    if (kindOf(sel) === 'w') return { query: '', linkedCircuitIds: new Set(model.circuits.filter(c => c.code === valOf(sel)).map(c => c.id)) };
    return { query: '', linkedEndpointIds: new Set(model.endpoints.filter(e => rel.nodes.has(e.code)).map(e => e.id)) };
  }, [physicalRead.model, selectedRecord, sel, rel]);
  const schedule = useMemo(() => physicalRead.model ? buildPhysicalPieceSchedule(physicalRead.model,
    { ...(onlyLinked && (sel || selectedRecord) ? linkedFilter : {}), query: tab === 'open' ? '' : q }, isOwner) : null,
    [physicalRead.model, onlyLinked, sel, selectedRecord, linkedFilter, q, isOwner, tab]);
  const linkedRows = useMemo(() => physicalRead.model && (sel || selectedRecord)
    ? new Map(buildPhysicalPieceSchedule(physicalRead.model, linkedFilter, isOwner).tables.map(t => [t.id, new Set(t.rows.map(r => r.id))])) : null,
    [physicalRead.model, linkedFilter, isOwner, sel, selectedRecord]);
  const currentView = useRef('');
  currentView.current = JSON.stringify([vehicleId, physicalRead.viewerId, isOwner, schedule?.snapshotKey, q, onlyLinked, tab, sel, selectedRecord]);
  const alive = useRef(true), exportRequest = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; exportRequest.current?.abort(); }; }, []);
  const T = useMemo<Partial<Record<Tab, DisplayTable>>>(() => {
    const tables = Object.fromEntries((schedule?.tables ?? []).map(table => [table.id, {
      rows: table.rows,
      id: (r: ScheduleRow) => r.selection,
      linked: (r: ScheduleRow) => linkedRows?.get(table.id)?.has(r.id) ?? false,
      cols: table.columns.map(c => ({
        h: c.label, v: (r: ScheduleRow) => scheduleCellValue(c, r.cells[c.key] ?? null) ?? '', num: c.numeric, w: (c.width ?? 24) * 9,
        searchable: !c.link && !/id$/i.test(c.key),
        td: (r: ScheduleRow) => c.link && r.cells[c.key]
          ? <a href={String(r.cells[c.key])} onClick={e => e.stopPropagation()} style={{ color: cw.accent }}>Open record</a>
          : r.cells[c.key] == null || r.cells[c.key] === '' ? <span style={{ color: cw.inkFaint }}>—</span> : String(scheduleCellValue(c, r.cells[c.key])),
      })),
    }])) as Record<Exclude<Tab, 'open'>, DisplayTable>;
    const calls = map.calls.slice().sort((a, b) => Number(a.decided) - Number(b.decided));
    const open = {
      rows: calls.map(c => ({ id: c.id, selection: 'k:' + c.slug, cells: {
        call: mask(c.subject), status: c.decided ? (c.trust === 'T1' ? 'Locked' : 'Decided for you') : (c.workStatus || '').replace(/_/g, ' '),
        options: c.options.length, linked: c.links.map(l => l.endpointCode).filter(Boolean).join(' '),
      } })),
      id: (r: ScheduleRow) => r.selection,
      linked: (r: ScheduleRow) => calls.find(c => c.id === r.id)?.links.some(l => !!l.endpointCode && rel.nodes.has(l.endpointCode)) ?? false,
      cols: [
        { h: 'Call', v: (r: ScheduleRow) => r.cells.call ?? '', w: 420 },
        { h: 'Status', v: (r: ScheduleRow) => r.cells.status ?? '' },
        { h: 'Options', v: (r: ScheduleRow) => r.cells.options ?? '', num: true },
        { h: 'Linked connection points', v: (r: ScheduleRow) => r.cells.linked ?? '', w: 350 },
      ],
    };
    return { ...tables, open };
  }, [schedule, map.calls, rel, cw, linkedRows]);

  const download = async () => {
    if (!schedule || !vehicleId || tab === 'open') return;
    const view = currentView.current;
    const address = window.location.href;
    const controller = new AbortController(); exportRequest.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), 20000);
    setExporting(true); setExportError(null);
    try {
      const bytes = await wiringWorkbookBytes(schedule);
      const { data, error } = await supabase.rpc('harness_source_workspace', { p_vehicle_id: vehicleId }).abortSignal(controller.signal);
      if (error) throw error;
      const verified = readPhysicalSourceWorkspace(data, vehicleId);
      if (!alive.current) return;
      if (currentView.current !== view || window.location.href !== address) { setExportError('The selection or filter changed. Download the shown scope again.'); return; }
      if (verified.snapshot_hash !== schedule.snapshotKey) throw new Error('The database source changed. Refresh the workspace before exporting.');
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url;
      a.download = `Physical-wire-pieces-${vehicleId}-${schedule.snapshotKey}.xlsx`;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (alive.current && currentView.current === view) setExportError(error instanceof Error ? error.message : 'Workbook could not be created.'); }
    finally { window.clearTimeout(deadline); if (exportRequest.current === controller) exportRequest.current = null; if (alive.current) setExporting(false); }
  };

  const t = T[tab === 'open' && !isOwner ? 'wires' : tab] ?? { rows: [], id: (r: ScheduleRow) => r.selection, linked: () => false, cols: [] };
  const ql = q.trim().toLowerCase();
  let rows = t.rows;
  if (tab === 'open' && ql) rows = rows.filter(r => t.cols.filter(c => c.searchable !== false).map(c => String(c.v(r))).join(' ').toLowerCase().includes(ql));
  if (tab === 'open' && onlyLinked && sel) rows = rows.filter(r => t.linked(r) || t.id(r) === sel);
  const shown = rows;
  const priOf = (r: ScheduleRow) => selectedRecord ? r.record?.kind === selectedRecord.kind && r.id === selectedRecord.id
    : t.id(r) === sel || (kindOf(sel) === 'n' && tab === 'pins' && valOf(sel) === r.cells.node);

  useEffect(() => {   // bring the selection's row into view when it comes from another pane (this table only: on a phone
    // the whole page scrolls, and scrollIntoView would move the page too)
    const box = wrap.current, el = (box?.querySelector('tr[data-pri="1"]') ?? box?.querySelector('tr[data-rel="1"]')) as HTMLElement | null;
    if (!box || !el) return;
    const head = (box.querySelector('thead') as HTMLElement | null)?.offsetHeight ?? 0;
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    if (top - head < box.scrollTop) box.scrollTop = top - head;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [sel, tab]);

  if (physicalRead.error) return <div><p role="alert">{physicalRead.error}</p><button type="button" onClick={physicalRead.refresh} disabled={physicalRead.refreshing}>Retry source read</button></div>;
  if (!schedule) return <p>Reading physical wire pieces…</p>;
  const TABS: [Tab, string, number][] = schedule.tables.map(t => [t.id, t.title, t.rows.length]);
  if (isOwner) TABS.push(['open', 'Calls and decisions', map.calls.length]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div role="tablist" aria-label="Wiring schedules" style={{ display: 'flex', alignItems: 'stretch', borderBottom: rule(cw), overflowX: 'auto', flexShrink: 0 }}>
        {TABS.map(([k, l, n]) => (
          <button key={k} onClick={() => setTab(k)} aria-selected={tab === k} role="tab" style={{
            border: 'none', borderBottom: `2px solid ${tab === k ? cw.accent : 'transparent'}`, background: tab === k ? cw.surface : 'transparent',
            color: tab === k ? cw.ink : cw.inkMuted, fontFamily: cw.fontBody, fontSize: 13, fontWeight: 600, padding: '12px 14px', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{l} <span style={{ fontFamily: cw.fontMono, fontWeight: 400, opacity: 0.6 }}>{n}</span></button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 8px', borderBottom: rule(cw), flexShrink: 0, flexWrap: 'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find circuit, piece or connection" aria-label="Filter physical pieces"
          style={{ width: 220, border: `2px solid ${cw.border}`, background: cw.surface, color: cw.ink, fontFamily: cw.fontBody, fontSize: 14, minHeight: 44, padding: '5px 8px' }} />
        <button onClick={() => setOnlyLinked(v => !v)} aria-pressed={onlyLinked} style={{
          border: frame(cw), background: onlyLinked ? cw.ink : cw.surface, color: onlyLinked ? cw.surface : cw.ink, fontFamily: cw.fontBody, fontSize: 13, fontWeight: 600, minHeight: 44, padding: '5px 10px', cursor: 'pointer',
        }}>Linked to selection</button>
        <button type="button" onClick={() => { setExportError(null); physicalRead.refresh(); }} disabled={physicalRead.refreshing}
          style={{ border: frame(cw), background: cw.surface, color: cw.ink, font: 'inherit', minHeight: 44, padding: '5px 10px' }}>Refresh source</button>
        <button onClick={download} disabled={exporting || !vehicleId || tab === 'open'} title="Download the shown physical pieces and their related source records. The database source is verified before the file is saved."
          style={{ border: frame(cw), background: cw.accent, color: cw.onAccent, fontFamily: cw.fontBody, fontSize: 13, fontWeight: 600, minHeight: 44, padding: '5px 12px', cursor: 'pointer' }}>
          {exporting ? 'Verifying and preparing Excel…' : `Download Excel · ${schedule.tables[0].rows.length} shown pieces`}
        </button>
        <span style={{ marginLeft: 'auto', fontFamily: cw.fontMono, fontSize: 11, color: cw.inkMuted }}>{shown.length}{rows.length > shown.length ? ` of ${rows.length}` : ''} ROWS{sel ? ` · ${t.rows.filter(r => t.linked(r)).length} LINKED` : ''}</span>
      </div>
      {exportError && <div role="alert" style={{ padding: '8px 12px', color: cw.warn }}>{exportError}</div>}
      <div style={{ padding: '6px 10px', fontSize: 12, color: cw.inkMuted, borderBottom: rule(cw) }}>
        {schedule.scopeLabel}. Blank means not recorded in this reader; planned lengths need physical verification. {physicalRead.refreshing && 'Checking current source…'}
      </div>
      <div ref={wrap} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 14, fontFamily: cw.fontBody }}>
          <thead><tr>{t.cols.map(c => (
            <th key={c.h} style={{ position: 'sticky', top: 0, background: cw.surface, textAlign: c.num ? 'right' : 'left', fontSize: 12, fontWeight: 600, color: cw.inkMuted, padding: '6px 8px', borderBottom: `2px solid ${cw.border}`, whiteSpace: 'nowrap' }}>{c.h}</th>
          ))}</tr></thead>
          <tbody>{shown.map(r => {
            const id = t.id(r), pri = priOf(r), lk = !pri && !!sel && t.linked(r);
            return (
              <tr key={r.id} data-pri={pri ? '1' : undefined} data-rel={lk ? '1' : undefined}
                tabIndex={id || r.record ? 0 : undefined} aria-selected={pri} onClick={() => { if (r.record) onRecord(r.record); else if (id) onSelect(id); }}
                onKeyDown={e => { if ((id || r.record) && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (r.record) onRecord(r.record); else onSelect(id); } }}
                style={{ cursor: id ? 'pointer' : 'default', background: pri ? `${cw.accent}33` : lk ? `${cw.accent}14` : 'transparent' }}>
                {t.cols.map(c => (
                  <td key={c.h} title={String(c.v(r))} style={{
                    padding: '8px 10px', borderBottom: rule(cw), whiteSpace: /cavity/i.test(c.h) ? 'normal' : 'nowrap',
                    minWidth: /cavity/i.test(c.h) ? 200 : undefined, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: c.w ?? 230,
                    fontFamily: c.mono ? cw.fontMono : cw.fontBody, textAlign: c.num ? 'right' : 'left', color: cw.ink,
                  }}>{c.td ? c.td(r) : String(c.v(r))}</td>
                ))}
              </tr>
            );
          })}</tbody>
        </table>
        {!shown.length && <div style={{ padding: 16, color: cw.inkMuted, fontSize: 12 }}>No records match this filter.</div>}
      </div>
    </div>
  );
}
