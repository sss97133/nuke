// ConnectorInspector.tsx — CONNECTORS tab for /vehicle/:vehicleId/wiring.
// Skylar's directive (2026-06-10): the connector view must be EASY TO READ
// with click-to-swap presentations — "like old mp3 players on windows"
// (Winamp skins). ONE data object (deriveHarness over the cut-list registry,
// same ?wb=/?mg= toggles as the WORKBENCH tab) → four instantly-swappable
// skins: FACE | TABLE | BUILD | PRINT. Swap = render flip, zero refetch.
// All inspector state lives in URL params: ?ci= connector, ?skin= skin,
// ?sel= selected cavity, ?cw= colorway (localStorage fallback).
//
// COLORWAYS (Skylar's directive 2026-06-11): adopters are hard-core
// one-man-shop harness engineers coming from Excel sheets and paper layouts —
// traditional engineering tooling, never gimmick. PAPER (default) / LEDGER /
// CAD / SHOP — full visual swap, one click, same data. Tokens in
// connector-inspector/colorways.ts; zero hardcoded chrome below.

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ManifestDevice } from './overlayCompute';
import { deriveHarness, SUBSYSTEMS, type DerivationInput } from './harnessDerivation';
import type { ConnectorId, SkinId } from './connector-inspector/types';
import { buildConnectorModels } from './connector-inspector/buildConnectorModels';
import { useBuildState } from './connector-inspector/useBuildState';
import {
  COLORWAYS, COLORWAY_LIST, COLORWAY_STORAGE_KEY, ColorwayContext,
  DEFAULT_COLORWAY, frame, isColorwayId, rule, textOn, type ColorwayId,
} from './connector-inspector/colorways';
import { FaceSkin } from './connector-inspector/FaceSkin';
import { TableSkin } from './connector-inspector/TableSkin';
import { BuildSkin } from './connector-inspector/BuildSkin';
import { PrintSkin } from './connector-inspector/PrintSkin';

const CONNECTORS: { id: ConnectorId; label: string }[] = [
  { id: 'FIREWALL', label: 'FIREWALL 61-WAY' },
  { id: 'M130A', label: 'M130-A' },
  { id: 'M130B', label: 'M130-B' },
  { id: 'PDM30', label: 'PDM30' },
];

const SKINS: { id: SkinId; label: string }[] = [
  { id: 'face', label: 'FACE' },
  { id: 'table', label: 'TABLE' },
  { id: 'build', label: 'BUILD' },
  { id: 'print', label: 'PRINT' },
];

const CONNECTOR_IDS = new Set<string>(CONNECTORS.map(c => c.id));
const SKIN_IDS = new Set<string>(SKINS.map(s => s.id));

interface Props {
  devices: ManifestDevice[];
  vehicleId?: string;
}

