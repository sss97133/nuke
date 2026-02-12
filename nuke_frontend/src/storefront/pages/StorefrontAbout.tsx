import React from 'react';
import type { StorefrontOrg } from '../StorefrontApp';

interface Props {
  organization: StorefrontOrg;
}

export default function StorefrontAbout({ organization }: Props) {
  const social = organization.social_links || {};

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', maxWidth: 700 }}>
      <h2 style={{ fontSize: 'var(--fs-11, 11px)', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>
        About {organization.business_name}
      </h2>

      {organization.business_type && (
        <div style={{
          display: 'inline-block',
          padding: '2px 8px',
          fontSize: 'var(--fs-8, 8px)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--accent)',
          border: '2px solid var(--accent)',
          marginBottom: 16,
        }}>
          {organization.business_type.replace(/_/g, ' ')}
        </div>
      )}

      {organization.description && (
        <p style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--text)', lineHeight: 1.7, marginBottom: 24, whiteSpace: 'pre-wrap' }}>
          {organization.description}
        </p>
      )}

      {/* Contact Info */}
      <div style={{ background: 'var(--surface)', border: '2px solid var(--border)', padding: 16, marginBottom: 20 }}>
        <h3 style={{ fontSize: 'var(--fs-9, 9px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text)', marginBottom: 12 }}>
          Contact
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 'var(--fs-9, 9px)' }}>
          {(organization.city || organization.state) && (
            <div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-8, 8px)', fontWeight: 600, marginBottom: 2 }}>Location</div>
              <div style={{ color: 'var(--text)' }}>
                {[organization.city, organization.state].filter(Boolean).join(', ')}
              </div>
            </div>
          )}

          {organization.phone && (
            <div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-8, 8px)', fontWeight: 600, marginBottom: 2 }}>Phone</div>
              <a href={`tel:${organization.phone}`} style={{ color: 'var(--accent)' }}>{organization.phone}</a>
            </div>
          )}

          {organization.email && (
            <div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-8, 8px)', fontWeight: 600, marginBottom: 2 }}>Email</div>
              <a href={`mailto:${organization.email}`} style={{ color: 'var(--accent)' }}>{organization.email}</a>
            </div>
          )}

          {organization.website && (
            <div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-8, 8px)', fontWeight: 600, marginBottom: 2 }}>Website</div>
              <a href={organization.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                {organization.website.replace(/^https?:\/\//, '')}
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Social Links */}
      {Object.keys(social).length > 0 && (
        <div style={{ background: 'var(--surface)', border: '2px solid var(--border)', padding: 16 }}>
          <h3 style={{ fontSize: 'var(--fs-9, 9px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text)', marginBottom: 12 }}>
            Social
          </h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {Object.entries(social).map(([platform, url]) => (
              url && typeof url === 'string' && (
                <a
                  key={platform}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '4px 10px',
                    fontSize: 'var(--fs-8, 8px)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--accent)',
                    border: '2px solid var(--border)',
                    textDecoration: 'none',
                    transition: 'border-color 0.12s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  {platform}
                </a>
              )
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
