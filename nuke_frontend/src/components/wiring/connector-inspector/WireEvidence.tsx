// connector-inspector/WireEvidence.tsx — everything the database holds about one wire, each fact with its
// paper. Sits under the wire in the FACE skin's detail card: click a cavity, see the wire's ends (M130,
// firewall, device), what backs each value, and for the plug's parts the proof on file that they were
// lined up, bought, installed. No proof, no claim (owner 2026-09-26). All chrome from the active Colorway.

import React, { useState } from 'react';
import type { Colorway } from './colorways';
import { rule } from './colorways';
import { CHECK_WORDS, STATE_WORDS, type WiringFact, type WiringFacts } from './useWiringFacts';

const ORDER = ['wire', 'ECU end', 'ECU strip length', 'far end', 'firewall', 'firewall crimp setting', 'firewall strip', 'device end'];
const rank = (p: string) => { const i = ORDER.indexOf(p); return i < 0 ? ORDER.length : i; };

export function WireEvidence({ wireId, facts, cw }: { wireId: string; facts: WiringFacts; cw: Colorway }) {
  if (!facts.loaded) return null;                       // no empty shells (frontend.md)
  if (facts.error) return <Note cw={cw}>DATABASE READ FAILED: {facts.error}</Note>;
  // each fact once: the same wire row is written under every plug it touches (e.g. CKP and the 61-pin)
  const seen = new Set<string>();
  const mine = (facts.byWire[wireId.toLowerCase()] ?? [])
    .filter(f => { const k = `${f.property}|${f.value}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => rank(a.property) - rank(b.property));
  if (mine.length === 0) return null;
  const plugs = [...new Set(mine.map(f => f.plug))].filter(p => p !== 'FIREWALL-ENGINE');
  return (
    <div style={{ marginTop: 10, borderTop: rule(cw), paddingTop: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, color: cw.inkMuted, marginBottom: 6 }}>
        FROM THE DATABASE — EACH VALUE WITH ITS PAPER
      </div>
      {mine.map(f => <FactRow key={f.id} f={f} cw={cw} />)}
      {plugs.map(p => <PlugProof key={p} plug={p} facts={facts.byPlug[p] ?? []} cw={cw} />)}
    </div>
  );
}

function FactRow({ f, cw }: { f: WiringFact; cw: Colorway }) {
  const [open, setOpen] = useState(false);
  const status = f.state === 'cited' ? (f.check ? CHECK_WORDS[f.check] ?? f.check : 'CITED') : STATE_WORDS[f.state] ?? f.state.toUpperCase();
  const good = f.state === 'cited' && f.check === 'VERIFIED';
  const hasPaper = !!(f.excerpt || f.url);
  return (
    <div style={{ borderBottom: rule(cw), padding: '6px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 14 }}>
        <span style={{ width: 92, flexShrink: 0, color: cw.inkFaint, fontWeight: 700, letterSpacing: 0.5 }}>
          {f.plug === 'FIREWALL-ENGINE' && f.property === 'device end' ? '61-PIN ENGINE SIDE' : f.property.toUpperCase()}
        </span>
        <span style={{ fontFamily: cw.fontMono, color: cw.ink, minWidth: 0, overflowWrap: 'anywhere' }}>{f.value}</span>
      </div>
      <button
        onClick={() => hasPaper && setOpen(o => !o)}
        style={{
          display: 'block', width: 'calc(100% - 100px)', whiteSpace: 'normal',
          marginLeft: 100, marginTop: 2, background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
          cursor: hasPaper ? 'pointer' : 'default', fontFamily: cw.fontBody, fontSize: 14, lineHeight: 1.5,
          color: good ? cw.ok : f.state === 'cited' ? cw.warn : cw.inkMuted,
        }}
      >
        {status} · {f.sourceName}{f.page ? ` p.${f.page}` : ''}{hasPaper ? (open ? ' ▾' : ' ▸') : ''}
      </button>
      {open && (
        <div style={{ marginLeft: 100, marginTop: 4, fontSize: 14, lineHeight: 1.5, color: cw.inkMuted }}>
          {f.excerpt && <div style={{ fontFamily: cw.fontMono }}>“{cleanExcerpt(f.excerpt)}”</div>}
          {f.url && (
            <a href={f.url} target="_blank" rel="noreferrer" style={{ color: cw.accent, overflowWrap: 'anywhere' }}>{f.url}</a>
          )}
        </div>
      )}
    </div>
  );
}

function PlugProof({ plug, facts, cw }: { plug: string; facts: WiringFact[]; cw: Colorway }) {
  const kits = facts.filter(f => f.property === 'plug / kit');
  const open = facts.filter(f => f.state === 'open' || f.property === 'open item');
  if (!kits.length && !open.length) return null;
  const name = facts[0]?.plugName ?? plug;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, color: cw.inkMuted, marginBottom: 4 }}>
        {name.toUpperCase()} — PARTS AND PROOF
      </div>
      {kits.map(k => (
        <div key={k.id} style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 6 }}>
          <div style={{ fontFamily: cw.fontMono, color: cw.ink }}>{k.value}</div>
          <Proof label="LINED UP" cw={cw}
            v={k.proof?.lined_up ? `${String(k.proof.lined_up.vendor ?? '').toUpperCase()} CART ${k.proof.lined_up.cart ?? ''} · captured ${k.proof.lined_up.captured ?? '?'}` : null} />
          <Proof label="BOUGHT" cw={cw} v={k.proof?.bought ? String(k.proof.bought) : null} />
          <Proof label="INSTALLED" cw={cw} v={k.proof?.installed ? String(k.proof.installed) : null} />
        </div>
      ))}
      {open.map(o => (
        <div key={o.id} style={{ fontSize: 14, lineHeight: 1.5, color: cw.warn, marginBottom: 4 }}>OPEN — {o.value}</div>
      ))}
    </div>
  );
}

function Proof({ label, v, cw }: { label: string; v: string | null; cw: Colorway }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ width: 92, flexShrink: 0, color: cw.inkFaint, fontWeight: 700 }}>{label}</span>
      <span style={{ color: v ? cw.ok : cw.inkMuted }}>{v ?? 'no proof on file'}</span>
    </div>
  );
}

// page text as stored keeps the page's table markup; show the words, not the pipes
function cleanExcerpt(s: string): string {
  return s.replace(/<br\s*\/?>/gi, ' ').replace(/\s*\|\s*/g, ' · ').replace(/(·\s*)+/g, '· ').replace(/\s+/g, ' ').replace(/^·\s*|\s*·$/g, '').trim();
}

function Note({ children, cw }: { children: React.ReactNode; cw: Colorway }) {
  return <div style={{ marginTop: 10, fontSize: 14, color: cw.inkFaint }}>{children}</div>;
}
