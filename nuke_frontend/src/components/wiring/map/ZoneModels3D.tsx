// map/ZoneModels3D.tsx — the MAP workspace's 3D view: harness-cad's routed harness by zone (engine bay, cab, rear),
// each fetched only when opened; the layer GLBs other lanes publish (frame, engine), each only if its file exists; and
// the true-size parts from the part library at their ends (scene3d.ts has the tables and the frames).
//
// Navigation: named views sized to the loaded bounds, fit all / fit selection / reset, and orbit, pan and zoom buttons
// for trackpads; every move is a short camera flight. Selection: a click picks within a few pixels (occlusion kept),
// hover lights what a click would pick, the picked thing carries a tag (code and name), the object list flies to any
// row, and Escape clears. The selection is the workspace's own (?sel=), so the tree, tables and properties follow.

import React, { Suspense, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { Colorway } from '../connector-inspector/colorways';
import { frame, rule } from '../connector-inspector/colorways';
import { SECTIONS } from './useWiringMap';
import { publicName, type Rel, type SiteFiles, type WsIndex } from './useWorkspaceSelection';
import {
  HOME_DIR, LAYERS, TRUCK_TWIN, TRUE_PARTS, VIEWS, ZONES, ZONE_TWIN, fitDistance, nameMatcher, objectLabel, partMatrix, partMatrixOn, twinBox, zoneOfY,
  type TruePart, type ViewId, type ZoneId,
} from './scene3d';

const TRUCK_BOX = twinBox(TRUCK_TWIN);

type Kind = 'end' | 'part' | 'loom' | 'other';
interface Item { mesh: THREE.Mesh; key: string; kind: Kind; label: string }

// Every mesh in the scene, by the owner that added it (a zone, a part, a layer), so picking, highlighting, the object
// list and the camera all read one table.
class Registry {
  private owners = new Map<string, { root: THREE.Object3D; items: Item[] }>();
  private subs = new Set<() => void>();
  version = 0;
  add(owner: string, root: THREE.Object3D, items: Item[]) { this.owners.set(owner, { root, items }); this.bump(); }
  remove(owner: string) { if (this.owners.delete(owner)) this.bump(); }
  has(owner: string) { return this.owners.has(owner); }
  find(owner: string, name: string) { return this.owners.get(owner)?.root.getObjectByName(name) ?? null; }
  rootOf(owner: string) { return this.owners.get(owner)?.root ?? null; }
  bump() { this.version += 1; this.subs.forEach(f => f()); }
  subscribe(f: () => void) { this.subs.add(f); return () => { this.subs.delete(f); }; }
  roots() { return [...this.owners.values()].map(o => o.root); }
  items() { return [...this.owners.values()].flatMap(o => o.items); }
  box(pred: (it: Item) => boolean, owner?: string): THREE.Box3 {
    const b = new THREE.Box3();
    const list = owner ? this.owners.get(owner)?.items ?? [] : this.items();
    list.forEach(it => { if (pred(it) && shown(it.mesh)) b.expandByObject(it.mesh); });
    return b;
  }
}
const shown = (o: THREE.Object3D | null): boolean => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
const keyUp = (o: THREE.Object3D | null): string | null => { for (let x = o; x; x = x.parent) if (x.userData.key) return x.userData.key as string; return null; };

function ownMaterials(scene: THREE.Object3D): THREE.Object3D {
  const c = scene.clone(true);
  c.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    m.material = mat.clone();
    m.userData.base = (m.material as THREE.MeshStandardMaterial).color?.clone();
  });
  return c;
}

