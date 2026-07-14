/**
 * VenueSkin.tsx
 * ---------------------------------------------------------------------------
 * Renders the one universal vehicle profile in a venue's real design language.
 * Data-driven: no per-venue code. It reads a SkinSpec (reverse-engineered from
 * captured markup, staged in skinSeeds, canonical home = brand_design_language)
 * and binds vehicle atoms into the venue's structure. Replaces the hand-coded
 * PlatformPreview.
 *
 * Honesty: a Nuke valuation is always labelled "Nuke estimate", never a live bid.
 */

import React from 'react';
import { getSkinSeed } from '../../services/skinSeeds';
import { resolveBinding, validateSkinSpec, type SkinSpec, type SkinSection } from '../../services/skinSpec';

export interface VenueSkinProps {
  venueSlug: string;
  /** Flat atom bag: year, make, model, trim, vin, mileage, engine_type, transmission, city, state, description, seller_handle… */
  atoms: Record<string, any>;
  images?: string[];
  valuation?: { estimate?: number; low?: number; high?: number; confidence?: number } | null;
  /** Optional explicit spec (e.g. loaded from brand_design_language); falls back to the seed. */
  spec?: SkinSpec | null;
}

const money = (n?: number) => (typeof n === 'number' ? `$${Math.round(n).toLocaleString()}` : '—');

