// connector-inspector/FaceSkin.tsx — the connector face LARGE.
// Zoom-to-fit + wheel/pinch zoom + drag pan; function-group colors; spares
// dimmed; gauge-conflict cavities + overflow wires pulse; click a cavity →
// right-side wire detail card. Pure render of ConnectorModel.
// All chrome from the active Colorway (colorways.ts): PAPER draws a faint
// graph-paper grid; LEDGER fills cavities with restrained tints + group rings;
// CAD is monochrome line-art with group color ONLY on hover/selection (and a
// solid accent chip when selected); SHOP is dark navy with dark desaturated
// chips + group-color rings. TEXT-ON-CHIP LAW: cavity letters always render
// at full contrast against the composited chip (textOn), never dimmed per
// state — de-emphasis is fill saturation + ring weight only.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DerivedWire } from '../harnessDerivation';
import type { ConnectorModel, InspectorCavity } from './types';
import { colorParts } from './colorCodes';
import {
  compositeOver, frame, rule, SPARE_FILL_OPACITY, textOn, useColorway, type Colorway,
} from './colorways';
import { BUILD_STATE_LABELS, type BuildState } from './useBuildState';

interface ViewState { k: number; tx: number; ty: number }

interface Props {
  model: ConnectorModel;
  buildStates: Record<string, BuildState>;
  selectedKey: string | null;          // cavity key, or 'wire:<id>' for overflow
  onSelect: (key: string | null) => void;
}

