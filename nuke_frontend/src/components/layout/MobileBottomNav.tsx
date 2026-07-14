import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

export const MobileBottomNav: React.FC = () => {
  const location = useLocation();
  const [inboxCount, setInboxCount] = useState(0);

  // Fetch unorganized item count for inbox badge
  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        // Scope to the signed-in user: hits the partial index
        // idx_vehicle_images_unorganized (user_id, created_at) WHERE vehicle_id IS NULL.
        // The unscoped variant counted every user's orphans and timed out (15s 500).
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { count } = await supabase
          .from('vehicle_images')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .is('vehicle_id', null)
          .or('organization_status.eq.unorganized,organization_status.is.null');
        if (!cancelled && count != null) setInboxCount(count);
      } catch { /* ignore */ }
    };
    fetchCount();
    return () => { cancelled = true; };
  }, [location.pathname]); // refresh on nav

  const items = [
    { to: '/', label: 'Home', match: (p: string) => p === '/' },
    { to: '/search', label: 'Search', match: (p: string) => p.startsWith('/search') },
    { to: '/capture', label: '+', match: (p: string) => p === '/capture', isAdd: true },
    { to: '/inbox', label: 'Inbox', match: (p: string) => p.startsWith('/inbox') || p.startsWith('/photo-library'), badge: inboxCount },
    { to: '/profile', label: 'Profile', match: (p: string) => p.startsWith('/profile') },
  ];

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary">
      {items.map((item: any) => (
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
            justifyContent: 'center', background: 'var(--accent)',
            color: 'var(--bg)',
            flexShrink: 0,
          } : { position: 'relative' as const }}
        >
          {item.label}
          {item.badge > 0 && (
            <span style={{
              position: 'absolute',
              top: -2,
              right: -2,
              background: 'var(--error, #d13438)',
              color: 'var(--surface-elevated)',
              fontSize: '7px',
              fontWeight: 700,
              fontFamily: 'Arial, sans-serif',
              minWidth: 14,
              height: 14,
              lineHeight: '14px',
              textAlign: 'center',
              padding: '0 3px',
            }}>{item.badge > 999 ? '999+' : item.badge}</span>
          )}
        </Link>
      ))}
    </nav>
  );
};
