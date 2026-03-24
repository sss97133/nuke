/**
 * ImageExpandedData — Reference-catalog-style expanded data for the image viewer.
 * Sections: Identity, Source, Classification, EXIF, Location, Stats, Tags.
 * Used in desktop sidebar and mobile swipe panel. No emojis; Arial; label + value rows.
 */
import React from 'react';

const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: '9px',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--gulf-orange, #F37021)',
  marginBottom: '8px',
};

const FIELD_LABEL_STYLE: React.CSSProperties = {
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: '9px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.55)',
};

const FIELD_VALUE_STYLE: React.CSSProperties = {
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: '11px',
  color: 'var(--surface-elevated)',
  lineHeight: 1.5,
  marginTop: '1px',
  wordBreak: 'break-word',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
      <div style={SECTION_TITLE_STYLE}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div style={{ marginBottom: '6px' }}>
      <div style={FIELD_LABEL_STYLE}>{label}</div>
      <div style={FIELD_VALUE_STYLE}>{String(value)}</div>
    </div>
  );
}

export interface ImageExpandedDataProps {
  /** Raw image row from gallery (caption, file_name, category, vehicle_zone, angle, etc.) */
  imageRecord?: any;
  /** Loaded metadata (created_at, taken_at, exif_data, is_primary, source, etc.) */
  imageMetadata?: any;
  /** Attribution / source info */
  attribution?: any;
  /** Resolved angle from resolveAngle utility */
  resolvedAngle?: { label: string; degrees?: { x: number; y: number; z?: number }; zone?: string; confidence?: number } | null;
  tags?: any[];
  commentsCount?: number;
  /** Use dark theme (lightbox) vs light */
  dark?: boolean;
  /** AI-generated description (best pass from image_descriptions) */
  description?: string | null;
  /** Session name if image belongs to an auto-session */
  sessionName?: string | null;
  /** Session type label */
  sessionType?: string | null;
}

