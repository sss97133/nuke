import React from 'react';
import { Link, useLocation } from 'react-router-dom';

export const MobileBottomNav: React.FC = () => {
  const location = useLocation();

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary">
      <Link
        to="/"
        className={`mobile-bottom-nav-item ${location.pathname === '/' ? 'active' : ''}`}
      >
        Home
      </Link>
      <Link
        to="/capture"
        className={`mobile-bottom-nav-item ${location.pathname === '/capture' ? 'active' : ''}`}
        aria-label="Add vehicle"
      >
        +
      </Link>
      <Link
        to="/profile"
        className={`mobile-bottom-nav-item ${location.pathname.startsWith('/profile') ? 'active' : ''}`}
      >
        Profile
      </Link>
    </nav>
  );
};
