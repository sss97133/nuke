// map/WorkspaceViews.tsx — the MAP workspace's 2D views: the plan (our own truck outline from planGeometry, parts at
// their true size and colour, looms at their true outer diameter) and the connector face (cavities at true pitch from
// the part models' pins, else listed in order). Colour is data only: once something is selected, what is not linked
// to it goes neutral, so the selection is the only saturated thing on the drawing.

import React, { useMemo, useRef, useState } from 'react';
import type { Colorway } from '../connector-inspector/colorways';
import { frame, rule } from '../connector-inspector/colorways';
import { PlanEnvelope, SC, VBH, VBW, sx, sy } from '../planGeometry';
import { kindOf, valOf, type Rel, type SiteFiles, type WsIndex } from './useWorkspaceSelection';

type Box = { x: number; y: number; w: number; h: number };
const FIT: Box = { x: 0, y: 0, w: VBW, h: VBH };

export function PlanView({ cw, ix, site, sel, rel, onSelect }: {
  cw: Colorway; ix: WsIndex; site: SiteFiles; sel: string | null; rel: Rel; onSelect: (id: string) => void;
}) {
  const [vb, setVb] = useState<Box>(FIT);
  const drag = useRef<{ x: number; y: number; vb: Box; moved: boolean } | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const has = !!sel;
  const selCode = kindOf(sel) === 'n' ? valOf(sel) : kindOf(sel) === 'p' ? valOf(sel).split('|')[0] : null;
  const toSvg = (cx: number, cy: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    const k = Math.max(vb.w / r.width, vb.h / r.height);
    const ox = vb.x - (r.width * k - vb.w) / 2, oy = vb.y - (r.height * k - vb.h) / 2;
    return { x: ox + (cx - r.left) * k, y: oy + (cy - r.top) * k };
  };
  const zoom = (f: number, cx: number, cy: number) => {
    const p = toSvg(cx, cy);
    const w = Math.min(VBW * 1.4, Math.max(VBW / 40, vb.w * f)), h = w * (vb.h / vb.w);
    setVb({ x: p.x - (p.x - vb.x) * (w / vb.w), y: p.y - (p.y - vb.y) * (h / vb.h), w, h });
  };
  const k = vb.w / VBW;                       // stroke floor scales with zoom so a loom never vanishes
  const segs = useMemo(() => site.segs.slice().sort((a, b) => Number(rel.segs.has(a.id)) - Number(rel.segs.has(b.id))), [site.segs, rel]);
  const ends = Object.entries(site.ends);
  const sel0 = selCode ? site.ends[selCode] : null;

  return (
    <div style={{ position: 'relative', height: '100%', background: cw.surface }}>
      <svg ref={svg} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Plan view of the truck with the harness"
        style={{ width: '100%', height: '100%', display: 'block', cursor: drag.current?.moved ? 'grabbing' : 'grab', touchAction: 'none' }}
        onWheel={e => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0016), e.clientX, e.clientY); }}
        onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vb, moved: false }; }}
        onPointerMove={e => {
          const d = drag.current; if (!d) return;
          const r = svg.current?.getBoundingClientRect(); if (!r) return;
          const kk = Math.max(d.vb.w / r.width, d.vb.h / r.height), dx = (e.clientX - d.x) * kk, dy = (e.clientY - d.y) * kk;
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
          if (d.moved) setVb({ ...d.vb, x: d.vb.x - dx, y: d.vb.y - dy });
        }}
        onPointerUp={e => {
          const d = drag.current; drag.current = null;
          if (d && !d.moved) {
            const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sel]') as HTMLElement | SVGElement | null;
            const id = hit?.getAttribute('data-sel'); if (id) onSelect(id);
          }
        }}>
        <PlanEnvelope body={cw.faceStroke} border={cw.border} muted={cw.inkFaint} font={cw.fontBody} />
        {segs.map(s => {
          const pts = s.pts.map(p => `${sx(p[1]).toFixed(1)},${sy(p[0]).toFixed(1)}`).join(' ');
          const on = sel === 's:' + s.id, linked = rel.segs.has(s.id);
          const color = !has ? cw.ink : on || linked ? cw.accent : cw.border;
          const w = Math.max(((s.od ?? 6) / 1000) * SC * (s.par || 1), 1.3 * k);
          return (
            <g key={s.id} data-sel={'s:' + s.id} style={{ cursor: 'pointer' }}>
              <polyline points={pts} fill="none" stroke={cw.surface} strokeWidth={w + 1.4 * k} strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={pts} fill="none" stroke={color} strokeOpacity={has && linked && !on ? 0.7 : 1} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={pts} fill="none" stroke="transparent" strokeWidth={Math.max(w * 2, 8 * k)}><title>{`${s.id} · ${s.b ?? ''} · ${s.w.length} wires · ⌀${s.od ?? '?'} mm`}</title></polyline>
            </g>
          );
        })}
        {ends.filter(([, e]) => e.size).sort((a, b) => area(b[1]) - area(a[1])).map(([code, e]) => {
          const cx = sx(e.xyz[1]), cy = sy(e.xyz[0]);
          const wv = ((e.size?.shape === 'disc' ? e.size.d : e.size?.dy) ?? 0) / 1000 * SC, hv = ((e.size?.shape === 'disc' ? e.size.d : e.size?.dx) ?? 0) / 1000 * SC;
          const on = selCode === code || (kindOf(sel) === 'd' && ix.devOf(code) === valOf(sel)), linked = rel.nodes.has(code);
          const fill = !has ? (e.color ?? cw.elevated) : on ? cw.accent : cw.elevated;
          const stroke = has && (on || linked) ? cw.accent : cw.faceStroke;
          const node = ix.byCode.get(code);
          return (
            <g key={code} data-sel={node ? 'n:' + code : undefined} style={{ cursor: node ? 'pointer' : 'default' }}>
              {e.size?.shape === 'disc' && e.size.axis === 'z'
                ? <ellipse cx={cx} cy={cy} rx={wv / 2} ry={hv / 2} fill={fill} stroke={stroke} strokeWidth={(on || linked) && has ? 1.6 * k : 0.6 * k} />
                : <rect x={cx - wv / 2} y={cy - hv / 2} width={wv} height={hv} fill={fill} fillOpacity={has && !on ? 0.55 : 1} stroke={stroke} strokeWidth={(on || linked) && has ? 1.6 * k : 0.6 * k} />}
              <title>{`${code} · ${node?.name ?? e.dev_name}`}</title>
            </g>
          );
        })}
        {sel0 && (() => {
          const cx = sx(sel0.xyz[1]), cy = sy(sel0.xyz[0]), m = ((sel0.margin_mm ?? 0) / 1000) * SC;
          const L = Math.max(m, 0.06 * SC) * 1.35;
          return (
            <g pointerEvents="none">
              {!sel0.size && <><line x1={cx - L} y1={cy} x2={cx + L} y2={cy} stroke={cw.accent} strokeWidth={1.4 * k} /><line x1={cx} y1={cy - L} x2={cx} y2={cy + L} stroke={cw.accent} strokeWidth={1.4 * k} /></>}
              {m > 0 && <circle cx={cx} cy={cy} r={m} fill="none" stroke={cw.accent} strokeWidth={1 * k} strokeDasharray={`${4 * k} ${3 * k}`} />}
              <text x={cx + 8 * k} y={cy - 6 * k} fontFamily={cw.fontMono} fontSize={9 * k} fontWeight={700} fill={cw.accent}>{selCode}{sel0.size ? '' : ' (NOT DRAWN TO SIZE)'}</text>
            </g>
          );
        })()}
      </svg>
      <div style={{ position: 'absolute', right: 8, top: 8, display: 'flex', gap: 4 }}>
        {[['−', 1.5], ['+', 1 / 1.5]].map(([l, f]) => (
          <button key={String(l)} onClick={() => { const r = svg.current?.getBoundingClientRect(); if (r) zoom(Number(f), r.left + r.width / 2, r.top + r.height / 2); }}
            style={btn(cw)} aria-label={l === '+' ? 'Zoom in' : 'Zoom out'}>{l}</button>
        ))}
        <button onClick={() => setVb(FIT)} style={btn(cw)}>FIT</button>
      </div>
      <div style={{ position: 'absolute', left: 8, bottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10.5, color: cw.inkMuted, background: cw.surface, border: rule(cw), padding: '3px 8px' }}>
        <span><Swatch c={cw.ink} /> LOOM AT TRUE OUTER DIAMETER</span>
        <span><Swatch c={cw.faceStroke} box /> PART AT TRUE SIZE AND COLOR</span>
        <span><Swatch c={cw.accent} /> SELECTED AND LINKED</span>
      </div>
    </div>
  );
}
const area = (e: { size?: { dx?: number; dy?: number; d?: number } }) => ((e.size?.dx ?? e.size?.d ?? 0) * (e.size?.dy ?? e.size?.d ?? 0));
const btn = (cw: Colorway): React.CSSProperties => ({ minWidth: 30, background: cw.surface, color: cw.ink, border: frame(cw), fontFamily: cw.fontBody, fontSize: 12, fontWeight: 700, padding: '2px 8px', cursor: 'pointer' });
function Swatch({ c, box }: { c: string; box?: boolean }) {
  return <span style={{ display: 'inline-block', width: box ? 10 : 16, height: box ? 8 : 0, borderTop: box ? undefined : `3px solid ${c}`, border: box ? `1px solid ${c}` : undefined, verticalAlign: 'middle', marginRight: 4 }} />;
}

