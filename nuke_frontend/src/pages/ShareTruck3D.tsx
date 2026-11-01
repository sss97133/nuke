// ShareTruck3D.tsx — public /share/truck/:vehicleId: the MAP tab's 3D truck, full viewport, no app chrome, logged out.
// The same renderer and data path as the MAP tab (ZoneModels3D over useWiringMap / useSiteFiles); the link names the
// scene: ?cam=bay|front|side|top|fit &pose=px,py,pz,tx,ty,tz &layers=frame,engine,... &harness=bay,cab,rear|off
// (scene3d.ts parseScene3d). Client view by default (no engineering chrome); ?client=0 brings the full toolbar back.
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { COLORWAYS, ColorwayContext } from '../components/wiring/connector-inspector/colorways';
import { useScene3dURL } from '../components/wiring/map/useScene3dURL';
import { useWiringMap } from '../components/wiring/map/useWiringMap';
import { publicName, relOf, useSiteFiles, useWsIndex } from '../components/wiring/map/useWorkspaceSelection';
import './shared-truck.css';

// Fixed scene subject, not year/model eligibility. Both retained source manifests
// public/wiring/k5-positions.json and k5-routes.json bind these assets to this ID.
export const TRUCK_SCENE_VEHICLE_ID = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';

const ZoneModels3D = React.lazy(() => import('../components/wiring/map/ZoneModels3D'));
const cw = COLORWAYS.paper;
const noop = () => {};

export default function ShareTruck3D() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const subject = vehicleId?.toLowerCase();
  return <ColorwayContext.Provider value={cw}><div className="shared-truck">
    {subject === TRUCK_SCENE_VEHICLE_ID
      ? <VerifiedTruck key={subject} vehicleId={subject} />
      : <TruckStatus message="No shared truck model is available for this vehicle." />}
  </div></ColorwayContext.Provider>;
}

function TruckStatus({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="shared-truck-status" role="status"><p>{message}</p>
    {retry && <button type="button" onClick={retry}>Retry truck read</button>}
  </div>;
}

function VerifiedTruck({ vehicleId }: { vehicleId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const retry = () => { setState('loading'); setAttempt(value => value + 1); };
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(supabase.from('vehicles').select('id,deleted_at').eq('id', vehicleId).is('deleted_at', null).maybeSingle())
      .then(({ data, error }) => {
        if (!cancelled) setState(error ? 'error' : data?.id === vehicleId && data.deleted_at === null ? 'ready' : 'missing');
      }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [vehicleId, attempt]);
  if (state === 'loading') return <TruckStatus message="Reading the shared truck…" />;
  if (state === 'error') return <TruckStatus message="The shared truck could not be read." retry={retry} />;
  if (state === 'missing') return <TruckStatus message="The shared truck is unavailable in this read." />;
  return <TruckScene key={attempt} vehicleId={vehicleId} retry={retry} />;
}

function TruckScene({ vehicleId, retry }: { vehicleId: string; retry: () => void }) {
  const [params, setParams] = useSearchParams();
  // the switches keep the URL describing what is drawn, so a copied address is the same picture
  const writeScene = (patch: Record<string, string | null>) => setParams(prev => {
    const p = new URLSearchParams(prev);
    Object.entries(patch).forEach(([k, v]) => (v === null ? p.delete(k) : p.set(k, v)));
    return p;
  }, { replace: true });
  const { init, revision, onScene } = useScene3dURL(params, writeScene);
  const raw = useWiringMap(vehicleId);
  const site = useSiteFiles(vehicleId);
  const map = useMemo(() => ({
    ...raw,
    nodes: raw.nodes.map(n => ({ ...n, name: publicName(n.name) || n.code })),
    wires: raw.wires.map(w => ({ ...w, name: publicName(w.name) || w.code })),
  }), [raw]);
  const ix = useWsIndex(map, site);
  const rel = useMemo(() => relOf(null, ix, map), [ix, map]);
  if (raw.error || site.error) return <TruckStatus message="The truck scene could not be read." retry={retry} />;
  if (!raw.loaded || !site.loaded) return <TruckStatus message="Reading the truck scene…" />;
  if (site.sourceVehicleId !== vehicleId) return <TruckStatus message="The design files do not identify this truck." retry={retry} />;
  return (
        <Suspense fallback={<TruckStatus message="Loading the truck scene…" />}>
          <ZoneModels3D key={revision} cw={cw} ix={ix} site={site} sel={null} rel={rel} onSelect={noop} init={init} client={init.client !== false} onScene={onScene} />
        </Suspense>
  );
}
