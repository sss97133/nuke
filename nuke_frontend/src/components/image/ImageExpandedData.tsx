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
  color: '#fff',
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
  tags?: any[];
  commentsCount?: number;
  /** Use dark theme (lightbox) vs light */
  dark?: boolean;
}

export const ImageExpandedData: React.FC<ImageExpandedDataProps> = ({
  imageRecord,
  imageMetadata,
  attribution,
  tags = [],
  commentsCount = 0,
  dark = true,
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

  const created = meta.created_at || meta.taken_at;
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
  const angle = meta.angle ? String(meta.angle).replace(/_/g, ' ') : '';
  const docType = meta.document_category || meta.sensitive_type ? String(meta.document_category || meta.sensitive_type).replace(/_/g, ' ') : '';
  const sourceType = meta.source ? String(meta.source).replace(/_/g, ' ') : '';
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

      {(sourceType || sourceUrl || attribution) && (
        <Section title="Source">
          {sourceType && <Field label="Type" value={sourceType} />}
          {attribution?.seller?.handle && <Field label="Seller" value={attribution.seller.handle} />}
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

      {(zone || angle || docType || meta.is_document) && (
        <Section title="Classification">
          {zone && <Field label="Vehicle zone" value={zone} />}
          {angle && <Field label="Angle" value={angle} />}
          {docType && <Field label="Document type" value={docType} />}
          {meta.is_document === true && !docType && <Field label="Document" value="Yes" />}
          {meta.vehicle_vin && <Field label="VIN (detected)" value={meta.vehicle_vin} />}
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

      <Section title="Tags">
        {tags.length > 0 ? (
          <div style={FIELD_VALUE_STYLE}>
            {tags.slice(0, 8).map((t) => t.tag_text || t.tag_name || t.text || 'tag').filter(Boolean).join(' · ')}
            {tags.length > 8 && ` · +${tags.length - 8}`}
          </div>
        ) : (
          <div style={{ ...FIELD_VALUE_STYLE, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>No tags</div>
        )}
      </Section>
    </div>
  );
};

export default ImageExpandedData;