export default function ZoneModels3D({ cw, ix, site, sel, rel, onSelect, onClear }: {
  cw: Colorway; ix: WsIndex; site: SiteFiles; sel: string | null; rel: Rel; onSelect: (id: string) => void; onClear?: () => void;
}) {
  const reg = useMemo(() => new Registry(), []);
  const [ver, setVer] = useState(0);
  useEffect(() => reg.subscribe(() => setVer(reg.version)), [reg]);
  const [zones, setZones] = useState<Set<ZoneId>>(() => new Set(['bay']));
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);        // a list row that is not a workspace selection
  const [listOpen, setListOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [q, setQ] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const narrow = useNarrowPane(640);   // a phone: the shortest labels
  const rig = useRef<RigApi | null>(null);
  const pending = useRef<{ fitSel?: boolean } | null>(null);
  const homed = useRef(false);
  const layerFiles = useLayerFiles();
  const [layerOn, setLayerOn] = useState<Record<string, boolean>>({});

  // what the loaded layers and parts replace in the zone GLBs (only once they are drawn)
  const hidePats: string[] = [], keepPats: string[] = [];
  LAYERS.forEach(l => { if (layerOn[l.id] !== false && reg.has('layer:' + l.id)) { hidePats.push(...l.hides); keepPats.push(...(l.keeps ?? [])); } });
  TRUE_PARTS.forEach(p => { if (reg.has('part:' + p.code)) hidePats.push(...p.hides); });
  const hideKey = hidePats.join('|') + '#' + keepPats.join('|');
  const hides = useMemo(() => {
    const h = nameMatcher(hidePats), k = nameMatcher(keepPats);
    return (name: string) => h(name) && !k(name);
  }, [hideKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const labelOf = (key: string): string => {
    const k = key.slice(0, 1), v = key.slice(2);
    if (k === 'n') return `${v} · ${ix.byCode.get(v)?.name ?? ''}`;
    if (k === 's') { const s = ix.segById.get(v); return `${v} · ${(s?.b ?? '').split(' (')[0]}${s?.od ? ` · ⌀${s.od} MM` : ''}`; }
    return objectLabel(v.split(':').slice(-1)[0]);
  };
  const tagLines = (): string[] => {
    if (!sel) return [];
    const k = sel.slice(0, 1), v = sel.slice(2);
    const first = k === 'n' || k === 's' ? labelOf(sel)
      : k === 'w' ? `${v} · ${ix.wireByCode.get(v)?.name ?? ''}`
      : k === 'p' ? v.replace('|', ':')
      : k === 'd' ? v
      : k === 'y' ? SECTIONS.find(x => x.id === v)?.label ?? v
      : '';
    const part = k === 'n' ? TRUE_PARTS.find(p => p.code === v && reg.has('part:' + p.code)) : undefined;
    const mounted = !!(part && reg.rootOf('part:' + part.code)?.userData.mounted);
    return first ? [first, ...(part ? [`TRUE SIZE${mounted ? ' · ON THE ENGINE LAYER\'S TB FLANGE' : ''} · ${part.assumed ? 'ORIENTATION ASSUMED: ' + part.assumed.toUpperCase() : 'ORIENTATION FROM ITS MOUNT'}`] : [])] : [];
  };
  const selPred = (): ((it: Item) => boolean) | null => {
    if (!sel) return null;
    const k = sel.slice(0, 1);
    if (k === 'n' || k === 's') return it => it.key === sel;
    return it => (it.key.startsWith('n:') && rel.nodes.has(it.key.slice(2))) || (it.key.startsWith('s:') && rel.segs.has(it.key.slice(2)));
  };

  // camera requests that wait for a zone to load
  useEffect(() => {
    const p = pending.current;
    if (!rig.current) return;
    // the first view waits for a zone (a part alone is too small to frame) and for the orbit controls
    if (!homed.current && ZONES.some(z => reg.has('zone:' + z.id)) && rig.current.fit(homeBox(), HOME_DIR)) homed.current = true;
    if (!p) return;
    if (p.fitSel) {
      const pr = selPred(); if (!pr) { pending.current = null; return; }
      const b = reg.box(pr); if (b.isEmpty()) return;
      pending.current = null; rig.current.fit(b);
    }
  }, [ver]);   // eslint-disable-line react-hooks/exhaustive-deps

  const allBox = () => { const b = reg.box(() => true), c = b.clone().intersect(TRUCK_BOX); return c.isEmpty() ? b : c; };
  // the first view and RESET frame the open harness zones (a frame layer runs the truck's whole length)
  const homeBox = () => { const b = new THREE.Box3(); zones.forEach(z => b.union(twinBox(ZONE_TWIN[z]))); return b; };
  const runView = (id: ViewId) => {
    const v = VIEWS.find(x => x.id === id); if (!v || !rig.current) return;
    if (v.zone) {   // a zone view frames the zone's stations and loads its harness if it isn't open
      if (!zones.has(v.zone)) setZones(z => new Set(z).add(v.zone!));
      rig.current.fit(twinBox(ZONE_TWIN[v.zone]), v.dir);
      return;
    }
    const b = allBox();
    if (!b.isEmpty()) rig.current.fit(b, v.dir);
  };
  const fitSelection = () => {
    setNote(null);
    const pr = selPred(); if (!pr || !rig.current) return;
    const b = reg.box(pr);
    if (!b.isEmpty()) { rig.current.fit(b); return; }
    // not in the open zones: open the zone its end sits in, then fly
    const code = sel!.startsWith('n:') ? sel!.slice(2) : [...rel.nodes][0];
    const e = code ? site.ends[code] : undefined;
    if (e) { const z = zoneOfY(e.xyz[1]); if (!zones.has(z)) { setZones(s => new Set(s).add(z)); pending.current = { fitSel: true }; return; } }
    setNote('NOT DRAWN IN 3D YET');
  };
  const flyTo = (key: string) => { const b = reg.box(it => it.key === key); if (!b.isEmpty()) rig.current?.fit(b); };

  // Escape clears the selection (and a list focus). One listener for the view's life, reading the latest callback: a
  // listener re-added on every render can be dropped mid-event when the page's own Escape handler re-renders it.
  const clearRef = useRef(onClear);
  clearRef.current = onClear;
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFocus(null); clearRef.current?.(); } };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);
  useEffect(() => { setNote(null); }, [sel]);

  // the object list: every thing drawn, grouped
  const rows = useMemo(() => {
    const by = new Map<string, { key: string; kind: Kind; label: string }>();
    reg.items().forEach(it => {
      if (!shown(it.mesh)) return;
      const r = by.get(it.key);
      if (!r) by.set(it.key, { key: it.key, kind: it.kind, label: it.kind === 'other' ? it.label : labelOf(it.key) });
      else if (it.kind === 'part') r.kind = 'part';
    });
    const order: Kind[] = ['part', 'end', 'loom', 'other'];
    return [...by.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [ver, hides]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ql = q.trim().toLowerCase();
  const listed = ql ? rows.filter(r => r.label.toLowerCase().includes(ql)) : rows;
  const KIND_WORD: Record<Kind, string> = { part: 'TRUE-SIZE PARTS', end: 'ENDS', loom: 'LOOM SEGMENTS', other: 'OTHER OBJECTS' };

  const btn = (on = false): React.CSSProperties => ({
    background: on ? cw.ink : cw.surface, color: on ? cw.surface : cw.ink, border: frame(cw), fontFamily: cw.fontBody,
    fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, padding: '3px 7px', cursor: 'pointer', whiteSpace: 'nowrap',
  });
  const padBtn: React.CSSProperties = { ...btn(), width: 28, height: 24, padding: 0, fontSize: 12 };

  return (
    <div style={{ position: 'relative', height: '100%', background: cw.surface, overflow: 'hidden' }}>
      <Canvas camera={{ position: [2.4, 1.7, 2.6], fov: 32, near: 0.01, far: 200 }} dpr={[1, 2]} style={{ background: cw.surface }}>
        <ambientLight intensity={0.9} />
        <hemisphereLight args={['#ffffff', '#8a8f96', 0.7]} />
        <directionalLight position={[3, 5, 4]} intensity={1.5} />
        <directionalLight position={[-4, 3, -3]} intensity={0.6} />
        {ZONES.filter(z => zones.has(z.id)).map(z => (
          <Suspense key={z.id} fallback={null}><ZoneScene zone={z.id} url={z.url} ix={ix} reg={reg} hides={hides} /></Suspense>
        ))}
        {TRUE_PARTS.filter(p => zones.has(p.zone) && site.ends[p.code]).map(p => (
          <Suspense key={p.code} fallback={null}>
            <PartScene part={p} spot={site.ends[p.code].xyz} ix={ix} reg={reg}
              mountAt={p.mount && layerOn[p.mount.layer] !== false ? reg.find('layer:' + p.mount.layer, p.mount.node) : null} />
          </Suspense>
        ))}
        {LAYERS.filter(l => layerFiles[l.id] && layerOn[l.id] !== false).map(l => (
          <Suspense key={l.id} fallback={null}><LayerScene id={l.id} url={l.url} reg={reg} /></Suspense>
        ))}
        <Highlighter reg={reg} ver={ver} sel={sel} rel={rel} hover={hover?.key ?? null} focus={focus} accent={cw.accent} />
        <Picker reg={reg} onHover={setHover} onPick={key => { setFocus(null); onSelect(key); }} />
        <SelectionTag reg={reg} ver={ver} pred={selPred()} cw={cw} lines={tagLines()} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxDistance={40} />
        <Rig ref={rig} />
      </Canvas>

      {/* one compact view picker and FIT; the rest waits behind MORE (owner 2026-09-30: "you need to ease into it case by
          case"), and the object list stays shut until asked for */}
      <div style={{ position: 'absolute', left: 8, top: 8, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', zIndex: 10, maxWidth: 'calc(100% - 16px)' }}>
        <span role="group" aria-label="View" style={{ display: 'inline-flex' }}>
          {PICK.map((id, i) => (
            <button key={id} style={{ ...btn(), borderLeftWidth: i ? 0 : 2 }} onClick={() => runView(id)}>{id === 'bay' && narrow ? 'BAY' : VIEW_WORD[id]}</button>
          ))}
        </span>
        <button style={btn()} title={sel ? 'Fit the selection' : 'Fit everything drawn'} onClick={() => (sel ? fitSelection() : rig.current?.fit(allBox()))}>FIT</button>
        <button style={btn(moreOpen)} aria-expanded={moreOpen} onClick={() => { setMoreOpen(o => !o); setListOpen(false); }}>MORE {moreOpen ? '▴' : '▾'}</button>
        <button style={btn(listOpen)} aria-expanded={listOpen} onClick={() => { setListOpen(o => !o); setMoreOpen(false); }}>OBJECTS</button>
      </div>
      {moreOpen && (
        <div style={{ position: 'absolute', left: 8, top: 40, zIndex: 11, background: cw.surface, border: frame(cw), padding: '6px 8px', display: 'grid', gap: 6, maxWidth: 'calc(100% - 16px)' }}>
          <MoreRow cw={cw} label="VIEW">
            {MORE_VIEWS.map(id => <button key={id} style={btn()} onClick={() => runView(id)}>{VIEW_WORD[id]}</button>)}
            <button style={btn()} onClick={() => rig.current?.fit(homeBox(), HOME_DIR)}>RESET</button>
          </MoreRow>
          <MoreRow cw={cw} label="HARNESS">
            {ZONES.map(z => (
              <button key={z.id} style={btn(zones.has(z.id))} aria-pressed={zones.has(z.id)} title={`${zones.has(z.id) ? 'Hide' : 'Load'} the ${z.label.toLowerCase()} harness`}
                onClick={() => setZones(s => { const n = new Set(s); if (n.has(z.id)) { if (n.size > 1) n.delete(z.id); } else n.add(z.id); return n; })}>
                {zones.has(z.id) ? '☑' : '☐'} {z.short}
              </button>
            ))}
          </MoreRow>
          {LAYERS.some(l => layerFiles[l.id]) && (
            <MoreRow cw={cw} label="LAYERS">
              {LAYERS.filter(l => layerFiles[l.id]).map(l => (
                <button key={l.id} style={btn(layerOn[l.id] !== false)} aria-pressed={layerOn[l.id] !== false}
                  onClick={() => setLayerOn(s => ({ ...s, [l.id]: s[l.id] === false }))}>{layerOn[l.id] !== false ? '☑' : '☐'} {l.label}</button>
              ))}
            </MoreRow>
          )}
          <MoreRow cw={cw} label="TURN">
            <button style={padBtn} title="Turn left" onClick={() => rig.current?.orbit(-0.26, 0)}>◀</button>
            <button style={padBtn} title="Turn right" onClick={() => rig.current?.orbit(0.26, 0)}>▶</button>
            <button style={padBtn} title="Turn up" onClick={() => rig.current?.orbit(0, -0.26)}>▲</button>
            <button style={padBtn} title="Turn down" onClick={() => rig.current?.orbit(0, 0.26)}>▼</button>
            <span style={{ width: 6 }} />
            <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.6, color: cw.inkMuted }}>ZOOM</span>
            <button style={padBtn} title="Zoom in" onClick={() => rig.current?.zoom(0.75)}>+</button>
            <button style={padBtn} title="Zoom out" onClick={() => rig.current?.zoom(1.33)}>−</button>
          </MoreRow>
          <MoreRow cw={cw} label="PAN">
            <button style={padBtn} title="Pan left" onClick={() => rig.current?.pan(-0.12, 0)}>←</button>
            <button style={padBtn} title="Pan right" onClick={() => rig.current?.pan(0.12, 0)}>→</button>
            <button style={padBtn} title="Pan up" onClick={() => rig.current?.pan(0, 0.12)}>↑</button>
            <button style={padBtn} title="Pan down" onClick={() => rig.current?.pan(0, -0.12)}>↓</button>
          </MoreRow>
          <div style={{ fontSize: 10, color: cw.inkMuted, maxWidth: 330 }}>DRAG TO TURN · RIGHT-DRAG TO PAN · SCROLL OR PINCH TO ZOOM · CLICK A PART OR LOOM · ESC CLEARS</div>
        </div>
      )}

      {/* the object list: every thing drawn; a row flies there */}
      {listOpen && (
        <div style={{ position: 'absolute', left: 8, top: 44, bottom: 8, width: 'min(300px, 70%)', display: 'flex', flexDirection: 'column', background: cw.surface, border: frame(cw), zIndex: 11 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="FIND AN OBJECT" aria-label="Find an object in the 3D view" autoFocus
            style={{ border: 'none', borderBottom: rule(cw), background: cw.surface, color: cw.ink, fontFamily: cw.fontBody, fontSize: 12, padding: '6px 8px' }} />
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {listed.slice(0, 600).map((r, i) => (
              <React.Fragment key={r.key}>
                {(i === 0 || listed[i - 1].kind !== r.kind) && (
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, color: cw.inkMuted, padding: '6px 8px 2px', borderTop: i ? rule(cw) : 'none' }}>{KIND_WORD[r.kind]}</div>
                )}
                <button onClick={() => { if (r.kind === 'other') { setFocus(r.key); } else { setFocus(null); onSelect(r.key); } flyTo(r.key); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', padding: '2px 8px', fontSize: 11.5,
                    fontFamily: r.kind === 'other' ? cw.fontBody : cw.fontMono, color: cw.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    background: sel === r.key || focus === r.key ? `${cw.accent}33` : 'transparent' }} title={r.label}>
                  {r.label}
                </button>
              </React.Fragment>
            ))}
            {!listed.length && <div style={{ padding: 8, fontSize: 11.5, color: cw.inkMuted }}>NOTHING MATCHES.</div>}
          </div>
        </div>
      )}

      {hover && (
        <div style={{ position: 'absolute', left: hover.x + 14, top: hover.y + 12, pointerEvents: 'none', zIndex: 12, background: cw.surface, border: frame(cw),
          padding: '2px 6px', fontSize: 11, fontFamily: cw.fontMono, color: cw.ink, whiteSpace: 'nowrap', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {labelOf(hover.key)}
        </div>
      )}
      {note && (
        <div style={{ position: 'absolute', left: '50%', top: 48, transform: 'translateX(-50%)', zIndex: 12, background: cw.surface, border: frame(cw), padding: '3px 8px', fontSize: 11, fontWeight: 700 }}>{note}</div>
      )}
    </div>
  );
}

// the picker's views, and the rest behind MORE
const PICK: ViewId[] = ['front', 'driver', 'top', 'bay'];
const MORE_VIEWS: ViewId[] = ['rear', 'passenger', 'cab', 'rearbody'];
const VIEW_WORD: Record<ViewId, string> = {
  front: 'FRONT', driver: 'SIDE', top: 'TOP', bay: 'ENGINE BAY', rear: 'REAR', passenger: 'OTHER SIDE', cab: 'CAB', rearbody: 'REAR BODY', home: 'RESET',
};
function MoreRow({ cw, label, children }: { cw: Colorway; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      <span style={{ width: 58, fontSize: 8.5, fontWeight: 700, letterSpacing: 0.6, color: cw.inkMuted }}>{label}</span>
      {children}
    </div>
  );
}

function useNarrowPane(px: number): boolean {
  const q = `(max-width: ${px}px)`;
  const [n, setN] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(q), f = () => setN(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return n;
}

// the layer files other lanes publish: a HEAD answer that is not the site's own page means the file is there
function useLayerFiles(): Record<string, boolean> {
  const [have, setHave] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let off = false;
    Promise.all(LAYERS.map(l => fetch(l.url, { method: 'HEAD' })
      .then(r => r.ok && !/text\/html/i.test(r.headers.get('content-type') ?? ''))
      .catch(() => false)))
      .then(v => { if (!off) setHave(Object.fromEntries(LAYERS.map((l, i) => [l.id, v[i]]))); });
    return () => { off = true; };
  }, []);
  return have;
}

// one zone GLB: its meshes keyed by the end or loom segment they draw; `hides` takes out what a layer or part replaces
function ZoneScene({ zone, url, ix, reg, hides }: { zone: ZoneId; url: string; ix: WsIndex; reg: Registry; hides: (name: string) => boolean }) {
  const { scene } = useGLTF(url);
  const root = useMemo(() => ownMaterials(scene), [scene]);
  useLayoutEffect(() => {
    const items: Item[] = [];
    root.children.forEach(top => top.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let key = '', kind: Kind = 'other';
      for (let x: THREE.Object3D | null = m; x && x !== root && !key; x = x.parent) {
        const ep = (x.userData?.endpoint ?? x.userData?.id) as string | undefined;
        const nm = (x.name || '').replace(/_[ab]$/, '');
        const base = nm.replace(/_(fill|tower|plug|stud_[A-Z]|seg\d+)$/, '');
        const clip = nm.match(/^(.*)-C\d+$/)?.[1];
        const route = x.userData?.route as string | undefined;
        if (ep && ix.byCode.has(ep)) { key = 'n:' + ep; kind = 'end'; }
        else if (route && ix.segById.has(route)) { key = 's:' + route; kind = 'loom'; }
        else if (ix.segById.has(nm)) { key = 's:' + nm; kind = 'loom'; }
        else if (clip && ix.segById.has(clip)) { key = 's:' + clip; kind = 'loom'; }
        else if (ix.byCode.has(base)) { key = 'n:' + base; kind = 'end'; }
      }
      if (!key) key = 'o:' + zone + ':' + top.name;
      m.userData.key = key;
      items.push({ mesh: m, key, kind, label: kind === 'other' ? objectLabel(top.name) : '' });
    }));
    reg.add('zone:' + zone, root, items);
    return () => reg.remove('zone:' + zone);
  }, [root, ix, zone, reg]);
  useEffect(() => {
    let changed = false;
    root.children.forEach(top => { const v = !hides(top.name); if (top.visible !== v) { top.visible = v; changed = true; } });
    if (changed) reg.bump();
  }, [root, hides, reg]);
  return <primitive object={root} />;
}

// a true-size part at its end's spot, in its mount's orientation; its keep-out volume is not drawn
function PartScene({ part, spot, ix, reg, mountAt }: {
  part: TruePart; spot: [number, number, number]; ix: WsIndex; reg: Registry; mountAt: THREE.Object3D | null;
}) {
  const { scene } = useGLTF(part.url);
  const root = useMemo(() => {
    const c = ownMaterials(scene);
    c.matrixAutoUpdate = false;
    c.traverse(o => { if (/^keep-out/i.test(o.name)) o.visible = false; });
    return c;
  }, [scene]);
  useLayoutEffect(() => {   // on the layer's mount node when that layer is drawn, else at the end's spot
    root.matrix.copy(mountAt ? partMatrixOn(part, mountAt) : partMatrix(part, spot));
    root.matrixWorldNeedsUpdate = true;
    root.userData.mounted = !!mountAt;
    reg.bump();
  }, [root, part, spot, mountAt, reg]);
  useLayoutEffect(() => {
    const items: Item[] = [];
    root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.userData.key = 'n:' + part.code; items.push({ mesh: m, key: 'n:' + part.code, kind: 'part', label: publicName(ix.byCode.get(part.code)?.name) }); } });
    reg.add('part:' + part.code, root, items);
    return () => reg.remove('part:' + part.code);
  }, [root, part, ix, reg]);
  return <primitive object={root} />;
}

