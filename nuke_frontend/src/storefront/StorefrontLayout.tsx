import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { StorefrontOrg } from './StorefrontApp';

interface Props {
  organization: StorefrontOrg;
  children: React.ReactNode;
}

export default function StorefrontLayout({ organization, children }: Props) {
  const location = useLocation();
  const config = organization.ui_config?.storefront || {};

  const logo = config.logo || organization.logo_url;
  const banner = config.banner || organization.banner_url;

  const seoTitle = config.seo?.title || `${organization.business_name} — Inventory`;
  const seoDescription = config.seo?.description || organization.description || '';

  // Set document title
  React.useEffect(() => {
    document.title = seoTitle;

    const setMeta = (nameOrProp: string, content: string) => {
      const isOg = nameOrProp.startsWith('og:');
      const selector = isOg ? `meta[property="${nameOrProp}"]` : `meta[name="${nameOrProp}"]`;
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(isOg ? 'property' : 'name', nameOrProp);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    setMeta('description', seoDescription);
    setMeta('og:title', seoTitle);
    setMeta('og:description', seoDescription);
    setMeta('og:type', 'website');
    setMeta('og:url', window.location.href);
    if (logo) setMeta('og:image', logo);
  }, [seoTitle, seoDescription, logo]);

  const navLinks = [
    { to: '/', label: 'Home' },
    { to: '/inventory', label: 'Inventory' },
    { to: '/about', label: 'About' },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Header */}
      <header style={{
        background: 'var(--surface)',
        borderBottom: '2px solid var(--border)',
        padding: '12px 24px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            {logo && (
              <img
                src={logo}
                alt={organization.business_name}
                style={{ height: 36, width: 'auto', objectFit: 'contain' }}
              />
            )}
            <span style={{ fontSize: 'var(--fs-11, 11px)', fontWeight: 700, color: 'var(--text)', fontFamily: 'Arial, sans-serif' }}>
              {organization.business_name}
            </span>
          </Link>

          <nav style={{ display: 'flex', gap: 20 }}>
            {navLinks.map(({ to, label }) => {
              const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
              return (
                <Link
                  key={to}
                  to={to}
                  style={{
                    fontSize: 'var(--fs-9, 9px)',
                    fontFamily: 'Arial, sans-serif',
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    textDecoration: 'none',
                    fontWeight: active ? 700 : 400,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Banner */}
      {banner && location.pathname === '/' && (
        <div style={{
          height: 220,
          backgroundImage: `url(${banner})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          borderBottom: '2px solid var(--border)',
        }} />
      )}

      {/* Content */}
      <main style={{ flex: 1, maxWidth: 1200, margin: '0 auto', padding: 24, width: '100%' }}>
        {children}
      </main>

      {/* Footer */}
      <footer style={{
        background: 'var(--surface)',
        borderTop: '2px solid var(--border)',
        padding: '16px 24px',
        fontFamily: 'Arial, sans-serif',
        fontSize: 'var(--fs-8, 8px)',
        color: 'var(--text-secondary)',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontWeight: 600 }}>{organization.business_name}</span>
            {organization.city && organization.state && (
              <span> &middot; {organization.city}, {organization.state}</span>
            )}
            {organization.phone && <span> &middot; {organization.phone}</span>}
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {organization.website && (
              <a href={organization.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)' }}>
                Website
              </a>
            )}
            <span style={{ color: 'var(--text-disabled)' }}>
              Powered by <a href="https://nuke.ag" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Nuke</a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
