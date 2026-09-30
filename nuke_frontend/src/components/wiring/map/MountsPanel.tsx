// map/MountsPanel.tsx — WHERE EACH BOX GOES: the ECU, both PDMs, the lambda box, batteries, isolator, DC-DC,
// the firewall connectors and the service ports, each with its spot, why (every reason with its source), what
// else it could be, and what is still open. Owner 2026-09-29: "not sure where the ecu or pdms are suggested to
// be mounted" / "the body bulk head... not sure what that is".
// Data: /wiring/k5-mounts.json, generated from docs/wiring/calc-data/catalog/mounts.yaml by mounts_v5.py (the
// generator fails the build on a reason without a source). Only the K5 has one; other vehicles render nothing.

import React, { useEffect, useState } from 'react';
import { frame, rule, textOn, type Colorway } from '../connector-inspector/colorways';

const K5_ID = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';

interface Reason { text: string; source: string }
interface Alt { where: string; why_not: string }
interface Box {
  id: string; what: string; where: string; zone: string;
  status: 'decided' | 'proposed' | 'open' | 'flag';
  why: Reason[]; instead?: Alt[]; open?: string[];
  nodes?: string[];   // map node codes whose box photo shows here (devices in k5-part-photos.json)
  parts?: string[];   // part codes whose maker photos show here (photos in k5-part-photos.json)
}

const WORD: Record<Box['status'], string> = { decided: 'DECIDED', proposed: 'PROPOSED', open: 'NEEDS YOU', flag: 'BREAKS A MAKER RULE' };

