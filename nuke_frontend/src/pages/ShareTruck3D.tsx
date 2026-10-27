// ShareTruck3D.tsx — public /share/truck/:vehicleId: the MAP tab's 3D truck, full viewport, no app chrome, logged out.
// The same renderer and data path as the MAP tab (ZoneModels3D over useWiringMap / useSiteFiles); the link names the
// scene: ?cam=bay|front|side|top|fit &pose=px,py,pz,tx,ty,tz &layers=frame,engine,... &harness=bay,cab,rear|off
// (scene3d.ts parseScene3d). Client view by default (no engineering chrome); ?client=0 brings the full toolbar back.
import React, { Suspense, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { COLORWAYS, ColorwayContext } from '../components/wiring/connector-inspector/colorways';
import { parseScene3d } from '../components/wiring/map/scene3d';
import { useWiringMap } from '../components/wiring/map/useWiringMap';
import { publicName, relOf, useSiteFiles, useWsIndex } from '../components/wiring/map/useWorkspaceSelection';

const ZoneModels3D = React.lazy(() => import('../components/wiring/map/ZoneModels3D'));
const cw = COLORWAYS.paper;
const noop = () => {};

export default function ShareTruck3D() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const [params, setParams] = useSearchParams();
  const init = useMemo(() => parseScene3d(params), []);   // eslint-disable-line react-hooks/exhaustive-deps -- read once
  // the switches keep the URL describing what is drawn, so a copied address is the same picture
  const onScene = (patch: Record<string, string | null>) => setParams(prev => {
    const p = new URLSearchParams(prev);
    Object.entries(patch).forEach(([k, v]) => (v === null ? p.delete(k) : p.set(k, v)));
    return p;
  }, { replace: true });
  const raw = useWiringMap(vehicleId);
  const site = useSiteFiles(vehicleId);
  const map = useMemo(() => ({
    ...raw,
    nodes: raw.nodes.map(n => ({ ...n, name: publicName(n.name) || n.code })),
    wires: raw.wires.map(w => ({ ...w, name: publicName(w.name) || w.code })),
  }), [raw]);
  const ix = useWsIndex(map, site);
  const rel = useMemo(() => relOf(null, ix, map), [ix, map]);
  return (
    <ColorwayContext.Provider value={cw}>
      <div style={{ position: 'fixed', inset: 0, background: cw.surface }}>
        <Suspense fallback={<div style={{ padding: 16, fontSize: 12, color: cw.inkMuted }}>LOADING THE TRUCK…</div>}>
          <ZoneModels3D cw={cw} ix={ix} site={site} sel={null} rel={rel} onSelect={noop} init={init} client={init.client !== false} onScene={onScene} />
        </Suspense>
      </div>
    </ColorwayContext.Provider>
  );
}