// another lane's layer (frame, engine): drawn as published, listed by its node names
function LayerScene({ id, url, reg }: { id: string; url: string; reg: Registry }) {
  const { scene } = useGLTF(url);
  const root = useMemo(() => ownMaterials(scene), [scene]);
  useLayoutEffect(() => {
    const items: Item[] = [];
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const nm = m.name || m.parent?.name || id;
      m.userData.key = `o:layer-${id}:${nm}`;
      items.push({ mesh: m, key: m.userData.key as string, kind: 'other', label: objectLabel(nm) });
    });
    reg.add('layer:' + id, root, items);
    return () => reg.remove('layer:' + id);
  }, [root, id, reg]);
  return <primitive object={root} />;
}

// the selection and what links to it take the accent, the hovered thing lifts, everything else goes neutral grey
function Highlighter({ reg, ver, sel, rel, hover, focus, accent }: {
  reg: Registry; ver: number; sel: string | null; rel: Rel; hover: string | null; focus: string | null; accent: string;
}) {
  useEffect(() => {
    const on = new THREE.Color(accent), lift = new THREE.Color('#ffffff'), none = new THREE.Color('#000000');
    const hsl = { h: 0, s: 0, l: 0 };
    reg.items().forEach(({ mesh, key }) => {
      const mat = mesh.material as THREE.MeshStandardMaterial, base = mesh.userData.base as THREE.Color | undefined;
      if (!mat.color || !base) return;
      const v = key.slice(2);
      const pri = key === sel || key === focus;
      const linked = !!sel && ((key.startsWith('n:') && rel.nodes.has(v)) || (key.startsWith('s:') && rel.segs.has(v)));
      if (pri || linked) mat.color.copy(on);
      else if (sel || focus) { base.getHSL(hsl); mat.color.setHSL(hsl.h, hsl.s * 0.12, Math.min(0.62, hsl.l * 0.85)); }
      else mat.color.copy(base);
      if ('emissive' in mat && mat.emissive) mat.emissive.copy(pri ? on : key === hover ? lift : none);
      if ('emissiveIntensity' in mat) mat.emissiveIntensity = pri ? 0.45 : key === hover ? 0.22 : 0;
    });
  }, [reg, ver, sel, rel, hover, focus, accent]);
  return null;
}

