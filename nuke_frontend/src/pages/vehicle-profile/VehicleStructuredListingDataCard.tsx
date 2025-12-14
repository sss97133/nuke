import React from 'react';
import type { Vehicle } from './types';

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

  const options: string[] = Array.isArray(lart?.options) ? lart.options : [];
  const infoBullets: string[] = Array.isArray(lart?.info_bullets) ? lart.info_bullets : [];
  const serviceHistory: string[] = Array.isArray(lart?.service_history) ? lart.service_history : [];

  const sourceUrl = (vehicle as any)?.discovery_url || null;
  const isEmpty = options.length === 0 && infoBullets.length === 0 && serviceHistory.length === 0;

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
      </div>
    </div>
  );
};


