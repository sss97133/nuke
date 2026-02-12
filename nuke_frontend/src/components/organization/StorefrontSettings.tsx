import React, { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { AccentId } from '../../contexts/ThemeContext';

interface Props {
  organization: {
    id: string;
    slug: string | null;
    business_name: string;
    ui_config: any;
  };
  onSave?: () => void;
}

const ACCENT_OPTIONS: { id: AccentId; label: string }[] = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'gulf', label: 'Gulf' },
  { id: 'martini', label: 'Martini' },
  { id: 'rosso', label: 'Rosso (Ferrari)' },
  { id: 'brg', label: 'British Racing Green' },
  { id: 'jps', label: 'JPS Black & Gold' },
  { id: 'papaya', label: 'Papaya (McLaren)' },
  { id: 'bmw-m', label: 'BMW M' },
  { id: 'alitalia', label: 'Alitalia' },
  { id: 'americana', label: 'Americana' },
  { id: 'route-66', label: 'Route 66' },
  { id: 'denim', label: 'Denim' },
  { id: 'desert', label: 'Desert' },
  { id: 'mopar-plum', label: 'Mopar Plum Crazy' },
  { id: 'mopar-sublime', label: 'Mopar Sublime' },
  { id: 'mopar-hemi', label: 'Mopar Hemi Orange' },
  { id: 'mopar-b5', label: 'Mopar B5 Blue' },
  { id: 'camo-od', label: 'Camo OD' },
  { id: 'camo-blaze', label: 'Camo Blaze' },
  { id: 'flames-heat', label: 'Flames (Hot)' },
  { id: 'flames-blue', label: 'Flames (Blue)' },
];

const fieldStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 16,
  fontSize: 'var(--fs-9, 9px)',
  fontFamily: 'Arial, sans-serif',
  color: 'var(--text)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--fs-8, 8px)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 'var(--fs-9, 9px)',
  fontFamily: 'Arial, sans-serif',
  border: '2px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  width: '100%',
  outline: 'none',
};

export default function StorefrontSettings({ organization, onSave }: Props) {
  const current = organization.ui_config?.storefront || {};

  const [enabled, setEnabled] = useState<boolean>(current.enabled || false);
  const [theme, setTheme] = useState<string>(current.theme || 'auto');
  const [accentColor, setAccentColor] = useState<string>(current.accentColor || 'neutral');
  const [primaryColor, setPrimaryColor] = useState<string>(current.primaryColor || '');
  const [seoTitle, setSeoTitle] = useState<string>(current.seo?.title || '');
  const [seoDescription, setSeoDescription] = useState<string>(current.seo?.description || '');
  const [showPricing, setShowPricing] = useState<boolean>(current.layout?.showPricing ?? true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);

    const storefrontConfig = {
      enabled,
      theme,
      accentColor,
      ...(primaryColor && /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? { primaryColor } : {}),
      seo: {
        title: seoTitle || undefined,
        description: seoDescription || undefined,
      },
      layout: {
        showPricing,
        featuredVehicleIds: current.layout?.featuredVehicleIds || [],
      },
    };

    const updatedConfig = {
      ...(organization.ui_config || {}),
      storefront: storefrontConfig,
    };

    const { error } = await supabase
      .from('businesses')
      .update({ ui_config: updatedConfig })
      .eq('id', organization.id);

    setSaving(false);

    if (error) {
      alert('Failed to save: ' + error.message);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onSave?.();
    }
  }, [organization, enabled, theme, accentColor, primaryColor, seoTitle, seoDescription, showPricing, current, onSave]);

  const storefrontUrl = organization.slug ? `https://${organization.slug}.nuke.dev` : null;

  return (
    <div style={{ maxWidth: 600 }}>
      <h3 style={{ fontSize: 'var(--fs-10, 10px)', fontWeight: 700, color: 'var(--text)', marginBottom: 4, fontFamily: 'Arial, sans-serif' }}>
        Storefront
      </h3>
      <p style={{ fontSize: 'var(--fs-8, 8px)', color: 'var(--text-secondary)', marginBottom: 20, fontFamily: 'Arial, sans-serif' }}>
        Your branded vehicle inventory page.
        {storefrontUrl && enabled && (
          <> Live at <a href={storefrontUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{storefrontUrl}</a></>
        )}
      </p>

      {/* Enable Toggle */}
      <label style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span style={{ fontWeight: 600 }}>Enable Public Storefront</span>
      </label>

      {!organization.slug && (
        <div style={{ padding: 12, background: 'var(--warning-dim, #fff3cd)', border: '2px solid var(--warning, #ffc107)', fontSize: 'var(--fs-8, 8px)', fontFamily: 'Arial, sans-serif', marginBottom: 16 }}>
          This organization needs a slug before the storefront can go live. Set one in the organization settings.
        </div>
      )}

      {enabled && (
        <>
          {/* Theme */}
          <div style={fieldStyle}>
            <span style={labelStyle}>Theme</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
              <option value="auto">Auto (match visitor's system)</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          {/* Accent Color */}
          <div style={fieldStyle}>
            <span style={labelStyle}>Accent Colorway</span>
            <select value={accentColor} onChange={(e) => setAccentColor(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
              {ACCENT_OPTIONS.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>

          {/* Custom Primary Color */}
          <div style={fieldStyle}>
            <span style={labelStyle}>Custom Primary Color (optional, overrides accent)</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="color"
                value={primaryColor || '#888888'}
                onChange={(e) => setPrimaryColor(e.target.value)}
                style={{ width: 32, height: 24, border: '2px solid var(--border)', padding: 0, cursor: 'pointer' }}
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#d32f2f"
                style={{ ...inputStyle, width: 120 }}
              />
              {primaryColor && (
                <button
                  onClick={() => setPrimaryColor('')}
                  style={{ fontSize: 'var(--fs-8, 8px)', fontFamily: 'Arial, sans-serif', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  clear
                </button>
              )}
            </div>
          </div>

          {/* Show Pricing */}
          <label style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showPricing}
              onChange={(e) => setShowPricing(e.target.checked)}
            />
            <span>Show vehicle pricing on storefront</span>
          </label>

          {/* SEO */}
          <div style={{ borderTop: '2px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
            <span style={{ ...labelStyle, marginBottom: 12, display: 'block' }}>SEO / Social Preview</span>

            <div style={fieldStyle}>
              <span style={labelStyle}>Page Title</span>
              <input
                type="text"
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                placeholder={`${organization.business_name} — Vehicle Inventory`}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <span style={labelStyle}>Description</span>
              <textarea
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                placeholder="Describe your business and what you specialize in"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>
          </div>
        </>
      )}

      {/* Save */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '6px 16px',
            fontSize: 'var(--fs-9, 9px)',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 600,
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            cursor: saving ? 'wait' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save Storefront Settings'}
        </button>
        {saved && (
          <span style={{ fontSize: 'var(--fs-8, 8px)', color: 'var(--success, #28a745)', fontFamily: 'Arial, sans-serif' }}>
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
