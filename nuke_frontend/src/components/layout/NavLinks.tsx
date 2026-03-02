import React from 'react';
import { Link, useLocation } from 'react-router-dom';

export interface NavItem {
  label: string;
  path: string;
}

interface NavLinksProps {
  items: NavItem[];
}

export const NavLinks: React.FC<NavLinksProps> = ({ items }) => {
  const location = useLocation();

  return (
    <nav className="header-nav-links">
      {items.map((item) => {
        const isActive = location.pathname === item.path ||
          location.pathname.startsWith(item.path + '/');
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`header-nav-link ${isActive ? 'header-nav-link--active' : ''}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
};

// Default nav items for different variants
export const COMMAND_LINE_NAV: NavItem[] = [
  { label: 'MARKET', path: '/market' },
  { label: 'API', path: '/api' },
];

export const SEGMENTED_NAV: NavItem[] = [
  { label: 'SEARCH', path: '/search' },
  { label: 'MARKET', path: '/market' },
  { label: 'AUCTIONS', path: '/auctions' },
  { label: 'API', path: '/api' },
];

export const TWO_ROW_NAV: NavItem[] = [
  { label: 'SEARCH', path: '/search' },
  { label: 'MARKET', path: '/market' },
];