export function ConnectorFace({ cw, ix, site, code, sel, rel, onSelect }: {
  cw: Colorway; ix: WsIndex; site: SiteFiles; code: string | null; sel: string | null; rel: Rel; onSelect: (id: string) => void;
}) {
  if (!code) return <div style={{ padding: 16, color: cw.inkMuted, fontSize: 13 }}>SELECT A CONNECTOR, A PIN OR A WIRE TO SEE ITS CONNECTOR FACE.</div>;
  const node = ix.byCode.get(code), pins = ix.pinsByNode.get(code) ?? [], face = site.ends[code]?.face;
  const selPin = kindOf(sel) === 'p' ? valOf(sel) : null;
  const wireColor = (wc: string) => ix.wireByCode.get(wc)?.color ?? '';
  const head = (
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', padding: '10px 14px 4px' }}>
      <span style={{ fontFamily: cw.fontMono, fontSize: 16, fontWeight: 700 }}>{code}</span>
      <span style={{ fontSize: 13 }}>{node?.name}</span>
      <span style={{ fontSize: 12, color: cw.inkMuted }}>{pins.length} CAVITIES WITH A WIRE ON FILE · VIEWED FROM THE WIRE SIDE</span>
    </div>
  );
  const pts = face ? Object.entries(face) : [];
  if (pts.length >= 2) {
    const xs = pts.map(([, p]) => p[0]), ys = pts.map(([, p]) => p[1]);
    let pitch = Infinity;
    pts.forEach(([, a], i) => pts.forEach(([, b], j) => { if (i < j) { const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d > 0.01 && d < pitch) pitch = d; } }));
    if (!isFinite(pitch)) pitch = 5;
    const r = pitch * 0.34, pad = pitch * 1.1;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = -Math.max(...ys) - pad, y1 = -Math.min(...ys) + pad + pitch * 0.6;
    const pinOf = (cav: string) => pins.find(p => p.cav === cav);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {head}
        <svg viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} style={{ flex: 1, minHeight: 0, width: '100%' }} role="img" aria-label={`Connector face of ${code}`}>
          <rect x={x0 + pad * 0.45} y={y0 + pad * 0.45} width={x1 - x0 - pad * 0.9} height={y1 - y0 - pad * 0.9} fill="none" stroke={cw.border} strokeWidth={pitch * 0.04} />
          {pts.map(([cav, p]) => {
            const pin = pinOf(cav), key = code + '|' + cav, on = selPin === key, linked = !on && !!sel && rel.pins.has(key);
            return (
              <g key={cav} onClick={() => onSelect('p:' + key)} style={{ cursor: 'pointer' }}>
                <title>{`${cav}${pin ? ' · wire ' + pin.wires.join(', ') + ' · ' + pin.wires.map(wireColor).join(', ') : ' · spare'}`}</title>
                <circle cx={p[0]} cy={-p[1]} r={r} fill={on ? cw.accent : pin ? cw.elevated : cw.surface} stroke={linked || on ? cw.accent : cw.faceStroke}
                  strokeWidth={pitch * (on || linked ? 0.1 : 0.04)} strokeDasharray={pin ? undefined : `${pitch * 0.12} ${pitch * 0.08}`} />
                <text x={p[0]} y={-p[1]} textAnchor="middle" dominantBaseline="central" fontFamily={cw.fontMono} fontWeight={700}
                  fontSize={pitch * (cav.length > 2 ? 0.24 : 0.3)} fill={on ? cw.onAccent : cw.ink}>{cav}</text>
                {pin && (() => {   // the wire under its cavity, sized to stay inside one pitch (monospace is ~0.6 em a character)
                  const label = pin.wires[0] + (pin.wires.length > 1 ? ` +${pin.wires.length - 1}` : '');
                  return <text x={p[0]} y={-p[1] + r + pitch * 0.26} textAnchor="middle" fontFamily={cw.fontMono} fill={cw.inkMuted}
                    fontSize={Math.min(pitch * 0.2, (pitch * 0.92) / (0.6 * label.length))}>{label}</text>;
                })()}
              </g>
            );
          })}
        </svg>
      </div>
    );
  }
  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      {head}
      <div style={{ padding: '4px 14px 12px', fontSize: 12, color: cw.inkMuted }}>NO CAVITY LAYOUT ON FILE FOR THIS CONNECTOR YET: ITS CAVITIES ARE LISTED IN ORDER.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 4, padding: '0 14px 14px' }}>
        {pins.map(p => {
          const key = code + '|' + p.cav, on = selPin === key, linked = !on && !!sel && rel.pins.has(key);
          return (
            <button key={key} onClick={() => onSelect('p:' + key)} style={{
              textAlign: 'left', border: `2px solid ${on || linked ? cw.accent : cw.border}`, background: on ? cw.accent : cw.surface, color: on ? cw.onAccent : cw.ink,
              padding: '4px 6px', cursor: 'pointer', fontFamily: cw.fontBody, fontSize: 11.5,
            }}>
              <div style={{ fontFamily: cw.fontMono, fontWeight: 700 }}>{p.cav || '—'}</div>
              <div style={{ opacity: 0.8 }}>{p.wires.join(' ')} {p.wires.map(wireColor).filter(Boolean)[0] ?? ''}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