// picking with a tolerance: rays in a small disc around the pointer; each ray takes its first visible hit (so what is
// in front still wins), and the selectable hit nearest the pointer is the pick
function Picker({ reg, onHover, onPick }: {
  reg: Registry; onHover: (h: { key: string; x: number; y: number } | null) => void; onPick: (key: string) => void;
}) {
  const { camera, gl } = useThree();
  const cb = useRef({ onHover, onPick });
  cb.current = { onHover, onPick };
  useEffect(() => {
    const el = gl.domElement, ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const onHover = (h: { key: string; x: number; y: number } | null) => cb.current.onHover(h), onPick = (k: string) => cb.current.onPick(k);
    const at = (cx: number, cy: number, radius: number): string | null => {
      const r = el.getBoundingClientRect(), roots = reg.roots();
      const pts: [number, number][] = [[0, 0]];
      [radius / 2, radius].forEach(rr => { for (let k = 0; k < 8; k++) pts.push([rr * Math.cos(k * Math.PI / 4), rr * Math.sin(k * Math.PI / 4)]); });
      let best: { key: string; d: number; z: number } | null = null;
      for (const [dx, dy] of pts) {
        ndc.set(((cx + dx - r.left) / r.width) * 2 - 1, -((cy + dy - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObjects(roots, true).find(h => shown(h.object));
        const key = hit ? keyUp(hit.object) : null;
        if (!hit || !key || key.startsWith('o:')) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d || (d === best.d && hit.distance < best.z)) best = { key, d, z: hit.distance };
      }
      return best?.key ?? null;
    };
    let down: { x: number; y: number } | null = null, last = 0, timer = 0;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) { const key = at(e.clientX, e.clientY, 12); if (key) onPick(key); }
      down = null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons) { onHover(null); return; }
      const now = performance.now(), run = () => {
        last = performance.now();
        const key = at(e.clientX, e.clientY, 8), r = el.getBoundingClientRect();
        onHover(key ? { key, x: e.clientX - r.left, y: e.clientY - r.top } : null);
        el.style.cursor = key ? 'pointer' : '';
      };
      window.clearTimeout(timer);
      if (now - last > 60) run(); else timer = window.setTimeout(run, 60);
    };
    const onLeave = () => { window.clearTimeout(timer); onHover(null); };
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove); el.addEventListener('pointerleave', onLeave);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave);
    };
  }, [camera, gl, reg]);
  return null;
}

