/**
 * ListingComposerModal.tsx
 * Compose and preview listing packages from the digital twin.
 * Opens from VehicleSaleSettings "Compose & Autofill" button.
 * Calls generate-listing-package edge function, then displays editable form.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { ListingExportService } from '../../services/listingExportService';
import PlatformPreview from './PlatformPreview';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListingPackage {
  platform: string;
  ars_score: number | null;
  tier: string | null;
  tier_warning: string | null;
  identity: Record<string, unknown>;
  listing_content: Record<string, unknown>;
  photos: {
    count: number;
    hero_image: string | null;
    zones_covered: string[];
    zones_missing: string[];
    ordered: Array<{
      url: string;
      zone: string | null;
      quality: number | null;
      caption: string | null;
    }>;
  };
  valuation: Record<string, unknown> | null;
  market_context: Record<string, unknown>;
  submission_fields: Record<string, unknown> | null;
}

export interface ListingComposerModalProps {
  vehicleId: string;
  vehicleName: string;
  isOpen: boolean;
  onClose: () => void;
  selectedPlatforms: string[];
  askingPrice?: number;
}

type ComposerTab = 'edit' | 'preview';

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const FONT_BODY = 'Arial, sans-serif';
const FONT_MONO = "'Courier New', Courier, monospace";

const LABEL: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  fontSize: '8px',
  fontWeight: 700,
  color: 'var(--text-secondary, #666666)',
  fontFamily: FONT_BODY,
};

const INPUT_STYLE: React.CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: '12px',
  padding: '6px 8px',
  border: '2px solid var(--border, #bdbdbd)',
  backgroundColor: 'var(--bg, #f5f5f5)',
  color: 'var(--text, #2a2a2a)',
  width: '100%',
  outline: 'none',
};

const BUTTON: React.CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: '9px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  padding: '6px 12px',
  border: '2px solid var(--border, #bdbdbd)',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  color: 'var(--text, #2a2a2a)',
};

const BUTTON_PRIMARY: React.CSSProperties = {
  ...BUTTON,
  backgroundColor: 'var(--text, #2a2a2a)',
  color: 'var(--bg, #f5f5f5)',
  borderColor: 'var(--text, #2a2a2a)',
};

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function CollapsibleSection({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--border, #bdbdbd)' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          ...LABEL,
          fontSize: '9px',
          width: '100%',
          textAlign: 'left',
          padding: '8px 0',
          border: 'none',
          backgroundColor: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        {title}
        <span style={{ fontFamily: FONT_MONO, fontSize: '10px' }}>{open ? '−' : '+'}</span>
      </button>
      {open && <div style={{ paddingBottom: 10 }}>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Photo Grid
// ---------------------------------------------------------------------------

function PhotoGrid({ photos, excluded, onToggle }: {
  photos: ListingPackage['photos']['ordered'];
  excluded: Set<string>;
  onToggle: (url: string) => void;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
      gap: 4,
      maxHeight: 240,
      overflowY: 'auto',
    }}>
      {photos.map((p, i) => (
        <div
          key={p.url}
          onClick={() => onToggle(p.url)}
          style={{
            position: 'relative',
            aspectRatio: '4/3',
            cursor: 'pointer',
            border: excluded.has(p.url)
              ? '2px solid var(--error, #d13438)'
              : '2px solid var(--border, #bdbdbd)',
            opacity: excluded.has(p.url) ? 0.4 : 1,
            overflow: 'hidden',
          }}
        >
          <img
            src={p.url}
            alt={p.caption || `Photo ${i + 1}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            loading="lazy"
          />
          {p.zone && (
            <span style={{
              ...LABEL,
              position: 'absolute',
              bottom: 2,
              left: 2,
              backgroundColor: 'var(--surface, #ebebeb)',
              padding: '1px 3px',
              fontSize: '7px',
            }}>
              {p.zone}
            </span>
          )}
          <span style={{
            ...LABEL,
            position: 'absolute',
            top: 2,
            right: 2,
            backgroundColor: 'var(--surface, #ebebeb)',
            padding: '1px 3px',
            fontSize: '7px',
            fontFamily: FONT_MONO,
          }}>
            {i + 1}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ARS Badge
// ---------------------------------------------------------------------------

function ArsBadge({ score, tier }: { score: number | null; tier: string | null }) {
  const color = tier === 'AUCTION_READY' ? 'var(--success, #16825d)'
    : tier === 'NEARLY_READY' ? 'var(--warning, #b05a00)'
    : 'var(--error, #d13438)';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 8px',
      border: `2px solid ${color}`,
      backgroundColor: 'var(--bg, #f5f5f5)',
    }}>
      <span style={{ ...LABEL, color }}>ARS</span>
      <span style={{ fontFamily: FONT_MONO, fontSize: '14px', fontWeight: 700, color }}>
        {score != null ? score.toFixed(0) : '—'}
      </span>
      <span style={{ ...LABEL, color, fontSize: '8px' }}>
        {tier?.replace(/_/g, ' ') || 'UNSCORED'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Modal
// ---------------------------------------------------------------------------

export default function ListingComposerModal({
  vehicleId,
  vehicleName,
  isOpen,
  onClose,
  selectedPlatforms,
  askingPrice,
}: ListingComposerModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pkg, setPkg] = useState<ListingPackage | null>(null);

  // Editable fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [highlights, setHighlights] = useState('');
  const [equipment, setEquipment] = useState('');
  const [modifications, setModifications] = useState('');
  const [knownFlaws, setKnownFlaws] = useState('');
  const [price, setPrice] = useState<number | ''>('');
  const [excludedPhotos, setExcludedPhotos] = useState<Set<string>>(new Set());
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<ComposerTab>('edit');

  // Fetch listing package on open
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const resp = await supabase.functions.invoke('generate-listing-package', {
          body: { vehicle_id: vehicleId, platform: selectedPlatforms[0] || 'bat' },
        });

        if (resp.error) throw new Error(resp.error.message);
        const data = resp.data as ListingPackage;
        setPkg(data);

        // Populate editable fields
        setTitle((data.listing_content.title as string) || vehicleName);
        setDescription((data.listing_content.description as string) || '');
        setHighlights((data.listing_content.highlights as string) || '');
        setEquipment((data.listing_content.equipment as string) || '');
        setModifications((data.listing_content.modifications as string) || '');
        setKnownFlaws((data.listing_content.known_flaws as string) || '');
        setPrice(askingPrice || (data.valuation as any)?.nuke_estimate || '');
        setPlatforms(selectedPlatforms.length > 0 ? selectedPlatforms : ['bat']);
        setExcludedPhotos(new Set());
        setTab('edit');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate listing package');
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, vehicleId]);

  const togglePhoto = useCallback((url: string) => {
    setExcludedPhotos(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const getIncludedPhotos = useCallback(() => {
    if (!pkg) return [];
    return pkg.photos.ordered.filter(p => !excludedPhotos.has(p.url));
  }, [pkg, excludedPhotos]);

  const getListingData = useCallback(() => {
    return {
      title,
      description,
      highlights,
      equipment,
      modifications,
      knownFlaws,
      price: typeof price === 'number' ? price : 0,
      photos: getIncludedPhotos(),
      platforms,
      identity: pkg?.identity || {},
      ars_score: pkg?.ars_score || null,
      tier: pkg?.tier || null,
    };
  }, [title, description, highlights, equipment, modifications, knownFlaws, price, getIncludedPhotos, platforms, pkg]);

  // Save as draft
  const handleSaveDraft = useCallback(async () => {
    setSaving(true);
    try {
      const photos = getIncludedPhotos();
      for (const platform of platforms) {
        await ListingExportService.createExport({
          vehicle_id: vehicleId,
          platform,
          export_format: 'json',
          title,
          description,
          asking_price_cents: typeof price === 'number' ? Math.round(price * 100) : 0,
          exported_images: photos.map(p => p.url),
          metadata: {
            highlights,
            equipment,
            modifications,
            known_flaws: knownFlaws,
            ars_score: pkg?.ars_score,
            tier: pkg?.tier,
          },
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  }, [vehicleId, title, description, price, highlights, equipment, modifications, knownFlaws, platforms, pkg, getIncludedPhotos, onClose]);

  // Copy to clipboard (platform-formatted)
  const handleCopy = useCallback(async (platform: string) => {
    const photos = getIncludedPhotos();
    let text = '';

    if (platform === 'craigslist') {
      text = ListingExportService.formatForCraigslist({
        title,
        description: [description, highlights ? `\nHighlights:\n${highlights}` : '', modifications ? `\nModifications:\n${modifications}` : '', knownFlaws ? `\nKnown Flaws:\n${knownFlaws}` : ''].filter(Boolean).join('\n'),
        price: typeof price === 'number' ? price : 0,
        location: (pkg?.identity?.location as string) || '',
      });
    } else if (platform === 'ebay') {
      text = ListingExportService.formatForEbay({
        title,
        description: [description, highlights ? `\nHighlights:\n${highlights}` : '', modifications ? `\nModifications:\n${modifications}` : '', knownFlaws ? `\nKnown Flaws:\n${knownFlaws}` : ''].filter(Boolean).join('\n'),
        images: photos.map(p => p.url),
        price: typeof price === 'number' ? price : 0,
        specs: pkg?.identity || {},
      });
    } else {
      // BaT / default story format
      text = ListingExportService.formatForBaT({
        title,
        description: [description, highlights ? `\nHighlights:\n${highlights}` : '', equipment ? `\nEquipment:\n${equipment}` : '', modifications ? `\nModifications:\n${modifications}` : '', knownFlaws ? `\nKnown Flaws:\n${knownFlaws}` : ''].filter(Boolean).join('\n'),
        images: photos.map(p => p.url),
        price: typeof price === 'number' ? price : 0,
      });
    }

    await navigator.clipboard.writeText(text);
    setCopied(platform);
    setTimeout(() => setCopied(null), 2000);
  }, [title, description, highlights, equipment, modifications, knownFlaws, price, getIncludedPhotos, pkg]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: '90vw',
          maxWidth: 960,
          maxHeight: '90vh',
          backgroundColor: 'var(--surface, #ebebeb)',
          border: '2px solid var(--text, #2a2a2a)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          borderBottom: '2px solid var(--border, #bdbdbd)',
          backgroundColor: 'var(--bg, #f5f5f5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              fontFamily: FONT_BODY,
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              LISTING COMPOSER
            </span>
            {pkg && <ArsBadge score={pkg.ars_score} tier={pkg.tier} />}
          </div>
          <button onClick={onClose} style={{ ...BUTTON, padding: '4px 8px' }}>CLOSE</button>
        </div>

        {/* Tab bar */}
        <div style={{
          display: 'flex',
          borderBottom: '2px solid var(--border, #bdbdbd)',
        }}>
          {(['edit', 'preview'] as ComposerTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                ...LABEL,
                fontSize: '9px',
                padding: '8px 16px',
                border: 'none',
                borderBottom: tab === t ? '2px solid var(--text, #2a2a2a)' : '2px solid transparent',
                backgroundColor: tab === t ? 'var(--bg, #f5f5f5)' : 'transparent',
                cursor: 'pointer',
                color: tab === t ? 'var(--text, #2a2a2a)' : 'var(--text-secondary, #666666)',
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, ...LABEL, fontSize: '10px' }}>
              GENERATING LISTING PACKAGE...
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--error, #d13438)', ...LABEL }}>
              {error}
            </div>
          ) : tab === 'edit' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Title */}
              <div>
                <label style={LABEL}>TITLE</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={{ ...INPUT_STYLE, marginTop: 4 }}
                />
              </div>

              {/* Description */}
              <div>
                <label style={LABEL}>DESCRIPTION</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  style={{ ...INPUT_STYLE, marginTop: 4, resize: 'vertical', fontFamily: FONT_BODY }}
                />
              </div>

              {/* Collapsible sections */}
              <CollapsibleSection title="HIGHLIGHTS" defaultOpen={!!highlights}>
                <textarea
                  value={highlights}
                  onChange={(e) => setHighlights(e.target.value)}
                  rows={3}
                  style={{ ...INPUT_STYLE, resize: 'vertical' }}
                  placeholder="Key selling points..."
                />
              </CollapsibleSection>

              <CollapsibleSection title="EQUIPMENT" defaultOpen={!!equipment}>
                <textarea
                  value={equipment}
                  onChange={(e) => setEquipment(e.target.value)}
                  rows={3}
                  style={{ ...INPUT_STYLE, resize: 'vertical' }}
                  placeholder="Notable equipment and features..."
                />
              </CollapsibleSection>

              <CollapsibleSection title="MODIFICATIONS" defaultOpen={!!modifications}>
                <textarea
                  value={modifications}
                  onChange={(e) => setModifications(e.target.value)}
                  rows={3}
                  style={{ ...INPUT_STYLE, resize: 'vertical' }}
                  placeholder="Aftermarket modifications..."
                />
              </CollapsibleSection>

              <CollapsibleSection title="KNOWN FLAWS" defaultOpen={!!knownFlaws}>
                <textarea
                  value={knownFlaws}
                  onChange={(e) => setKnownFlaws(e.target.value)}
                  rows={3}
                  style={{ ...INPUT_STYLE, resize: 'vertical' }}
                  placeholder="Issues, cosmetic imperfections, mechanical concerns..."
                />
              </CollapsibleSection>

              {/* Price */}
              <div>
                <label style={LABEL}>ASKING PRICE</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: '14px', fontWeight: 700 }}>$</span>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    style={{ ...INPUT_STYLE, width: 180, fontFamily: FONT_MONO }}
                    placeholder="0"
                  />
                  {pkg?.valuation && (
                    <span style={{ ...LABEL, fontSize: '8px', color: 'var(--text-secondary, #666666)' }}>
                      NUKE EST: ${((pkg.valuation as any).nuke_estimate || 0).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>

              {/* Photos */}
              <CollapsibleSection title={`PHOTOS (${pkg?.photos.count || 0} AVAILABLE, ${(pkg?.photos.count || 0) - excludedPhotos.size} INCLUDED)`}>
                {pkg?.photos.ordered && (
                  <PhotoGrid
                    photos={pkg.photos.ordered}
                    excluded={excludedPhotos}
                    onToggle={togglePhoto}
                  />
                )}
                {pkg?.photos.zones_missing && pkg.photos.zones_missing.length > 0 && (
                  <div style={{ marginTop: 6, ...LABEL, color: 'var(--warning, #b05a00)' }}>
                    MISSING ZONES: {pkg.photos.zones_missing.join(', ')}
                  </div>
                )}
              </CollapsibleSection>

              {/* Platform selector */}
              <div>
                <label style={LABEL}>PLATFORMS</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {[
                    { k: 'bat', l: 'BRING A TRAILER' },
                    { k: 'carsandbids', l: 'CARS & BIDS' },
                    { k: 'ebay', l: 'EBAY MOTORS' },
                    { k: 'facebook', l: 'FB MARKETPLACE' },
                    { k: 'craigslist', l: 'CRAIGSLIST' },
                    { k: 'hemmings', l: 'HEMMINGS' },
                    { k: 'hagerty', l: 'HAGERTY' },
                  ].map(p => (
                    <label key={p.k} style={{ display: 'flex', alignItems: 'center', gap: 4, ...LABEL }}>
                      <input
                        type="checkbox"
                        checked={platforms.includes(p.k)}
                        onChange={(e) => {
                          setPlatforms(prev =>
                            e.target.checked
                              ? [...prev.filter(x => x !== p.k), p.k]
                              : prev.filter(x => x !== p.k)
                          );
                        }}
                      />
                      {p.l}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Preview tab */
            <PlatformPreview
              listing={getListingData()}
              vehicleId={vehicleId}
              onCopy={handleCopy}
              copiedPlatform={copied}
            />
          )}
        </div>

        {/* Footer actions */}
        <div style={{
          padding: '10px 14px',
          borderTop: '2px solid var(--border, #bdbdbd)',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          backgroundColor: 'var(--bg, #f5f5f5)',
        }}>
          {platforms.map(p => (
            <button
              key={p}
              onClick={() => handleCopy(p)}
              style={{
                ...BUTTON,
                backgroundColor: copied === p ? 'var(--success, #16825d)' : 'transparent',
                color: copied === p ? 'var(--bg, #f5f5f5)' : 'var(--text, #2a2a2a)',
                borderColor: copied === p ? 'var(--success, #16825d)' : 'var(--border, #bdbdbd)',
              }}
            >
              {copied === p ? 'COPIED!' : `COPY FOR ${p.toUpperCase()}`}
            </button>
          ))}
          <button onClick={handleSaveDraft} disabled={saving} style={BUTTON_PRIMARY}>
            {saving ? 'SAVING...' : 'SAVE AS DRAFT'}
          </button>
        </div>
      </div>
    </div>
  );
}
