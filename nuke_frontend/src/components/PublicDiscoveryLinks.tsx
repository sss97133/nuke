import React from 'react';
import { Link } from 'react-router-dom';
import { PUBLIC_DISCOVERY_LINKS } from '../lib/publicNav';

export function PublicDiscoveryLinks({ className }: { className?: string }) {
  return (
    <nav className={className} aria-label="Discover Nuke">
      {PUBLIC_DISCOVERY_LINKS.map((l, i) => (
        <React.Fragment key={l.to}>
          {i > 0 ? ' · ' : null}
          <Link to={l.to}>{l.label}</Link>
        </React.Fragment>
      ))}
    </nav>
  );
}