export function FaceSkin({ model, buildStates, selectedKey, onSelect }: Props) {
  const cw = useColorway();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<ViewState | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null); // CAD monochrome reveal
  const fitKRef = useRef(1);
  const interactedRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: number } | null>(null);

  // ── container size ──
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback((w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    const k = Math.min(w / model.viewW, h / model.viewH) * 0.95;
    fitKRef.current = k;
    setView({ k, tx: (w - model.viewW * k) / 2, ty: (h - model.viewH * k) / 2 });
  }, [model.viewW, model.viewH]);

  // fit on connector change; refit on resize unless the user has zoomed/panned
  useEffect(() => {
    interactedRef.current = false;
    fit(size.w, size.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.id]);
  useEffect(() => {
    if (!interactedRef.current) fit(size.w, size.h);
  }, [size, fit]);

  // ── wheel / trackpad-pinch zoom (native listener: React wheel is passive) ──
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      interactedRef.current = true;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView(v => {
        if (!v) return v;
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)); // ctrlKey wheel = trackpad pinch
        const k = Math.min(Math.max(v.k * factor, fitKRef.current * 0.4), fitKRef.current * 14);
        const s = k / v.k;
        return { k, tx: px - (px - v.tx) * s, ty: py - (py - v.ty) * s };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── drag pan ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (!view) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
    if (d.moved > 3) {
      interactedRef.current = true;
      setView(v => (v ? { ...v, tx: d.tx + dx, ty: d.ty + dy } : v));
    }
  };
  const onPointerUp = () => { setTimeout(() => { dragRef.current = null; }, 0); };

  const clickIsClean = () => !dragRef.current || dragRef.current.moved <= 4;

  const zoomBy = (factor: number) => {
    interactedRef.current = true;
    setView(v => {
      if (!v) return v;
      const k = Math.min(Math.max(v.k * factor, fitKRef.current * 0.4), fitKRef.current * 14);
      const s = k / v.k;
      const cxp = size.w / 2, cyp = size.h / 2;
      return { k, tx: cxp - (cxp - v.tx) * s, ty: cyp - (cyp - v.ty) * s };
    });
  };

  // ── selection resolution ──
  const selCavity = selectedKey && !selectedKey.startsWith('wire:')
    ? model.cavities.find(c => c.key === selectedKey) || null : null;
  const selWire = selectedKey?.startsWith('wire:')
    ? [...model.overflow, ...model.directFeed].find(w => w.id === selectedKey.slice(5)) || null : null;

  const palette = cw.functionGroupPalette;

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* ── canvas column ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        ref={wrapRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', background: cw.bg, cursor: cw.faceCursor, minWidth: 0, minHeight: 0 }}
      >
        <svg
          width="100%" height="100%" style={{ display: 'block', userSelect: 'none', touchAction: 'none' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        >
          {/* graph-paper / cell grid — real SVG lines, screen-space, 0.5px */}
          {cw.gridLine && (
            <>
              <defs>
                <pattern id="ciGraphGrid" width={18} height={18} patternUnits="userSpaceOnUse">
                  <path d="M 18 0 L 0 0 0 18" fill="none" stroke={cw.gridLine} strokeWidth={0.5} />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#ciGraphGrid)" />
            </>
          )}
          {view && (
            <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
              {model.outlines.map((o, i) =>
                o.kind === 'circle' ? (
                  <circle key={i} cx={o.cx} cy={o.cy} r={o.r} fill="none" stroke={cw.faceStroke} strokeWidth={o.width} />
                ) : o.kind === 'rect' ? (
                  <rect key={i} x={o.x} y={o.y} width={o.w} height={o.h} fill="none" stroke={cw.faceStroke} strokeWidth={o.width} />
                ) : (
                  <text key={i} x={o.x} y={o.y} fontFamily={cw.fontBody} fontSize={o.size} fontWeight={700}
                    letterSpacing={1} fill={cw.inkMuted} textAnchor="middle">{o.text}</text>
                ),
              )}
              {model.cavities.map(c => {
                const occupied = c.wires.length > 0 || c.pdmState === 'live';
                const selected = c.key === selectedKey;
                const hot = selected || hoverKey === c.key;       // CAD color reveal
                const mono = cw.monochromeFace && !hot;
                const groupColor = palette[c.group];
                const w0 = c.wires[0];
                const tip = w0
                  ? `${c.key}: ${c.wires.map(w => `#${w.id} ${w.label}`).join(' · ')}`
                  : `${c.key}: ${c.funcLabel ? `${c.funcLabel} — ` : ''}${c.pdmState === 'live' ? 'BUS/SUPPLY' : 'SPARE'}`;
                const twoChar = c.label.length >= 2;
                // CAD: SELECTED = solid accent-yellow chip (black letter) —
                // unambiguous vs the warn ring on conflict cavities.
                const cadSelected = cw.monochromeFace && selected;
                const chipColor = mono ? cw.bg : cadSelected ? cw.accent : groupColor;
                const chipOpacity = mono || cadSelected ? 1
                  : occupied ? cw.faceFillOpacity : SPARE_FILL_OPACITY;
                const ringColor = selected ? cw.accent
                  : c.conflict ? cw.warn
                  : mono ? (occupied ? cw.inkFaint : cw.border)
                  : occupied ? (cw.faceOccupiedStroke === 'group' ? groupColor : cw.ink)
                  : cw.border;
                // TEXT-ON-CHIP LAW: the letter is ALWAYS full contrast against
                // what is actually rendered behind it (chip composited over
                // bg), picked per luminance — never dimmed per state.
                // De-emphasis = fill saturation + ring weight only.
                const textFill = textOn(compositeOver(chipColor, cw.bg, chipOpacity));
                return (
                  <g key={c.key}
                    onClick={() => { if (clickIsClean()) onSelect(selected ? null : c.key); }}
                    onPointerEnter={() => setHoverKey(c.key)}
                    onPointerLeave={() => setHoverKey(k => (k === c.key ? null : k))}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* pulse animates the CHIP only — the letter never dims */}
                    <circle
                      cx={c.x} cy={c.y} r={c.r}
                      className={c.conflict ? 'ci-pulse' : undefined}
                      fill={chipColor}
                      fillOpacity={chipOpacity}
                      stroke={ringColor}
                      strokeWidth={selected ? 5 : c.conflict ? 3.5 : occupied ? 2 : 1}
                    />
                    <text
                      x={c.x} y={c.y + (c.funcLabel ? -1 : c.r * 0.3)}
                      fontFamily={cw.fontMono}
                      fontSize={twoChar ? c.r * 0.66 : c.r * 0.85}
                      fontWeight={occupied ? 700 : 400}
                      fill={textFill}
                      textAnchor="middle"
                    >
                      {c.label}
                    </text>
                    {c.funcLabel && (
                      <text x={c.x} y={c.y + c.r * 0.55} fontFamily={cw.fontMono}
                        fontSize={c.r * 0.4} fontWeight={700}
                        fill={textFill} textAnchor="middle">
                        {c.funcLabel}
                      </text>
                    )}
                    <title>{tip}</title>
                  </g>
                );
              })}
            </g>
          )}
        </svg>

        {/* zoom controls */}
        <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 4 }}>
          {([['FIT', () => { interactedRef.current = false; fit(size.w, size.h); }], ['+', () => zoomBy(1.35)], ['−', () => zoomBy(1 / 1.35)]] as const).map(([lbl, fn]) => (
            <button key={lbl} onClick={fn} style={{
              background: cw.surface, color: cw.ink, border: frame(cw),
              fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, padding: '4px 12px', cursor: 'pointer',
            }}>{lbl}</button>
          ))}
        </div>

        {/* legend */}
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {([['SENSOR/SIG', palette.sensor], ['DRIVE', palette.drive], ['POWER', palette.power], ['CAN/FREED', palette.can], ['SPARE', palette.spare]] as const).map(([lbl, col]) => (
            <span key={lbl} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 12, background: col, border: `1px solid ${cw.border}`, display: 'inline-block' }} />
              <span style={{ fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, color: cw.inkMuted }}>{lbl}</span>
            </span>
          ))}
        </div>

      </div>

      {/* overflow / direct-feed strip — below the canvas so it never occludes cavities */}
      {(model.overflow.length > 0 || model.directFeed.length > 0) && (
        <div style={{
          flexShrink: 0, maxHeight: 130, overflowY: 'auto',
          borderTop: model.overflow.length > 0 ? `2px solid ${cw.warn}` : frame(cw),
          background: cw.bg, padding: '8px 12px',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
        }}>
          {model.overflow.length > 0 && (
            <>
              <span style={{ fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, color: cw.warn, marginRight: 4 }}>
                OVERFLOW — CROSSES FIREWALL, NO CAVITY ({model.overflow.length})
              </span>
              {/* pulse animates the BORDER only — chip text never dims */}
              {model.overflow.map(w => {
                const sel = selectedKey === `wire:${w.id}`;
                return (
                  <button key={w.id} className="ci-pulse-border" onClick={() => onSelect(sel ? null : `wire:${w.id}`)} style={{
                    background: sel ? cw.warn : 'transparent', color: sel ? textOn(cw.warn) : cw.warn,
                    border: `2px solid ${cw.warn}`, fontFamily: cw.fontMono,
                    fontSize: 14, fontWeight: 700, padding: '2px 8px', cursor: 'pointer',
                  }}>#{w.id}</button>
                );
              })}
            </>
          )}
          {model.directFeed.length > 0 && (
            <>
              <span style={{ fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, color: cw.inkMuted, margin: '0 4px 0 12px' }}>
                DIRECT FEED ({model.directFeed.length})
              </span>
              {/* de-emphasis = thin border only; text stays >= inkMuted (full
                  contrast on bg) — never inkFaint (the gray-on-navy defect) */}
              {model.directFeed.map(w => {
                const sel = selectedKey === `wire:${w.id}`;
                return (
                  <button key={w.id} onClick={() => onSelect(sel ? null : `wire:${w.id}`)} style={{
                    background: sel ? cw.inkMuted : 'transparent', color: sel ? textOn(cw.inkMuted) : cw.inkMuted,
                    border: rule(cw), fontFamily: cw.fontMono,
                    fontSize: 14, padding: '2px 8px', cursor: 'pointer',
                  }}>#{w.id}</button>
                );
              })}
            </>
          )}
        </div>
      )}
      </div>

      {/* ── detail card ── */}
      <DetailCard model={model} cavity={selCavity} wire={selWire} buildStates={buildStates} cw={cw} onClose={() => onSelect(null)} />
    </div>
  );
}

