import React from 'react';
import { Link, useLocation } from 'react-router-dom';

export const MobileBottomNav: React.FC = () => {
  const location = useLocation();

  const items = [
    { to: '/', label: 'Home', match: (p: string) => p === '/' },
    { to: '/search', label: 'Search', match: (p: string) => p.startsWith('/search') },
    { to: '/capture', label: '+', match: (p: string) => p === '/capture', isAdd: true },
    { to: '/market', label: 'Market', match: (p: string) => p.startsWith('/market') },
    { to: '/profile', label: 'Profile', match: (p: string) => p.startsWith('/profile') },
  ];

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-label={item.label}
          className={`mobile-bottom-nav-item${item.match(location.pathname) ? ' active' : ''}`}
          style={item.isAdd ? {
            fontWeight: 700,
            fontSize: '18px',
            lineHeight: 1,
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            background: 'var(--accent)',
            color: 'var(--bg)',
            flexShrink: 0,
          } : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
};