const VenueSkin: React.FC<VenueSkinProps> = ({ venueSlug, atoms, images = [], valuation, spec: specProp }) => {
  const spec = specProp ?? getSkinSeed(venueSlug);
  if (!spec) return null;
  const v = validateSkinSpec(spec);
  if (!v.ok) {
    return <div style={{ fontSize: 11, color: '#b00' }}>Skin spec invalid: {v.errors.join(', ')}</div>;
  }

  const p = spec.tokens.palette;
  const bind = (key: string) => (spec.bindings[key] ? resolveBinding(spec.bindings[key], atoms) : '');
  const fill = (tmpl: string) =>
    tmpl
      .replace('{location}', bind('location') || '—')
      .replace('{estimate_label}', 'Nuke Estimate');

  const tag = (text: string, key: string | number) => (
    <span key={key} style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, border: `1px solid ${p.border}`, padding: '2px 7px', color: p.muted, textTransform: 'uppercase' }}>{text}</span>
  );

  const renderSection = (s: SkinSection, i: number): React.ReactNode => {
    switch (s.id) {
      case 'header':
        return (
          <div key={i} style={{ background: p.headerBg ?? p.accent, color: p.headerText ?? p.accentText ?? '#fff', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', letterSpacing: 2 }}>
            <span style={{ fontSize: 16 }}>{s.label}</span>
            <span style={{ fontSize: 10, opacity: 0.6, fontFamily: 'Arial, sans-serif', letterSpacing: 0.3 }}>NUKE · {spec.homage}</span>
          </div>
        );
      case 'gallery':
        return (
          <div key={i}>
            {images[0] && <img src={images[0]} alt={bind('title')} style={{ width: '100%', height: 300, objectFit: 'cover', display: 'block', background: '#ddd' }} />}
            {images.length > 1 && (
              <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                {images.slice(1, 6).map((u, k) => (
                  <img key={k} src={u} alt="" style={{ flex: 1, height: 56, objectFit: 'cover', background: '#ddd', minWidth: 0 }} />
                ))}
              </div>
            )}
          </div>
        );
      case 'tags':
        return <div key={i} style={{ display: 'flex', gap: 6, margin: '10px 0' }}>{(s.items ?? []).map((t, k) => tag(t, k))}</div>;
      case 'title':
        return <h1 key={i} style={{ fontSize: 24, fontWeight: 700, margin: '12px 0 6px', lineHeight: 1.2, color: p.text }}>{bind('title')}</h1>;
      case 'meta':
        return <div key={i} style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, color: p.muted, borderBottom: `1px solid ${p.border}`, paddingBottom: 12, marginBottom: 14 }}>{fill(s.label ?? '')}</div>;
      case 'availability':
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${p.border}`, borderBottom: `1px solid ${p.border}`, padding: '10px 0', margin: '12px 0', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: p.muted }}>{s.label} <span style={{ color: '#bbb' }}>(not a live bid)</span></div>
              <div style={{ fontSize: 20, fontWeight: 700, color: p.text }}>{money(valuation?.estimate)}</div>
              {valuation?.low != null && <div style={{ fontSize: 11, color: p.muted }}>Range {money(valuation.low)} – {money(valuation.high)}{valuation.confidence != null ? ` · ${valuation.confidence}% confidence` : ''}</div>}
            </div>
            <span style={{ background: p.accent, color: p.accentText ?? '#fff', fontSize: 13, fontWeight: 600, padding: '11px 22px' }}>Place Listing</span>
          </div>
        );
      case 'essentials':
        return (
          <div key={i} style={{ marginTop: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: p.text, marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: p.text }}>
              <div><strong style={{ fontWeight: 600 }}>Seller</strong>: {bind('seller') || 'dealer consignment'}</div>
              <div><strong style={{ fontWeight: 600 }}>Location</strong>: <span style={{ color: p.link ?? p.text }}>{bind('location') || '—'}</span></div>
              <div style={{ marginTop: 6 }}><strong style={{ fontWeight: 600 }}>Listing Details</strong></div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                <li>Chassis: <span style={{ color: p.link ?? p.text }}>{bind('chassis') || '—'}</span></li>
                {bind('mileage') && <li>{bind('mileage')} Miles</li>}
                {bind('engine') && <li>{bind('engine')}</li>}
                {bind('transmission') && <li>{bind('transmission')}</li>}
              </ul>
            </div>
          </div>
        );
      case 'chassis':
        return (
          <div key={i} style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: p.muted, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 15, color: p.text }}>{bind('chassis') || '—'}</div>
          </div>
        );
      case 'estimate':
        return (
          <div key={i} style={{ border: `1px solid ${p.accent}`, padding: 14, marginTop: 8 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: p.muted }}>Nuke {s.label}</div>
            <div style={{ fontSize: 21, color: p.text, margin: '4px 0' }}>{money(valuation?.low)} - {money(valuation?.high)}</div>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 11, color: p.muted }}>{valuation?.confidence != null ? `${valuation.confidence}% confidence · ` : ''}not a live {spec.displayName} sale</div>
            <div style={{ marginTop: 12, background: p.accent, color: p.accentText ?? '#fff', textAlign: 'center', fontFamily: 'Arial, sans-serif', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', padding: 10 }}>Enquire</div>
          </div>
        );
      case 'specs': {
        // Each item is "Label::atomPath" (path may carry a |transform, e.g. mileage|abbrevK).
        const rows = (s.items ?? [])
          .map((it) => {
            const [label, path] = it.split('::');
            return { label, value: resolveBinding(path ?? '', atoms) };
          })
          .filter((r) => r.value);
        if (!rows.length) return null; // no empty shells
        return (
          <div key={i} style={{ marginTop: 14 }}>
            {s.label && <div style={{ fontSize: 15, fontWeight: 700, color: p.text, marginBottom: 8 }}>{s.label}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 16px', fontSize: 13, color: p.text, borderTop: `1px solid ${p.border}`, paddingTop: 8 }}>
              {rows.map((r, k) => (
                <React.Fragment key={k}>
                  <div style={{ color: p.muted }}>{r.label}</div>
                  <div>{r.value}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
        );
      }
      case 'bidbar':
        // Full-width bid strip (BaT). Nuke estimate, never a faked live bid.
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: `2px solid ${p.border}`, padding: '12px 14px', margin: '12px 0', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: p.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label || 'Nuke Estimate'} <span style={{ color: '#bbb' }}>· not a live bid</span></div>
              <div style={{ fontSize: 22, fontWeight: 700, color: p.text }}>{money(valuation?.estimate)}</div>
              {valuation?.low != null && <div style={{ fontSize: 11, color: p.muted }}>Range {money(valuation.low)} – {money(valuation.high)}{valuation.confidence != null ? ` · ${valuation.confidence}% confidence` : ''}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 12, color: p.muted }}>{bind('comment_count') || '0'} Comments</span>
              <span style={{ background: p.accent, color: p.accentText ?? '#fff', fontSize: 13, fontWeight: 700, padding: '11px 22px' }}>Place Listing</span>
            </div>
          </div>
        );
      case 'comments':
        // Venue comment UI chrome (BaT/C&B). Count is bound if present; the box is real chrome, not fabricated data.
        return (
          <div key={i} style={{ marginTop: 16, borderTop: `1px solid ${p.border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: p.text, marginBottom: 8 }}>{s.label || 'Comments'} <span style={{ color: p.muted, fontWeight: 400 }}>({bind('comment_count') || '0'})</span></div>
            <div style={{ border: `1px solid ${p.border}`, padding: '10px 12px', color: p.muted, fontSize: 13 }}>Add a comment…</div>
          </div>
        );
      case 'description':
        return <div key={i} style={{ fontSize: 13.5, lineHeight: 1.65, color: p.text, marginTop: 14 }}>{bind('description')}</div>;
      default:
        return null;
    }
  };

  // Layout: 'header' sections render full-bleed; the rest sit on the surface card.
  // 'sidebar-right' splits the body into a full-width top band + a main|sidebar grid
  // (BaT/eBay); 'single' renders the body linearly.
  const headerSections = spec.structure.filter((s) => s.id === 'header');
  const body = spec.structure.filter((s) => s.id !== 'header');
  const hasHeader = headerSections.length > 0;
  const homageTag = !hasHeader ? (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
      <span style={{ fontSize: 10, color: p.muted }}>NUKE · {spec.homage}</span>
    </div>
  ) : null;

  let inner: React.ReactNode;
  if (spec.layout === 'sidebar-right') {
    const top = body.filter((s) => (s.region ?? 'top') === 'top');
    const main = body.filter((s) => s.region === 'main');
    const side = body.filter((s) => s.region === 'sidebar');
    inner = (
      <>
        {homageTag}
        {top.map(renderSection)}
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 20, marginTop: 14, alignItems: 'start' }}>
          <div style={{ minWidth: 0 }}>{main.map(renderSection)}</div>
          <div style={{ minWidth: 0 }}>{side.map(renderSection)}</div>
        </div>
      </>
    );
  } else {
    inner = (<>{homageTag}{body.map(renderSection)}</>);
  }

  return (
    <div style={{ background: p.pageBg, fontFamily: spec.tokens.fontFamily, color: p.text }}>
      {spec.tokens.fontImportUrl && <style>{`@import url('${spec.tokens.fontImportUrl}');`}</style>}
      {headerSections.map(renderSection)}
      <div style={{ background: p.surface, border: `1px solid ${p.border}`, padding: 16 }}>
        {inner}
      </div>
    </div>
  );
};

export default VenueSkin;