export const ImageExpandedData: React.FC<ImageExpandedDataProps> = ({
  imageRecord,
  imageMetadata,
  attribution,
  resolvedAngle,
  tags = [],
  commentsCount = 0,
  dark = true,
  description,
  sessionName,
  sessionType,
}) => {
  const meta = imageMetadata || imageRecord || {};
  const id = meta.id;
  const shortId = id && typeof id === 'string' ? id.slice(0, 8) + '…' : '';

  const displayName =
    meta.caption && String(meta.caption).trim()
      ? meta.caption
      : meta.file_name || meta.filename
        ? String(meta.file_name || meta.filename).trim()
        : meta.vehicle_zone
          ? String(meta.vehicle_zone).replace(/_/g, ' ')
          : meta.angle
            ? String(meta.angle).replace(/_/g, ' ')
            : meta.document_category || meta.sensitive_type
              ? String(meta.document_category || meta.sensitive_type).replace(/_/g, ' ')
              : '';

  const created = meta.taken_at || meta.created_at;
  const dateStr = created
    ? (() => {
        try {
          const d = new Date(created);
          return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' • ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        } catch {
          return '';
        }
      })()
    : '';

  const exif = meta.exif_data;
  const cameraStr = exif?.camera
    ? typeof exif.camera === 'string'
      ? exif.camera
      : `${exif.camera?.make || ''} ${exif.camera?.model || ''}`.trim() || '—'
    : '';
  const focal = exif?.focalLength || exif?.technical?.focalLength;
  const fNumber = exif?.fNumber || exif?.technical?.fNumber;
  const exposure = exif?.exposureTime || exif?.technical?.exposureTime;
  const iso = exif?.iso || exif?.technical?.iso;
  const exifLine = [focal ? `${typeof focal === 'number' ? focal : String(focal).replace('mm', '')}mm` : null, fNumber ? `f/${fNumber}` : null, exposure ? (typeof exposure === 'number' && exposure < 1 ? `1/${Math.round(1 / exposure)}s` : `${exposure}s`) : null, iso ? `ISO ${iso}` : null].filter(Boolean).join(' • ');
  const dimensions = exif?.dimensions;

  const loc = exif?.location || exif?.gps;
  const lat = loc?.latitude ?? meta.latitude;
  const lng = loc?.longitude ?? meta.longitude;
  const locationStr = loc?.city ? `${loc.city}${loc.state ? `, ${loc.state}` : ''}` : lat != null && lng != null ? `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}` : '';

  const zone = meta.vehicle_zone ? String(meta.vehicle_zone).replace(/_/g, ' ') : '';
  const rawAngle = meta.angle ? String(meta.angle).replace(/_/g, ' ') : '';
  const angleLabel = resolvedAngle?.label || rawAngle;
  const angleDegrees = resolvedAngle?.degrees;
  const angleDisplay = angleDegrees
    ? `${angleLabel} (${Math.round(angleDegrees.x)} / ${Math.round(angleDegrees.y)})`
    : angleLabel;
  const docType = meta.document_category || meta.sensitive_type ? String(meta.document_category || meta.sensitive_type).replace(/_/g, ' ') : '';
  const SOURCE_LABELS: Record<string, string> = {
    user_upload: 'User Upload',
    bat_import: 'Bring a Trailer',
    bat_listing: 'Bring a Trailer',
    iphoto: 'Apple Photos',
    mecum: 'Mecum Auctions',
    organization_import: 'Dealer Import',
    gooding: 'Gooding & Company',
    broad_arrow: 'Broad Arrow',
    bonhams_import: 'Bonhams',
    pcarmarket: 'PCarMarket',
    external_import: 'External',
    dealer_scrape: 'Dealer',
    craigslist_listing: 'Craigslist',
    craigslist_scrape: 'Craigslist',
    facebook_marketplace: 'Facebook Marketplace',
    hagerty: 'Hagerty',
    scraper: 'Web Import',
  };
  const rawSource = meta.source || '';
  const sourceLabel = SOURCE_LABELS[rawSource] || (rawSource ? String(rawSource).replace(/_/g, ' ') : '');
  const uploaderUsername = attribution?.uploader?.username;
  const uploaderAvatar = attribution?.uploader?.avatar_url;
  const uploaderDisplayLabel = (rawSource === 'user_upload' && uploaderUsername) ? `@${uploaderUsername}` : sourceLabel;
  const sourceUrl = meta.source_url || exif?.source_url || exif?.discovery_url || '';

  return (
    <div style={{ fontSize: '11px' }}>
      <Section title="Identity">
        {displayName && <Field label="Name" value={displayName} />}
        {shortId && <Field label="ID" value={shortId} />}
        {(meta.file_name || meta.filename) && <Field label="Filename" value={meta.file_name || meta.filename} />}
        {meta.caption && meta.caption !== displayName && <Field label="Caption" value={meta.caption} />}
        {(meta.category || meta.image_category) && <Field label="Category" value={meta.category || meta.image_category} />}
        {dateStr && <Field label="Date" value={dateStr} />}
      </Section>

      {(uploaderDisplayLabel || sourceUrl || attribution) && (
        <Section title="Source">
          {uploaderDisplayLabel && (
            <div style={{ marginBottom: '6px' }}>
              <div style={FIELD_LABEL_STYLE}>Source</div>
              <div style={{ ...FIELD_VALUE_STYLE, display: 'flex', alignItems: 'center', gap: '6px' }}>
                {uploaderAvatar && (
                  <img
                    src={uploaderAvatar}
                    alt=""
                    style={{ width: 12, height: 12, border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }}
                  />
                )}
                {uploaderUsername && rawSource === 'user_upload' ? (
                  <a href={`/profile/${uploaderUsername}`} style={{ color: 'var(--gulf-blue, #6AADE4)', textDecoration: 'none' }}>
                    @{uploaderUsername}
                  </a>
                ) : (
                  <span>{uploaderDisplayLabel}</span>
                )}
              </div>
            </div>
          )}
          {attribution?.photographer?.name && (
            <Field label="Photographer" value={attribution.photographer.name} />
          )}
          {attribution?.seller?.handle && <Field label="Seller" value={`@${attribution.seller.handle}`} />}
          {attribution?.organization?.name && <Field label="Organization" value={attribution.organization.name} />}
          {sourceUrl && (
            <div style={{ marginBottom: '6px' }}>
              <div style={FIELD_LABEL_STYLE}>URL</div>
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ ...FIELD_VALUE_STYLE, color: 'var(--gulf-blue, #6AADE4)', textDecoration: 'underline' }}>
                {sourceUrl.length > 48 ? sourceUrl.slice(0, 48) + '…' : sourceUrl}
              </a>
            </div>
          )}
        </Section>
      )}

      {(zone || angleDisplay || docType || meta.is_document) && (
        <Section title="Classification">
          {zone && <Field label="Vehicle zone" value={zone} />}
          {angleDisplay && (
            <div style={{ marginBottom: '6px' }}>
              <div style={FIELD_LABEL_STYLE}>Angle</div>
              <div style={FIELD_VALUE_STYLE}>
                {resolvedAngle?.label || rawAngle}
                {angleDegrees && (
                  <span style={{ fontFamily: "'Courier New', Courier, monospace", color: 'rgba(255,255,255,0.6)', marginLeft: '6px', fontSize: '10px' }}>
                    {Math.round(angleDegrees.x)} AZ / {Math.round(angleDegrees.y)} EL
                  </span>
                )}
              </div>
            </div>
          )}
          {docType && <Field label="Document type" value={docType} />}
          {meta.is_document === true && !docType && <Field label="Document" value="Yes" />}
          {meta.vehicle_vin && <Field label="VIN (detected)" value={meta.vehicle_vin} />}
        </Section>
      )}

      {(description || sessionName) && (
        <Section title="AI Description">
          {description && (
            <div style={{ marginBottom: '6px' }}>
              <div style={FIELD_VALUE_STYLE}>{description}</div>
            </div>
          )}
          {sessionName && <Field label="Session" value={sessionName} />}
          {sessionType && <Field label="Session type" value={sessionType} />}
        </Section>
      )}

      {(cameraStr || exifLine || dimensions) && (
        <Section title="Camera & EXIF">
          {cameraStr && <Field label="Camera" value={cameraStr} />}
          {exifLine && <Field label="Exposure" value={exifLine} />}
          {dimensions && <Field label="Dimensions" value={`${dimensions.width} × ${dimensions.height}`} />}
        </Section>
      )}

      {locationStr && (
        <Section title="Location">
          <div style={FIELD_VALUE_STYLE}>{locationStr}</div>
        </Section>
      )}

      {(meta.view_count != null || commentsCount > 0) && (
        <Section title="Stats">
          {meta.view_count != null && <Field label="Views" value={String(meta.view_count)} />}
          {commentsCount > 0 && <Field label="Comments" value={String(commentsCount)} />}
        </Section>
      )}

      {/* Deep Analysis (Reference Catalog forensic data) */}
      {(() => {
        const deep = meta.ai_scan_metadata?.deep_analysis || (imageRecord?.ai_scan_metadata?.deep_analysis);
        if (!deep) return null;

        const cond = deep.condition_detail;
        const surf = deep.surface_analysis;
        const deg = deep.degradation;
        const color = deep.color_data;
        const mods = deep.modifications;
        const subj = deep.subject;
        const env = deep.light_and_environment;

        const scoreColor = (s: number) =>
          s >= 7 ? 'var(--success)' : s >= 4 ? '#facc15' : 'var(--error)';

        return (
          <>
            {/* Condition */}
            {cond && (
              <Section title="Condition">
                {cond.overall_score != null && (
                  <div style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      fontFamily: "'Courier New', Courier, monospace",
                      fontSize: '13px',
                      fontWeight: 700,
                      color: 'var(--text)',
                      backgroundColor: scoreColor(cond.overall_score),
                      border: '2px solid ' + scoreColor(cond.overall_score),
                    }}>
                      {cond.overall_score}/10
                    </span>
                    {cond.restoration_state && (
                      <span style={{
                        padding: '2px 6px',
                        fontSize: '9px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'rgba(255,255,255,0.7)',
                        border: '1px solid rgba(255,255,255,0.2)',
                      }}>
                        {cond.restoration_state.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                )}
                {cond.structural_integrity && <Field label="Structural integrity" value={cond.structural_integrity.replace(/_/g, ' ')} />}
                {cond.condition_notes && <Field label="Notes" value={cond.condition_notes} />}
              </Section>
            )}

            {/* Surface */}
            {surf && (surf.primary_material || surf.surface_finish || surf.paint_observations) && (
              <Section title="Surface">
                {surf.primary_material && <Field label="Material" value={surf.primary_material.replace(/_/g, ' ')} />}
                {surf.surface_finish && <Field label="Finish" value={surf.surface_finish.replace(/_/g, ' ')} />}
                {surf.paint_observations && <Field label="Paint" value={surf.paint_observations} />}
                {surf.coating_layers_visible && <Field label="Coating layers" value={surf.coating_layers_visible} />}
              </Section>
            )}

            {/* Degradation */}
            {deg && (deg.lifecycle_state || deg.degradation_narrative) && (
              <Section title="Degradation">
                {deg.lifecycle_state && (
                  <div style={{ marginBottom: '6px' }}>
                    <span style={{
                      padding: '2px 6px',
                      fontSize: '9px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: deg.lifecycle_state === 'archaeological' || deg.lifecycle_state === 'terminal' ? 'var(--error)' :
                             deg.lifecycle_state === 'active_decay' ? '#facc15' : 'rgba(255,255,255,0.7)',
                      border: '1px solid rgba(255,255,255,0.2)',
                    }}>
                      {deg.lifecycle_state.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
                {deg.mechanisms?.length > 0 && (
                  <div style={{ marginBottom: '6px' }}>
                    <div style={FIELD_LABEL_STYLE}>Mechanisms</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                      {deg.mechanisms.map((m: string, i: number) => (
                        <span key={i} style={{
                          padding: '1px 5px',
                          fontSize: '9px',
                          fontFamily: "'Courier New', Courier, monospace",
                          color: 'rgba(255,255,255,0.7)',
                          border: '1px solid rgba(255,255,255,0.15)',
                        }}>
                          {m.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {deg.degradation_narrative && <Field label="Narrative" value={deg.degradation_narrative} />}
              </Section>
            )}

            {/* Color */}
            {color && (color.paint_color_name || color.dominant_colors?.length > 0) && (
              <Section title="Color">
                {color.dominant_colors?.length > 0 && (
                  <div style={{ marginBottom: '6px' }}>
                    <div style={FIELD_LABEL_STYLE}>Palette</div>
                    <div style={{ display: 'flex', gap: '4px', marginTop: '3px' }}>
                      {color.dominant_colors.map((hex: string, i: number) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <span style={{
                            display: 'inline-block',
                            width: '14px',
                            height: '14px',
                            backgroundColor: hex,
                            border: '1px solid rgba(255,255,255,0.3)',
                            flexShrink: 0,
                          }} />
                          <span style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>
                            {hex}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {color.paint_color_name && <Field label="Paint name" value={color.paint_color_name} />}
                {color.color_narrative && <Field label="Narrative" value={color.color_narrative} />}
              </Section>
            )}

            {/* Modifications */}
            {mods && (mods.detected?.length > 0 || mods.period_correct != null) && (
              <Section title="Modifications">
                {mods.detected?.length > 0 && (
                  <div style={{ marginBottom: '6px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {mods.detected.map((m: string, i: number) => (
                        <span key={i} style={{
                          padding: '1px 5px',
                          fontSize: '9px',
                          fontFamily: "'Courier New', Courier, monospace",
                          color: 'rgba(255,255,255,0.8)',
                          border: '1px solid rgba(255,255,255,0.2)',
                        }}>
                          {m.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {mods.period_correct != null && <Field label="Period correct" value={mods.period_correct ? 'Yes' : 'No'} />}
                {mods.modification_quality && <Field label="Quality" value={mods.modification_quality.replace(/_/g, ' ')} />}
              </Section>
            )}

            {/* Subject Details */}
            {subj && (subj.primary_focus || subj.components_visible?.length > 0) && (
              <Section title="Subject">
                {subj.primary_focus && <Field label="Focus" value={subj.primary_focus} />}
                {subj.components_visible?.length > 0 && (
                  <div style={{ marginBottom: '6px' }}>
                    <div style={FIELD_LABEL_STYLE}>Components</div>
                    <div style={{ ...FIELD_VALUE_STYLE, fontSize: '10px' }}>
                      {subj.components_visible.map((c: string) => c.replace(/_/g, ' ')).join(' / ')}
                    </div>
                  </div>
                )}
                {subj.hardware_visible?.length > 0 && (
                  <div style={{ marginBottom: '6px' }}>
                    <div style={FIELD_LABEL_STYLE}>Hardware</div>
                    <div style={{ ...FIELD_VALUE_STYLE, fontSize: '10px' }}>
                      {subj.hardware_visible.map((h: string) => h.replace(/_/g, ' ')).join(' / ')}
                    </div>
                  </div>
                )}
                {subj.text_visible?.length > 0 && (
                  <div style={{ marginBottom: '6px' }}>
                    <div style={FIELD_LABEL_STYLE}>Text visible</div>
                    <div style={FIELD_VALUE_STYLE}>
                      {subj.text_visible.join(', ')}
                    </div>
                  </div>
                )}
              </Section>
            )}

            {/* Fabrication & Environment */}
            {(deep.fabrication_stage || env) && (
              <Section title="Environment">
                {deep.fabrication_stage && <Field label="Fabrication stage" value={deep.fabrication_stage.replace(/_/g, ' ')} />}
                {env?.lighting && <Field label="Lighting" value={env.lighting.replace(/_/g, ' ')} />}
                {env?.environment && <Field label="Environment" value={env.environment.replace(/_/g, ' ')} />}
                {env?.photo_quality_score != null && <Field label="Photo quality" value={`${env.photo_quality_score}/10`} />}
              </Section>
            )}

            {/* Forensic Observations */}
            {deep.forensic_observations && (
              <Section title="Forensic Notes">
                <div style={FIELD_VALUE_STYLE}>{deep.forensic_observations}</div>
              </Section>
            )}
          </>
        );
      })()}

      <Section title="Tags">
        {tags.length > 0 ? (
          <div style={FIELD_VALUE_STYLE}>
            {tags.slice(0, 8).map((t) => t.tag_text || t.tag_name || t.text || 'tag').filter(Boolean).join(' · ')}
            {tags.length > 8 && ` · +${tags.length - 8}`}
          </div>
        ) : (
          <div style={{ ...FIELD_VALUE_STYLE, color: 'rgba(255,255,255,0.4)' }}>No tags</div>
        )}
      </Section>
    </div>
  );
};

export default ImageExpandedData;
