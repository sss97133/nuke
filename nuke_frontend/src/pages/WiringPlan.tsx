// WiringPlan.tsx — Parent page for /vehicle/:vehicleId/wiring
// Current typed-row workspace and owner-only data quality.
// Retired manifest-derived renderers are no longer route choices.

import React, { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useVehiclePermissions } from '../hooks/useVehiclePermissions';
import { supabase } from '../lib/supabase';
import HarnessModelView from '../components/wiring/model/HarnessModelView';

const WiringMap = React.lazy(() => import('../components/wiring/map/WiringMap').then(m => ({ default: m.WiringMap })));
// ── Design tokens ─────────────────────────────────────────────────────
const C = {
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  elevated: 'var(--surface)',
  text: 'var(--text)',
  label: 'var(--text-secondary)',
  muted: 'var(--text-secondary)',
  border: 'var(--border)',
  active: 'var(--accent)',
  pass: '#22c55e',
  warn: '#eab308',
  fail: '#ef4444',
} as const;

type ViewTab = 'map' | 'model';
const TABS: { id: ViewTab; label: string; key: string }[] = [
  { id: 'map', label: 'Wiring records', key: '1' },
  { id: 'model', label: 'Data quality', key: '2' },
];

export default function WiringPlan() {
  const { vehicleId } = useParams();

  // ── Data loading ──
  const [vehicleInfo, setVehicleInfo] = useState<{ year?: number; make?: string; model?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Shared selection state ──
  const [activeTab, setActiveTab] = useState<ViewTab>(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return TABS.some(x => x.id === t) ? (t as ViewTab) : 'map';
  });
  const { session } = useAuth();
  const { isOwner: isRowOwner } = useVehiclePermissions(vehicleId ?? null, session, null);
  // ?asOwner=1 previews the owner's tabs on the dev server only (import.meta.env.DEV), like the MAP tab's preview;
  // a build never honours it
  const isOwner = (!!session?.user && isRowOwner) || (import.meta.env.DEV && new URLSearchParams(window.location.search).get('asOwner') === '1');
  const shownTab: ViewTab = isOwner && activeTab === 'model' ? 'model' : 'map';
  // Old derived-view links resolve to current records; data quality remains owner-only.
  // Written through the router (a replace, no new history entry) so the MAP tab's own ?sel= writes keep it.
  const [, setUrlParams] = useSearchParams();
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === shownTab) return;
    setUrlParams(prev => { const p = new URLSearchParams(prev); p.set('tab', shownTab); return p; }, { replace: true });
  }, [shownTab]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { window.scrollTo(0, 0); }, []);   // land at the top: the site header stays in view
  const visibleTabs = isOwner ? TABS : TABS.filter(t => t.id === 'map');
  // Vehicle identity only; the workspace owns its one current harness read. ──
  useEffect(() => {
    let cancelled = false;
    setVehicleInfo(null);
    async function init() {
      if (!vehicleId) return;
      setLoading(true);
      try {
        const vehicleRes = await supabase.from('vehicles').select('year, make, model').eq('id', vehicleId).maybeSingle();
        if (!cancelled) setVehicleInfo(vehicleRes.data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [vehicleId]);

  // ── Loading state ──
  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 'calc(100vh - 42px)', background: C.bg, color: C.muted,
        fontFamily: "'Courier New', monospace", fontSize: 11,
      }}>
        LOADING HARNESS DATA...
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - 42px)',
      background: C.bg, color: C.text,
      fontFamily: 'var(--font-family)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* ── Status Bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '10px 12px', minHeight: 44,
        background: C.surface,
        borderBottom: `2px solid ${C.border}`,
        fontFamily: "'Courier New', monospace",
        fontSize: 14, fontWeight: 600,
        flexShrink: 0,
      }}>
        <span style={{ color: C.label, fontFamily: 'var(--font-family)', fontSize: 14 }}>
          {vehicleInfo ? `${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}` : 'VEHICLE'} — WIRING HARNESS
        </span>
      </div>

      {/* ── Tab Bar ── (scrolls sideways on a phone, so every tab stays reachable) */}
      {isOwner && <div style={{
        display: 'flex', alignItems: 'stretch',
        minHeight: 44, flexShrink: 0, overflowX: 'auto', overflowY: 'hidden',
        background: C.bg,
        borderBottom: `2px solid ${C.border}`,
      }}>
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: shownTab === tab.id ? C.elevated : 'transparent',
              color: shownTab === tab.id ? C.active : C.label,
              border: 'none',
              borderBottom: shownTab === tab.id ? `2px solid ${C.active}` : '2px solid transparent',
              padding: '0 16px',
              fontFamily: 'var(--font-family)',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 200ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>}

      {/* ── View Container ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Suspense fallback={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.muted, fontFamily: "'Courier New', monospace", fontSize: 11 }}>
            LOADING VIEW...
          </div>
        }>
          {shownTab === 'map' && (
            <div style={{ position: 'absolute', inset: 0 }}>
              <WiringMap key={vehicleId} vehicleId={vehicleId} />
            </div>
          )}
          {shownTab === 'model' && <HarnessModelView vehicleId={vehicleId} />}
        </Suspense>

      </div>

    </div>
  );
}
