import React from 'react';
import type { Vehicle } from './types';
import { FaviconIcon } from '../../components/common/FaviconIcon';

function parseOptionRow(raw: string): { code: string | null; label: string } {
  const s = (raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return { code: null, label: '' };

  // Heuristic: treat a short all-caps token as a "code" only when it looks like an actual code.
  // This supports future RPO/SPID style data without forcing it on plain option text.
  const m = s.match(/^([A-Z0-9]{2,6})\s*[-:]\s*(.+)$/);
  if (m && m[2]) return { code: m[1], label: m[2].trim() };

  return { code: null, label: s };
}

export const VehicleStructuredListingDataCard: React.FC<{ vehicle: Vehicle }> = ({ vehicle }) => {
  const lart = (vehicle as any)?.origin_metadata?.lart || null;
  const originMeta = (vehicle as any)?.origin_metadata || {};

  const options: string[] = Array.isArray(lart?.options) ? lart.options : [];
  const infoBullets: string[] = Array.isArray(lart?.info_bullets) ? lart.info_bullets : [];
  const serviceHistory: string[] = Array.isArray(lart?.service_history) ? lart.service_history : [];
  
  // Mecum auction structured content
  const mecumHighlights: string[] = Array.isArray(originMeta.highlights) ? originMeta.highlights : [];
  const mecumStory: string = typeof originMeta.story === 'string' ? originMeta.story : '';

  // Extract Craigslist attributes from origin_metadata
  const craigslistAttrs: Array<{ label: string; value: string | number }> = [];
  if (originMeta.condition) craigslistAttrs.push({ label: 'Condition', value: String(originMeta.condition) });
  if (originMeta.drivetrain || originMeta.drive) craigslistAttrs.push({ label: 'Drive', value: String(originMeta.drivetrain || originMeta.drive) });
  if (originMeta.fuel_type || originMeta.fuel) craigslistAttrs.push({ label: 'Fuel', value: String(originMeta.fuel_type || originMeta.fuel) });
  if (originMeta.mileage || originMeta.odometer) {
    const odo = typeof (originMeta.mileage || originMeta.odometer) === 'number' 
      ? (originMeta.mileage || originMeta.odometer)
      : parseInt(String(originMeta.mileage || originMeta.odometer || '').replace(/,/g, ''));
    if (odo > 0) craigslistAttrs.push({ label: 'Odometer', value: odo.toLocaleString() });
  }
  if (originMeta.color || originMeta.paint_color) craigslistAttrs.push({ label: 'Paint Color', value: String(originMeta.color || originMeta.paint_color) });
  if (originMeta.title_status) craigslistAttrs.push({ label: 'Title Status', value: String(originMeta.title_status) });
  if (originMeta.transmission) craigslistAttrs.push({ label: 'Transmission', value: String(originMeta.transmission) });
  if (originMeta.body_style || originMeta.type) craigslistAttrs.push({ label: 'Type', value: String(originMeta.body_style || originMeta.type) });
  if (originMeta.cylinders) craigslistAttrs.push({ label: 'Cylinders', value: String(originMeta.cylinders) });

  // Extract location/lat/lng if available
  const locationData = (() => {
    const lat = originMeta.latitude || originMeta.lat || (originMeta.location?.latitude);
    const lng = originMeta.longitude || originMeta.lng || (originMeta.location?.longitude);
    const locationStr = originMeta.location || originMeta.listing_location;
    return { lat, lng, location: locationStr };
  })();

  const sourceUrl = (vehicle as any)?.discovery_url || null;
  const isCraigslist = sourceUrl?.includes('craigslist');
  const isMecum = sourceUrl?.includes('mecum.com');
  const isEmpty = options.length === 0 && infoBullets.length === 0 && serviceHistory.length === 0 && craigslistAttrs.length === 0 && !locationData.lat && mecumHighlights.length === 0 && !mecumStory;

  if (isEmpty) return null;

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', fontWeight: 700 }}>Structured Listing Data</span>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-utility"
            style={{ fontSize: '8px', padding: '2px 6px', textDecoration: 'none' }}
          >
            Source
          </a>
        )}
      </div>

      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Craigslist Attributes Table */}
        {craigslistAttrs.length > 0 && (
          <details open>
            <summary style={{ cursor: 'pointer', fontSize: '9pt', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isCraigslist && <FaviconIcon url={sourceUrl || 'https://craigslist.org'} size={12} preserveAspectRatio={true} />}
              Listing Attributes ({craigslistAttrs.length})
            </summary>
            <div style={{ marginTop: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
                <tbody>
                  {craigslistAttrs.map((attr, idx) => (
                    <tr key={idx} style={{ borderBottom: idx < craigslistAttrs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <td style={{ padding: '4px 8px', fontWeight: 700, color: 'var(--text-muted)', width: '35%', textTransform: 'capitalize' }}>
                        {attr.label}:
                      </td>
                      <td style={{ padding: '4px 8px', color: 'var(--text)' }}>
                        {typeof attr.value === 'number' ? attr.value.toLocaleString() : String(attr.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        {/* Location / Map Data */}
        {(locationData.lat || locationData.location) && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '9pt', fontWeight: 700 }}>
              Last Known Location
            </summary>
            <div style={{ marginTop: '8px', fontSize: '8pt', lineHeight: 1.5 }}>
              {locationData.location && (
                <div style={{ marginBottom: '4px' }}>
                  <strong>Location:</strong> {String(locationData.location)}
                </div>
              )}
              {locationData.lat && locationData.lng && (
                <div>
                  <strong>Coordinates:</strong>{' '}
                  <a
                    href={`https://www.google.com/maps?q=${locationData.lat},${locationData.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--link-color)', textDecoration: 'underline' }}
                  >
                    {Number(locationData.lat).toFixed(6)}, {Number(locationData.lng).toFixed(6)}
                  </a>
                </div>
              )}
            </div>
          </details>
        )}

        {infoBullets.length > 0 && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '9pt', fontWeight: 700 }}>Information</summary>
            <div style={{ marginTop: '8px', fontSize: '9pt', lineHeight: 1.5 }}>
              {infoBullets.map((line, idx) => (
                <div key={idx} style={{ padding: '2px 0' }}>
                  - {String(line).trim()}
                </div>
              ))}
            </div>
          </details>
        )}

        {options.length > 0 && (
          <details open>
            <summary style={{ cursor: 'pointer', fontSize: '9pt', fontWeight: 700 }}>
              Options ({options.length})
            </summary>

            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Parsed from the listing. Codes will populate automatically when present (RPO/SPID-style).
              </div>

              <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)' }}>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--border)', width: '110px' }}>
                        Code
                      </th>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--border)' }}>
                        Option
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {options.map((raw, idx) => {
                      const row = parseOptionRow(String(raw));
                      return (
                        <tr key={idx}>
                          <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>
                            {row.code || ''}
                          </td>
                          <td style={{ padding: '8px', borderBottom: '1px solid var(--border)' }}>
                            {row.label}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        )}

        {serviceHistory.length > 0 && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '9pt', fontWeight: 700 }}>
              Service Record Mentions ({serviceHistory.length})
            </summary>
            <div style={{ marginTop: '8px', fontSize: '9pt', lineHeight: 1.5 }}>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                These lines are breadcrumbs from the listing, not verified invoices. We will attribute them to the listing source.
              </div>
              {serviceHistory.map((line, idx) => (
                <div key={idx} style={{ padding: '2px 0' }}>
                  - {String(line).trim()}
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Mecum Auction: Highlights */}
        {mecumHighlights.length > 0 && (
          <details open>
            <summary style={{ cursor: 'pointer', fontSize: '9pt', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isMecum && <FaviconIcon url="https://www.mecum.com" size={12} preserveAspectRatio={true} />}
              Highlights ({mecumHighlights.length})
            </summary>
            <div style={{ marginTop: '8px', fontSize: '9pt', lineHeight: 1.6 }}>
              <ul style={{ margin: 0, paddingLeft: '16px', listStyleType: 'disc' }}>
                {mecumHighlights.map((highlight, idx) => (
                  <li key={idx} style={{ padding: '2px 0', color: 'var(--text)' }}>
                    {String(highlight).trim()}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}

        {/* Mecum Auction: The Story */}
        {mecumStory && (
          <details open>
            <summary style={{ cursor: 'pointer', fontSize: '9pt', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isMecum && <FaviconIcon url="https://www.mecum.com" size={12} preserveAspectRatio={true} />}
              The Story
            </summary>
            <div style={{ marginTop: '8px', fontSize: '9pt', lineHeight: 1.7 }}>
              {mecumStory.split('\n\n').map((paragraph, idx) => (
                <p key={idx} style={{ margin: idx === 0 ? 0 : '12px 0 0 0', color: 'var(--text)' }}>
                  {paragraph.trim()}
                </p>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
};