// ── right-side detail card ─────────────────────────────────────────────
function DetailCard({ model, cavity, wire, buildStates, cw, onClose }: {
  model: ConnectorModel;
  cavity: InspectorCavity | null;
  wire: DerivedWire | null;
  buildStates: Record<string, BuildState>;
  cw: Colorway;
  onClose: () => void;
}) {
  const wires = cavity ? cavity.wires : wire ? [wire] : [];
  const heading = cavity
    ? `CAVITY ${cavity.key}${cavity.funcLabel ? ` — ${cavity.funcLabel}` : ''}`
    : wire ? `WIRE #${wire.id} — NO CAVITY` : null;

  return (
    <div style={{
      width: 320, flexShrink: 0, borderLeft: frame(cw), background: cw.surface,
      overflowY: 'auto', padding: '12px 14px', color: cw.ink, fontFamily: cw.fontBody,
    }}>
      {!heading && (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1, color: cw.inkMuted, marginBottom: 10 }}>
            {model.title}
          </div>
          <div style={{ fontSize: 14, color: cw.inkFaint, lineHeight: 1.6 }}>
            {model.usedCount}/{model.totalCount} CAVITIES USED
            {model.overflow.length > 0 ? ` — ${model.overflow.length} OVERFLOW` : ''}
            <br /><br />
            CLICK A CAVITY FOR WIRE DETAIL.<br />
            SCROLL / PINCH TO ZOOM, DRAG TO PAN.
          </div>
        </>
      )}
      {heading && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 10 }}>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: 1 }}>{heading}</span>
            <button onClick={onClose} style={{
              marginLeft: 'auto', background: 'transparent', color: cw.inkFaint,
              border: rule(cw), fontSize: 14, padding: '2px 8px', cursor: 'pointer',
            }}>✕</button>
          </div>
          {wires.length === 0 && (
            <div style={{ fontSize: 14, color: cw.inkFaint }}>
              {cavity?.pdmState === 'live' ? 'BUS / SUPPLY PIN — NO HARNESS WIRE ROW.' : 'SPARE — SEAL PLUG.'}
            </div>
          )}
          {wires.map(w => <WireCard key={w.id} w={w} state={buildStates[w.id] ?? 'uncut'} cw={cw} />)}
        </>
      )}
    </div>
  );
}