export function MountsPanel({ vehicleId, cw }: { vehicleId?: string; cw: Colorway }) {
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (vehicleId !== K5_ID) return;
    let cancelled = false;
    fetch('/wiring/k5-mounts.json')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (!cancelled) setBoxes(d.boxes as Box[]); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (vehicleId !== K5_ID) return null;
  if (failed) return <div style={{ marginTop: 10, fontSize: 14, color: cw.danger }}>WHERE EACH BOX GOES: COULD NOT LOAD THE LIST</div>;
  if (!boxes) return null;

  const tone = (s: Box['status']) => (s === 'flag' ? cw.danger : s === 'open' ? cw.warn : s === 'decided' ? cw.ink : cw.accent);

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, color: cw.inkMuted, marginBottom: 4 }}>
        WHERE EACH BOX GOES ({boxes.length}) — CLICK ONE FOR WHY
      </div>
      <div style={{ border: frame(cw), background: cw.surface }}>
        {boxes.map((b, i) => {
          const on = openId === b.id;
          const t = tone(b.status);
          return (
            <div key={b.id} style={{ borderTop: i ? rule(cw) : 'none' }}>
              <button onClick={() => setOpenId(on ? null : b.id)} style={{
                display: 'flex', gap: 8, width: '100%', textAlign: 'left', alignItems: 'baseline', background: on ? cw.bg : 'transparent',
                color: cw.ink, border: 'none', padding: '6px 8px', cursor: 'pointer', fontFamily: cw.fontBody,
              }}>
                <span style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 700, padding: '1px 5px', background: t, color: textOn(t) }}>{WORD[b.status]}</span>
                <span style={{ flex: '0 0 30%', fontSize: 14, fontWeight: 700 }}>{b.what}</span>
                <span style={{ flex: 1, fontSize: 14 }}>{b.where}</span>
              </button>
              {on && (
                <div style={{ padding: '2px 8px 10px 8px', fontSize: 13, lineHeight: 1.45 }}>
                  {(!!b.nodes?.length || !!b.parts?.length) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start', margin: '4px 0' }}>
                      {(b.nodes ?? []).map(c => <DevicePhoto key={c} code={c} cw={cw} />)}
                      {!!b.parts?.length && <PartPhotos codes={b.parts.join(',')} cw={cw} />}
                    </div>
                  )}
                  <div style={{ fontWeight: 700, color: cw.inkMuted, marginTop: 4 }}>WHY</div>
                  {b.why.map((w, j) => (
                    <div key={j} style={{ marginTop: 3 }}>
                      {w.text} <span style={{ color: cw.inkFaint, fontFamily: cw.fontMono, fontSize: 11 }}>[{w.source}]</span>
                    </div>
                  ))}
                  {!!b.instead?.length && (
                    <>
                      <div style={{ fontWeight: 700, color: cw.inkMuted, marginTop: 8 }}>OR INSTEAD</div>
                      {b.instead.map((a, j) => (
                        <div key={j} style={{ marginTop: 3 }}><b>{a.where}</b>: {a.why_not}</div>
                      ))}
                    </>
                  )}
                  {!!b.open?.length && (
                    <>
                      <div style={{ fontWeight: 700, color: cw.warn, marginTop: 8 }}>STILL OPEN</div>
                      {b.open.map((o, j) => <div key={j} style={{ marginTop: 3 }}>{o}</div>)}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── THE PIECES: the maker's own photo of each part number on a plug card (owner 2026-09-29: "need to start really
// seeing the pieces"). Photos are linked from the maker/vendor site, not copied; /wiring/k5-part-photos.json maps
// part code → image URL. A code with no photo on file says so.
type PhotoRec = { img: string; from: string; what?: string };
let photoFile: Promise<{ photos: Record<string, PhotoRec>; devices: Record<string, PhotoRec> }> | null = null;
const loadFile = () => {
  photoFile ??= fetch('/wiring/k5-part-photos.json').then(r => (r.ok ? r.json() : {}))
    .then(d => ({ photos: d.photos ?? {}, devices: d.devices ?? {} })).catch(() => ({ photos: {}, devices: {} }));
  return photoFile;
};
const loadPhotos = () => loadFile().then(f => f.photos);

// The box itself (the M130, a PDM, the isolator...) at the top of its plug card, keyed by node code. captionOf lets the
// MAP workspace draw the caption as a public name (no "candidate" and the like).
export function DevicePhoto({ code, cw, captionOf }: { code: string; cw: Colorway; captionOf?: (t: string) => string }) {
  const [rec, setRec] = useState<PhotoRec | null>(null);
  const [dead, setDead] = useState(false);
  useEffect(() => { let c = false; loadFile().then(f => { if (!c) setRec(f.devices[code] ?? null); }); return () => { c = true; }; }, [code]);
  if (!rec || dead) return null;
  return (
    <a href={rec.img} target="_blank" rel="noreferrer" title={`photo from ${rec.from}`}
      style={{ display: 'inline-block', border: frame(cw), background: '#fff', marginBottom: 8 }}>
      <img src={rec.img} alt={rec.what ?? code} width={220} height={150} loading="lazy" referrerPolicy="no-referrer"
        onError={() => setDead(true)} style={{ display: 'block', width: 220, height: 150, objectFit: 'contain' }} />
      <div style={{ fontSize: 10, padding: '2px 4px', color: cw.ink, background: cw.surface, borderTop: rule(cw) }}>
        {(captionOf ? captionOf(rec.what ?? code) || code : rec.what ?? code).toUpperCase()} · PHOTO: {rec.from}
      </div>
    </a>
  );
}

export function PartPhotos({ codes, cw }: { codes: string; cw: Colorway }) {
  const [idx, setIdx] = useState<Record<string, { img: string; from: string }> | null>(null);
  const [dead, setDead] = useState<Set<string>>(new Set());   // a linked photo that fails to load reads as none
  useEffect(() => { let c = false; loadPhotos().then(p => { if (!c) setIdx(p); }); return () => { c = true; }; }, []);
  if (!idx) return null;
  const list = codes.split(',').map(s => s.trim()).filter(Boolean);
  if (!list.some(c => idx[c])) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 8px' }}>
      {list.map(c => {
        const p = dead.has(c) ? undefined : idx[c];
        return (
          <div key={c} style={{ width: 92, border: frame(cw), background: '#fff' }}>
            {p ? (
              <a href={p.img} target="_blank" rel="noreferrer" title={`${c} — photo from ${p.from}`}>
                <img src={p.img} alt={c} width={88} height={66} loading="lazy" referrerPolicy="no-referrer"
                  onError={() => setDead(prev => new Set(prev).add(c))}
                  style={{ display: 'block', width: 88, height: 66, objectFit: 'contain', margin: 2 }} />
              </a>
            ) : (
              <div style={{ width: 88, height: 66, margin: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, color: cw.inkFaint, textAlign: 'center' }}>NO PHOTO ON FILE</div>
            )}
            <div style={{ fontFamily: cw.fontMono, fontSize: 10, padding: '1px 3px', color: cw.ink, background: cw.surface,
              borderTop: rule(cw), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── THE REAL ENGINE: the K5's own photo (IMG_6531, 2026-02-01) with each plug marked where it sits. Visible plugs
// are picked on the photo; hidden ones (crank, cam, knock, starter, O2, 6L90) are projected from the twin and
// marked "~" and dashed. Made by docs/wiring/twin/ (photo_match.py, picks_IMG6531.json); the anchors and their
// sources are in docs/wiring/calc-data/twin_engine_anchors.json.
export function EnginePhoto({ vehicleId, cw }: { vehicleId?: string; cw: Colorway }) {
  if (vehicleId !== K5_ID) return null;
  const src = '/wiring/k5-engine-labelled.jpg';
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, color: cw.inkMuted, marginBottom: 4 }}>
        ON THE REAL ENGINE — EACH PLUG WHERE IT SITS (PHOTO 2026-02-01; DASHED = HIDDEN, ~ = FROM THE TWIN, NOT PICKED ON THE PHOTO)
      </div>
      <a href={src} target="_blank" rel="noreferrer" title="Open full size">
        <img src={src} alt="The K5's LS3 with each plug labelled" width={1600} height={1200} loading="lazy"
          style={{ display: 'block', width: '100%', height: 'auto', border: frame(cw) }} />
      </a>
    </div>
  );
}


// ── WHERE ON THE TRUCK: one plug's physical spot, from the ends list in k5-mounts.json (mounts.yaml `ends`,
// keyed by endpoint id = map node code; every reason sourced, lint in mounts_v5.py). Owner 2026-09-29: "map it
// all out, all the end points accurately".
interface EndRec { where: string; zone?: string; status: string; why?: Reason[]; open?: string[]; follows?: string }
let mountsFile: Promise<{ ends: Record<string, EndRec> }> | null = null;
const loadEnds = () => {
  mountsFile ??= fetch('/wiring/k5-mounts.json').then(r => (r.ok ? r.json() : {})).then(d => ({ ends: d.ends ?? {} }))
    .catch(() => ({ ends: {} }));
  return mountsFile;
};
const END_WORD: Record<string, string> = {
  fixed_by_engine: 'FIXED BY THE ENGINE / FACTORY', decided: 'DECIDED', proposed: 'PROPOSED', open: 'NOT DECIDED', flag: 'BREAKS A RULE',
};

// showWhy / showStatus: the reasons, their sources, what is still open and the decision status are the owner's working
// record (the MAP workspace shows them to the owner only); the spot itself is a result.
export function WhereOnTruck({ code, cw, showWhy = true, showStatus = true }: { code: string; cw: Colorway; showWhy?: boolean; showStatus?: boolean }) {
  const [e, setE] = useState<EndRec | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => { let c = false; loadEnds().then(f => { if (!c) setE(f.ends[code] ?? null); }); return () => { c = true; }; }, [code]);
  if (!e) return null;
  const t = e.status === 'flag' ? cw.danger : e.status === 'open' ? cw.warn : e.status === 'proposed' ? cw.accent : cw.ink;
  return (
    <div style={{ margin: '6px 0 10px', padding: '6px 8px', border: frame(cw), background: cw.surface }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: cw.inkMuted }}>WHERE ON THE TRUCK</span>
        {showStatus && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', background: t, color: textOn(t) }}>{END_WORD[e.status] ?? e.status.toUpperCase()}</span>}
      </div>
      <div style={{ fontSize: 14, marginTop: 3 }}>{e.where}</div>
      {showWhy && (!!e.why?.length || !!e.open?.length) && (
        <button onClick={() => setMore(m => !m)} style={{ marginTop: 4, background: 'transparent', border: 'none', padding: 0,
          color: cw.accent, fontFamily: cw.fontBody, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          {more ? 'HIDE WHY' : 'WHY / SOURCES'}
        </button>
      )}
      {showWhy && more && (
        <div style={{ fontSize: 12, lineHeight: 1.45, marginTop: 4 }}>
          {(e.why ?? []).map((w, i) => (
            <div key={i} style={{ marginTop: 2 }}>{w.text} <span style={{ color: cw.inkFaint, fontFamily: cw.fontMono, fontSize: 10 }}>[{w.source}]</span></div>
          ))}
          {!!e.open?.length && <div style={{ marginTop: 4, color: cw.warn, fontWeight: 700 }}>STILL OPEN</div>}
          {(e.open ?? []).map((o, i) => <div key={i} style={{ marginTop: 2 }}>{o}</div>)}
        </div>
      )}
    </div>
  );
}
