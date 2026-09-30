// map/ZoneModels3D.tsx — the MAP workspace's 3D view: harness-cad's routed harness, one zone at a time (engine bay,
// cab, rear), fetched only when the zone is opened (each GLB is ours alone, under 10 MB, scene extras stripped).
// A mesh names its end (node extras "endpoint") or its route segment (node name); the selection and what links to it
// take the accent, everything else goes neutral grey, so the selection is the only colour in the scene.

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Bounds, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { Colorway } from '../connector-inspector/colorways';
import { frame } from '../connector-inspector/colorways';
import type { Rel, WsIndex } from './useWorkspaceSelection';

const ZONES: [string, string][] = [['bay', 'ENGINE BAY'], ['cab', 'CAB'], ['rear', 'REAR']];

export default function ZoneModels3D({ cw, ix, sel, rel, onSelect }: {
  cw: Colorway; ix: WsIndex; sel: string | null; rel: Rel; onSelect: (id: string) => void;
}) {
  const [zone, setZone] = useState('bay');
  return (
    <div style={{ position: 'relative', height: '100%', background: cw.surface }}>
      <Canvas camera={{ position: [2.4, 1.7, 2.6], fov: 32, near: 0.01, far: 200 }} dpr={[1, 2]} style={{ background: cw.surface }}>
        <ambientLight intensity={0.9} />
        <hemisphereLight args={['#ffffff', '#8a8f96', 0.7]} />
        <directionalLight position={[3, 5, 4]} intensity={1.5} />
        <directionalLight position={[-4, 3, -3]} intensity={0.6} />
        <Suspense fallback={null}>
          <Zone url={`/models/k5-harness-v4-${zone}.glb`} ix={ix} sel={sel} rel={rel} accent={cw.accent} onSelect={onSelect} />
        </Suspense>
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
      </Canvas>
      <div style={{ position: 'absolute', left: 8, top: 8, display: 'flex', gap: 4 }}>
        {ZONES.map(([z, l]) => (
          <button key={z} onClick={() => setZone(z)} aria-pressed={zone === z} style={{
            background: zone === z ? cw.ink : cw.surface, color: zone === z ? cw.surface : cw.ink, border: frame(cw),
            fontFamily: cw.fontBody, fontSize: 11, fontWeight: 700, padding: '3px 8px', cursor: 'pointer',
          }}>{l}</button>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 8, bottom: 8, fontSize: 10.5, color: cw.inkMuted, background: cw.surface, padding: '2px 6px' }}>
        DRAG TO TURN · RIGHT-DRAG TO PAN · SCROLL TO ZOOM · CLICK A PART OR LOOM
      </div>
    </div>
  );
}

function Zone({ url, ix, sel, rel, accent, onSelect }: {
  url: string; ix: WsIndex; sel: string | null; rel: Rel; accent: string; onSelect: (id: string) => void;
}) {
  const { scene } = useGLTF(url);
  const root = useMemo(() => {
    const c = scene.clone(true);
    c.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      m.material = mat.clone();
      m.userData.base = (m.material as THREE.MeshStandardMaterial).color?.clone();
    });
    return c;
  }, [scene]);
  const idOf = (o: THREE.Object3D | null): string | null => {
    for (let x: THREE.Object3D | null = o; x; x = x.parent) {
      const ep = (x.userData?.endpoint ?? x.userData?.id) as string | undefined;
      if (ep && ix.byCode.has(ep)) return 'n:' + ep;
      const name = (x.name || '').replace(/_[ab]$/, '');
      if (ix.segById.has(name)) return 's:' + name;
      if (ix.byCode.has(name)) return 'n:' + name;
    }
    return null;
  };
  useEffect(() => {
    const on = new THREE.Color(accent);
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial, base = m.userData.base as THREE.Color | undefined;
      if (!mat.color || !base) return;
      const id = idOf(m), k = id ? id[0] : '', v = id ? id.slice(2) : '';
      const pri = !!sel && id === sel;
      const linked = !!sel && !!id && ((k === 'n' && rel.nodes.has(v)) || (k === 's' && rel.segs.has(v)));
      if (pri || linked) mat.color.copy(on);
      else if (sel) { const hsl = { h: 0, s: 0, l: 0 }; base.getHSL(hsl); mat.color.setHSL(hsl.h, hsl.s * 0.12, Math.min(0.62, hsl.l * 0.85)); }
      else mat.color.copy(base);
      if ('emissive' in mat && mat.emissive) mat.emissive.set(pri ? accent : '#000000');
      if ('emissiveIntensity' in mat) mat.emissiveIntensity = pri ? 0.45 : 0;
    });
  }, [root, sel, rel, accent]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Bounds fit clip observe margin={1.15}>
      <primitive object={root} onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); const id = idOf(e.object); if (id) onSelect(id); }} />
    </Bounds>
  );
}