function WireCard({ w, state, cw }: { w: DerivedWire; state: BuildState; cw: Colorway }) {
  const parts = colorParts(w.color);
  return (
    <div style={{ border: frame(cw), padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontFamily: cw.fontMono, fontSize: 19, fontWeight: 700, color: cw.accent }}>
          #{w.id}
        </span>
        <span style={{
          marginLeft: 'auto', background: cw.buildState[state], color: textOn(cw.buildState[state]),
          fontSize: 14, fontWeight: 700, padding: '2px 8px', letterSpacing: 0.5,
        }}>
          {BUILD_STATE_LABELS[state]}
        </span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{w.label}</div>
      <Field cw={cw} label="COLOR">
        <span style={{ display: 'inline-flex', width: 30, height: 16, border: `1px solid ${cw.swatchBorder}`, verticalAlign: 'middle', marginRight: 8 }}>
          {parts.map((p, i) => <span key={i} style={{ flex: 1, background: p }} />)}
        </span>
        {w.color}
      </Field>
      <Field cw={cw} label="GAUGE">
        {w.effectiveGauge} AWG{w.gaugeChangedFromSpec ? ` (SPEC ${w.gauge} — VDROP UPSIZE)` : ''}
      </Field>
      <Field cw={cw} label="SPEC">{w.spec}</Field>
      <Field cw={cw} label="LENGTH">{w.lengthFt} FT ({w.lengthMethod === 'cutlist_estimate' ? 'CUT-LIST EST' : 'LANDMARK DERIVED'})</Field>
      <Field cw={cw} label="FROM">{w.fromPin}</Field>
      <Field cw={cw} label="TO">{w.toDest}</Field>
      <Field cw={cw} label="SUBSYSTEM">{w.subsystem}</Field>
      <Field cw={cw} label="SIGNAL">{w.signalType}</Field>
      {w.companions.length > 0 && <Field cw={cw} label="COMPANIONS">{w.companions.map(c => `#${c}`).join(', ')}</Field>}
    </div>
  );
}

function Field({ label, children, cw }: { label: string; children: React.ReactNode; cw: Colorway }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.7, alignItems: 'baseline' }}>
      <span style={{ width: 92, flexShrink: 0, color: cw.inkFaint, fontWeight: 700, letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontFamily: cw.fontMono, color: cw.ink, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}
