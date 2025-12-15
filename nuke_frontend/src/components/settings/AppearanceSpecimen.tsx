import React from 'react';
import { APPEARANCE_PRESETS } from './appearancePresets';
import { useTheme, type ThemePreference, type AutoThemeSource, type ContrastProfile, type AccentId } from '../../contexts/ThemeContext';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseHexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const v = hex.trim().replace('#', '');
  if (v.length !== 6) return null;
  const r = Number.parseInt(v.slice(0, 2), 16);
  const g = Number.parseInt(v.slice(2, 4), 16);
  const b = Number.parseInt(v.slice(4, 6), 16);
  if ([r, g, b].some((x) => Number.isNaN(x))) return null;
  return { r, g, b };
}

function srgbToLinear(c: number) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: { r: number; g: number; b: number }) {
  const R = srgbToLinear(rgb.r);
  const G = srgbToLinear(rgb.g);
  const B = srgbToLinear(rgb.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(fgHex: string, bgHex: string): number | null {
  const fg = parseHexToRgb(fgHex);
  const bg = parseHexToRgb(bgHex);
  if (!fg || !bg) return null;
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

const CHIP_STYLE: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 3,
  border: '2px solid var(--border)',
  display: 'inline-block',
};

export default function AppearanceSpecimen() {
  const {
    theme,
    preference,
    setPreference,
    autoSource,
    setAutoSource,
    schedule,
    setSchedule,
    accent,
    setAccent,
    contrast,
    setContrast,
    toggleTheme,
  } = useTheme();

  const selectedPreset = APPEARANCE_PRESETS.find((p) => p.id === accent) ?? APPEARANCE_PRESETS[0];

  // Quick “real” contrast examples based on preset chips (not computed from CSS vars).
  // This is intentionally conservative; it’s a guide for theme authors.
  const bg = theme === 'dark' ? '#1E1E1E' : '#F5F5F5';
  const surface = theme === 'dark' ? '#252526' : '#EBEBEB';
  const text = theme === 'dark' ? '#CCCCCC' : '#2A2A2A';
  const accentHex = selectedPreset.chips[0] ?? '#2A2A2A';

  const ratioTextBg = contrastRatio(text, bg);
  const ratioAccentBg = contrastRatio(accentHex, bg);
  const ratioTextSurface = contrastRatio(text, surface);

  const passText = ratioTextBg ? ratioTextBg >= 4.5 : false;
  const passAccent = ratioAccentBg ? ratioAccentBg >= 3.0 : false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="card">
        <div className="card-header">Appearance</div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <label className="text-9" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Theme
            <select value={preference} onChange={(e) => setPreference(e.target.value as ThemePreference)}>
              <option value="auto">Auto</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>

          <label className="text-9" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Contrast
            <select value={contrast} onChange={(e) => setContrast(e.target.value as ContrastProfile)}>
              <option value="standard">Standard</option>
              <option value="greyscale">Greyscale</option>
              <option value="high">High Contrast</option>
            </select>
          </label>

          {preference === 'auto' && (
            <label className="text-9" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              Auto source
              <select value={autoSource} onChange={(e) => setAutoSource(e.target.value as AutoThemeSource)}>
                <option value="system">System</option>
                <option value="time">Time</option>
              </select>
            </label>
          )}

          {preference === 'auto' && autoSource === 'time' && (
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="text-9" style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160 }}>
                Dark starts
                <input
                  type="time"
                  value={schedule.start}
                  onChange={(e) => setSchedule({ ...schedule, start: e.target.value })}
                />
              </label>
              <label className="text-9" style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160 }}>
                Dark ends
                <input
                  type="time"
                  value={schedule.end}
                  onChange={(e) => setSchedule({ ...schedule, end: e.target.value })}
                />
              </label>
              <div className="text-9" style={{ color: 'var(--text-secondary)', maxWidth: 420 }}>
                Uses your computer’s local time. If start is later than end, it wraps across midnight.
              </div>
            </div>
          )}

          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div className="text-9" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 700 }}>Live</span>
              <span style={{ ...CHIP_STYLE, background: 'var(--bg)' }} title="--bg" />
              <span style={{ ...CHIP_STYLE, background: 'var(--surface)' }} title="--surface" />
              <span style={{ ...CHIP_STYLE, background: 'var(--text)' }} title="--text" />
              <span style={{ ...CHIP_STYLE, background: 'var(--accent)' }} title="--accent" />
            </div>

            <button className="btn-utility" onClick={toggleTheme} style={{ fontSize: 9 }}>
              Toggle
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Colorways</div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
          <label className="text-9" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Colorway
            <select value={accent} onChange={(e) => setAccent(e.target.value as AccentId)}>
              {APPEARANCE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — Pantone examples: {p.pantoneExamples}
                </option>
              ))}
            </select>
          </label>

          <div className="text-9" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>{selectedPreset.name}</span>
            <span style={{ color: 'var(--text-secondary)' }}>Pantone examples: {selectedPreset.pantoneExamples}</span>
            <span style={{ display: 'inline-flex', gap: 6 }}>
              {selectedPreset.chips.slice(0, 4).map((c) => (
                <span key={c} style={{ ...CHIP_STYLE, background: c }} title={c} />
              ))}
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Typography specimen</div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div>
            <div className="text-11" style={{ fontWeight: 700, letterSpacing: 0.2 }}>NUKE / VEHICLE ARCHIVE</div>
            <div className="text-10" style={{ marginTop: 6 }}>
              A restrained UI: moderate contrast, tight rhythm, and a quiet accent.
            </div>
            <div className="text-9" style={{ marginTop: 10, color: 'var(--text-secondary)' }}>
              Caption / secondary: provenance notes, file metadata, small print.
            </div>
          </div>

          <div style={{ fontFamily: 'var(--font-mono)' }}>
            <div className="text-10" style={{ fontWeight: 700, letterSpacing: 0.2 }}>MONO NUMERALS</div>
            <div className="text-9" style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
              VIN: 1FTFW1E5XJFB12345
              <br />
              ODO: 128,401 mi
              <br />
              DATE: 1987-10-21 14:08
              <br />
              LOT: 00612
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">UI atoms</div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn-utility">Utility</button>
              <button className="btn-primary">Primary</button>
              <button className="btn-utility" disabled style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                Disabled
              </button>
            </div>

            <label className="text-9" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              Input
              <input type="text" defaultValue="Search: receipts, parts, vendors" />
            </label>

            <label className="text-9" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              Select
              <select defaultValue="verified">
                <option value="verified">Verified</option>
                <option value="pending">Pending</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="text-9" style={{ fontWeight: 700 }}>Status strip</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ padding: 10, border: '2px solid var(--border)', background: 'var(--bg)' }}>
                <span style={{ color: 'var(--success)', fontWeight: 700 }}>SUCCESS</span>
                <span style={{ marginLeft: 10, color: 'var(--text-secondary)' }}>OCR parsed title data</span>
              </div>
              <div style={{ padding: 10, border: '2px solid var(--border)', background: 'var(--bg)' }}>
                <span style={{ color: 'var(--warning)', fontWeight: 700 }}>WARNING</span>
                <span style={{ marginLeft: 10, color: 'var(--text-secondary)' }}>VIN check digit mismatch</span>
              </div>
              <div style={{ padding: 10, border: '2px solid var(--border)', background: 'var(--bg)' }}>
                <span style={{ color: 'var(--error)', fontWeight: 700 }}>ERROR</span>
                <span style={{ marginLeft: 10, color: 'var(--text-secondary)' }}>Upload failed</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Contrast sanity</div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div className="text-9">
            <div style={{ fontWeight: 700 }}>Text on background</div>
            <div style={{ color: 'var(--text-secondary)' }}>
              {ratioTextBg ? ratioTextBg.toFixed(2) : 'N/A'} (target 4.5+){' '}
              <span style={{ marginLeft: 8, fontWeight: 700, color: passText ? 'var(--success)' : 'var(--error)' }}>
                {passText ? 'PASS' : 'FAIL'}
              </span>
            </div>
          </div>
          <div className="text-9">
            <div style={{ fontWeight: 700 }}>Text on surface</div>
            <div style={{ color: 'var(--text-secondary)' }}>
              {ratioTextSurface ? ratioTextSurface.toFixed(2) : 'N/A'} (guide)
            </div>
          </div>
          <div className="text-9">
            <div style={{ fontWeight: 700 }}>Accent on background</div>
            <div style={{ color: 'var(--text-secondary)' }}>
              {ratioAccentBg ? ratioAccentBg.toFixed(2) : 'N/A'} (target 3.0+){' '}
              <span style={{ marginLeft: 8, fontWeight: 700, color: passAccent ? 'var(--success)' : 'var(--error)' }}>
                {passAccent ? 'PASS' : 'FAIL'}
              </span>
            </div>
          </div>
          <div className="text-9" style={{ gridColumn: '1 / -1', color: 'var(--text-secondary)' }}>
            This is a quick check using representative values. Final contrast depends on where accent is used (borders vs text).
            If a colorway fails, keep it accent-only (borders/focus) and avoid accent as body text.
          </div>
        </div>
      </div>
    </div>
  );
}