export function ConnectorInspector({ devices, vehicleId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  // ── URL state ──
  const rawCi = searchParams.get('ci') || '';
  const rawSkin = searchParams.get('skin') || '';
  const connectorId: ConnectorId = CONNECTOR_IDS.has(rawCi) ? (rawCi as ConnectorId) : 'FIREWALL';
  const skin: SkinId = SKIN_IDS.has(rawSkin) ? (rawSkin as SkinId) : 'face';
  const selectedKey = searchParams.get('sel');

  // colorway: ?cw= wins, localStorage fallback, DEFAULT = PAPER
  const rawCw = searchParams.get('cw');
  const storedCw = typeof window !== 'undefined' ? window.localStorage.getItem(COLORWAY_STORAGE_KEY) : null;
  const colorwayId: ColorwayId = isColorwayId(rawCw) ? rawCw : isColorwayId(storedCw) ? storedCw : DEFAULT_COLORWAY;
  const cw = COLORWAYS[colorwayId];

  const setParams = (patch: Record<string, string | null>) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) p.delete(k);
        else p.set(k, v);
      }
      return p;
    }, { replace: true });
  };

  const setColorway = (id: ColorwayId) => {
    try { window.localStorage.setItem(COLORWAY_STORAGE_KEY, id); } catch { /* private mode */ }
    setParams({ cw: id });
  };

  // ── ONE derivation — same toggle params as the WORKBENCH tab (?wb=, ?mg=) ──
  const offRaw = searchParams.get('wb');
  const mechanicalGauges = searchParams.get('mg') === '1';
  const harness = useMemo(() => {
    const off = new Set(offRaw ? offRaw.split(',').filter(Boolean) : []);
    const toggles: Record<string, boolean> = {};
    for (const s of SUBSYSTEMS) toggles[s.id] = !off.has(s.id);
    const input: DerivationInput = { devices, toggles, mechanicalGauges };
    return deriveHarness(input);
  }, [devices, offRaw, mechanicalGauges]);

  // ── ONE data object per connector; skins are projections ──
  const models = useMemo(() => buildConnectorModels(harness), [harness]);
  const model = models[connectorId];

  // ── build_state workflow map (BUILD skin writes; badges everywhere) ──
  const build = useBuildState(vehicleId);

  // toast auto-dismiss
  useEffect(() => {
    if (!build.toast) return;
    const t = setTimeout(build.clearToast, 7000);
    return () => clearTimeout(t);
  }, [build.toast, build.clearToast]);

  const onSelect = (key: string | null) => setParams({ sel: key });

  // ── SHARE TO BUILDER — copy the zero-chrome public print package link
  // (/share/wiring/:vehicleId, receipt 2026-06-11_builder-share-view.md) ──
  const [shareCopied, setShareCopied] = useState(false);
  useEffect(() => {
    if (!shareCopied) return;
    const t = setTimeout(() => setShareCopied(false), 2500);
    return () => clearTimeout(t);
  }, [shareCopied]);
  const copyShareLink = async () => {
    if (!vehicleId) return;
    const url = `${window.location.origin}/share/wiring/${vehicleId}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
    } catch {
      window.prompt('Copy the builder link:', url);
    }
  };

  return (
    <ColorwayContext.Provider value={cw}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: cw.bg, position: 'relative' }}>
      {/* pulse animations for overflow / conflict. TEXT-ON-CHIP LAW: the
          pulse never touches text — .ci-pulse goes on the SVG chip circle
          (its letter is a sibling element), .ci-pulse-border animates only
          the border-color of the overflow buttons (implicit from/to = the
          element's own border color). */}
      <style>{`
        @keyframes ciPulse {0%,100%{opacity:1}50%{opacity:.55}} .ci-pulse{animation:ciPulse 1.4s ease-in-out infinite}
        @keyframes ciPulseBorder {50%{border-color:transparent}} .ci-pulse-border{animation:ciPulseBorder 1.4s ease-in-out infinite}
      `}</style>

      {/* ── shared header: connector picker + skin switcher + colorway picker ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
        borderBottom: frame(cw), background: cw.surface, flexWrap: 'wrap', flexShrink: 0,
      }}>
        {CONNECTORS.map(c => {
          const active = c.id === connectorId;
          const m = models[c.id];
          return (
            <button key={c.id} onClick={() => setParams({ ci: c.id, sel: null })} style={{
              background: active ? cw.elevated : 'transparent',
              color: active ? cw.accent : cw.inkMuted,
              border: `${cw.borderStyle === 'standard' ? 2 : 1}px solid ${active ? cw.accent : cw.border}`,
              fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, letterSpacing: 0.5,
              padding: '6px 12px', cursor: 'pointer',
            }}>
              {c.label}
              <span style={{ fontFamily: cw.fontMono, marginLeft: 8, color: active ? cw.ink : cw.inkFaint }}>
                {m.usedCount}/{m.totalCount}
              </span>
            </button>
          );
        })}

        <span style={{ marginLeft: 'auto', fontFamily: cw.fontBody, fontSize: 14, color: cw.inkFaint, marginRight: 4 }}>SKIN</span>
        <span style={{ display: 'inline-flex', border: frame(cw) }}>
          {SKINS.map(s => {
            const active = s.id === skin;
            return (
              <button key={s.id} onClick={() => setParams({ skin: s.id })} style={{
                background: active ? cw.accent : 'transparent',
                color: active ? cw.onAccent : cw.inkMuted,
                border: 'none',
                fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, letterSpacing: 1,
                padding: '6px 16px', cursor: 'pointer',
              }}>{s.label}</button>
            );
          })}
        </span>

        {/* colorway picker — swatch dots + label; Winamp-skin one-click swap */}
        <span style={{ marginLeft: 10, fontFamily: cw.fontBody, fontSize: 14, color: cw.inkFaint, marginRight: 4 }}>COLORWAY</span>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {COLORWAY_LIST.map(c => {
            const active = c.id === colorwayId;
            return (
              <button key={c.id} onClick={() => setColorway(c.id)} title={c.label} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: active ? cw.elevated : 'transparent',
                border: `${cw.borderStyle === 'standard' ? 2 : 1}px solid ${active ? cw.accent : cw.border}`,
                padding: '4px 8px', cursor: 'pointer',
              }}>
                {/* two half-blocks: theme bg | theme accent — no gradients */}
                <span style={{ display: 'inline-flex', width: 14, height: 14, border: `1px solid ${cw.border}` }}>
                  <span style={{ flex: 1, background: c.bg }} />
                  <span style={{ flex: 1, background: c.accent }} />
                </span>
                {active && (
                  <span style={{ fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, letterSpacing: 0.5, color: cw.ink }}>
                    {c.label}
                  </span>
                )}
              </button>
            );
          })}
        </span>

        {/* share affordance — owner copies the builder link, texts it */}
        {vehicleId && (
          <button onClick={copyShareLink} title={`${window.location.origin}/share/wiring/${vehicleId}`} style={{
            marginLeft: 10,
            background: shareCopied ? cw.ok : 'transparent',
            color: shareCopied ? textOn(cw.ok) : cw.inkMuted,
            border: `${cw.borderStyle === 'standard' ? 2 : 1}px solid ${shareCopied ? cw.ok : cw.border}`,
            fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, letterSpacing: 0.5,
            padding: '6px 12px', cursor: 'pointer',
          }}>
            {shareCopied ? 'LINK COPIED' : 'SHARE TO BUILDER'}
          </button>
        )}
      </div>

      {/* ── connector identity strip ── */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 12, padding: '6px 12px',
        borderBottom: rule(cw), flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontFamily: cw.fontBody, fontSize: 15, fontWeight: 700, letterSpacing: 1, color: cw.ink }}>
          {model.title}
        </span>
        <span style={{ fontFamily: cw.fontMono, fontSize: 14, color: cw.inkFaint }}>
          {model.subTitle}
        </span>
      </div>

      {/* ── active skin (instant swap — same model object, no refetch) ── */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {skin === 'face' && (
          <FaceSkin model={model} buildStates={build.states} selectedKey={selectedKey} onSelect={onSelect} />
        )}
        {skin === 'table' && (
          <TableSkin model={model} buildStates={build.states} selectedKey={selectedKey} onSelect={onSelect} />
        )}
        {skin === 'build' && <BuildSkin model={model} build={build} />}
        {skin === 'print' && <PrintSkin model={model} />}
      </div>

      {/* ── persistence error toast ── */}
      {build.toast && (
        <div
          onClick={build.clearToast}
          style={{
            position: 'absolute', bottom: 16, right: 16, maxWidth: 420, zIndex: 10,
            background: cw.surface, border: `2px solid ${cw.danger}`, color: cw.ink,
            fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, padding: '10px 14px', cursor: 'pointer',
          }}
        >
          {build.toast}
        </div>
      )}
    </div>
    </ColorwayContext.Provider>
  );
}

export default ConnectorInspector;