// the picked thing's tag: its code and name, at the middle of what is drawn for it
function SelectionTag({ reg, ver, pred, lines, cw }: { reg: Registry; ver: number; pred: ((it: Item) => boolean) | null; lines: string[]; cw: Colorway }) {
  const at = useMemo(() => {
    if (!pred) return null;
    const b = reg.box(pred);
    return b.isEmpty() ? null : b.getCenter(new THREE.Vector3());
  }, [reg, ver, pred]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!at || !lines.length) return null;
  return (
    <Html position={at} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div style={{ transform: 'translateY(-40px)', background: cw.surface, border: `2px solid ${cw.accent}`, padding: '2px 6px', width: 'max-content', maxWidth: 'min(380px, 64vw)',
        fontFamily: cw.fontMono, fontSize: 11, color: cw.ink }}>
        {lines.map((l, i) => (
          <div key={i} style={i ? { fontFamily: cw.fontBody, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: cw.inkMuted, whiteSpace: 'normal' }
            : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</div>
        ))}
      </div>
    </Html>
  );
}

// camera flights: every button moves the camera and the orbit target together over a short eased move
interface RigApi {
  fit: (box: THREE.Box3, dir?: [number, number, number]) => boolean;
  orbit: (dAzimuth: number, dPolar: number) => void;
  pan: (fx: number, fy: number) => void;
  zoom: (factor: number) => void;
}
const Rig = forwardRef<RigApi>(function Rig(_props, ref) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree(s => s.controls) as unknown as { target: THREE.Vector3; update: () => void; enableDamping: boolean } | null;
  const tw = useRef<{ p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; s: number } | null>(null);
  useFrame(() => {
    const t = tw.current; if (!t || !controls) return;
    const u = Math.min(1, (performance.now() - t.s) / 520), k = u >= 1 ? 1 : 1 - Math.pow(2, -10 * u);   // ease-out
    camera.position.lerpVectors(t.p0, t.p1, k); controls.target.lerpVectors(t.t0, t.t1, k); controls.update();
    if (u >= 1) { tw.current = null; controls.enableDamping = true; }
  });
  const fly = (p1: THREE.Vector3, t1: THREE.Vector3) => {
    if (!controls) return;
    controls.enableDamping = false;
    tw.current = { p0: camera.position.clone(), p1, t0: controls.target.clone(), t1, s: performance.now() };
  };
  useImperativeHandle(ref, () => ({
    fit(box, dir) {
      if (box.isEmpty() || !controls) return false;
      const d = dir ? new THREE.Vector3(...dir).normalize() : camera.position.clone().sub(controls.target).normalize();
      const c = box.getCenter(new THREE.Vector3());
      fly(c.clone().addScaledVector(d, fitDistance(box, d, camera)), c);
      return true;
    },
    orbit(dAz, dPol) {
      if (!controls) return;
      const off = camera.position.clone().sub(controls.target), s = new THREE.Spherical().setFromVector3(off);
      s.theta += dAz; s.phi = THREE.MathUtils.clamp(s.phi + dPol, 0.03, Math.PI - 0.03);
      fly(controls.target.clone().add(new THREE.Vector3().setFromSpherical(s)), controls.target.clone());
    },
    pan(fx, fy) {
      if (!controls) return;
      const dist = camera.position.distanceTo(controls.target), h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const delta = right.multiplyScalar(fx * h * camera.aspect).add(up.multiplyScalar(fy * h));
      fly(camera.position.clone().add(delta), controls.target.clone().add(delta));
    },
    zoom(f) {
      if (!controls) return;
      const off = camera.position.clone().sub(controls.target), len = THREE.MathUtils.clamp(off.length() * f, 0.15, 40);
      fly(controls.target.clone().add(off.setLength(len)), controls.target.clone());
    },
  }), [camera, controls]);   // eslint-disable-line react-hooks/exhaustive-deps
  return null;
});
