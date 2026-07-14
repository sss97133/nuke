/**
 * BrandStudio — the "make this my app" showroom (R&D, 2026-06-16).
 *
 * Proves the hypothesis live: type a name, pick a livery, watch the home-screen
 * icon and the whole app reskin around you. The graph underneath never changes —
 * only the face does. This is the narcissist hook: dad slaps his shop name on it
 * and it's "his app".
 *
 * Design system: Arial, zero border-radius, 2px borders, 8-9px caps labels,
 * var() colors only.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTheme, type AccentId } from '../contexts/ThemeContext';
import {
  LIVERY_ICON_COLORS,
  monogramFor,
  type BrandIdentity,
} from '../branding/brandIdentity';
import { generateIcons } from '../branding/generateIcon';
import { applyBranding, restoreBranding } from '../branding/applyBranding';
import ModeSwitcher from '../branding/ModeSwitcher';
import { useBranding } from '../branding/BrandingContext';
import EntityProofPanel from '../entity/EntityProofPanel';

const LIVERIES = Object.keys(LIVERY_ICON_COLORS) as AccentId[];

const label: React.CSSProperties = {
  fontSize: 8,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-disabled)',
  display: 'block',
  marginBottom: 4,
};

export default function BrandStudio() {
  const { setAccent } = useTheme();
  const { brand: activeBrand } = useBranding();
  const [name, setName] = useState('Desert Performance');
  const [accent, setAccentLocal] = useState<AccentId>('gulf');
  const [tagline, setTagline] = useState('Built to win.');
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const brand: BrandIdentity = useMemo(
    () => ({
      kind: 'synthetic',
      subjectId: null,
      name: name.toUpperCase() || 'YOUR BRAND',
      shortName: (name.trim().split(/\s+/)[0] || 'Brand').slice(0, 14),
      logoUrl: null,
      accent,
      tagline: tagline || null,
      startPath: '/',
    }),
    [name, accent, tagline],
  );

  // Live icon preview whenever the brand changes.
  useEffect(() => {
    let cancelled = false;
    generateIcons(brand).then((icons) => {
      if (!cancelled) setIconUrl(icons.bySize[512]);
    });
    return () => {
      cancelled = true;
    };
  }, [brand]);

  // Restore Nuke branding if the user leaves without explicitly applying.
  useEffect(() => {
    return () => {
      if (!applied) restoreBranding();
    };
  }, [applied]);

  const applyLive = async () => {
    setAccent(accent);
    await applyBranding(brand);
    setApplied(true);
  };

  const shareLink = `${window.location.origin}/?brand=monogram:${encodeURIComponent(
    name.replace(/\s+/g, '+'),
  )}:${accent}${tagline ? ':' + encodeURIComponent(tagline.replace(/\s+/g, '+')) : ''}`;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 12px' }}>
      <div style={{ borderBottom: '2px solid var(--border)', paddingBottom: 8, marginBottom: 16 }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>MAKE THIS MY APP</h1>
        <p style={{ fontSize: 11, color: 'var(--text-disabled)', margin: '4px 0 0' }}>
          Project any entity onto the Nuke shell. Same graph underneath — your face on top.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 24 }}>
        {/* Controls */}
        <div>
          <div style={{ marginBottom: 16 }}>
            <span style={label}>Brand name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '2px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
                fontFamily: 'Arial, sans-serif',
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <span style={label}>Tagline</span>
            <input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '2px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
                fontFamily: 'Arial, sans-serif',
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <span style={label}>Livery</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {LIVERIES.map((id) => {
                const c = LIVERY_ICON_COLORS[id];
                const selected = id === accent;
                return (
                  <button
                    key={id}
                    onClick={() => setAccentLocal(id)}
                    title={id}
                    style={{
                      width: 28,
                      height: 28,
                      padding: 0,
                      border: selected ? '2px solid var(--text)' : '2px solid var(--border)',
                      background: c.bg,
                      cursor: 'pointer',
                      outline: selected ? '1px solid var(--text)' : 'none',
                    }}
                  >
                    <span style={{ color: c.fg, fontSize: 9, fontWeight: 700 }}>
                      {monogramFor(name)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={applyLive}
            style={{
              padding: '10px 16px',
              border: '2px solid var(--text)',
              background: 'var(--text)',
              color: 'var(--bg)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {applied ? '✓ Applied — look at the header & tab' : 'Apply to this app'}
          </button>

          {applied && (
            <p style={{ fontSize: 11, color: 'var(--text-disabled)', marginTop: 10, lineHeight: 1.5 }}>
              The wordmark, browser tab title, theme color and home-screen icon now read{' '}
              <strong style={{ color: 'var(--text)' }}>{brand.shortName}</strong>. On iPhone: Share →
              Add to Home Screen and the icon below lands on the home screen — no "Nuke" anywhere.
            </p>
          )}
        </div>

        {/* Icon preview */}
        <div style={{ textAlign: 'center' }}>
          <span style={label}>Home-screen icon</span>
          {iconUrl && (
            <img
              src={iconUrl}
              width={180}
              height={180}
              alt="generated app icon"
              style={{ width: 180, height: 180, border: '2px solid var(--border)' }}
            />
          )}
          <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8 }}>{brand.shortName}</div>
          <div style={{ fontSize: 9, color: 'var(--text-disabled)', marginTop: 2 }}>
            generated · no upload
          </div>
        </div>
      </div>

      {/* The silent switch — modes derived from the signed-in user's real graph */}
      <div style={{ borderTop: '2px solid var(--border)', marginTop: 24, paddingTop: 16 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 4px' }}>YOUR MODES</h2>
        <p style={{ fontSize: 11, color: 'var(--text-disabled)', margin: '0 0 14px' }}>
          The hats you actually wear — derived from your affiliations and confirmed vehicles,
          not configured. Tap one and the whole app flips. This is the manual switch; auto-trigger
          (schedule / location / iOS Focus) rides on top of it later.
        </p>
        <ModeSwitcher />

        {activeBrand?.kind === 'org' && activeBrand.subjectId && (
          <div style={{ marginTop: 16 }}>
            <EntityProofPanel
              entityType="organization"
              entityId={activeBrand.subjectId}
              entityName={activeBrand.name}
            />
          </div>
        )}
      </div>

      {/* Shareable link — the viral unit */}
      <div style={{ borderTop: '2px solid var(--border)', marginTop: 24, paddingTop: 12 }}>
        <span style={label}>Shareable brand link</span>
        <input
          readOnly
          value={shareLink}
          onFocus={(e) => e.currentTarget.select()}
          style={{
            width: '100%',
            padding: '8px 10px',
            border: '2px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text-disabled)',
            fontSize: 11,
            fontFamily: 'Courier New, monospace',
          }}
        />
        <p style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 6 }}>
          Open this link → the whole app boots branded. Real entities:{' '}
          <code>?brand=org:&lt;slug&gt;</code> or <code>?brand=vehicle:&lt;id&gt;</code>.
        </p>
      </div>
    </div>
  );
}
