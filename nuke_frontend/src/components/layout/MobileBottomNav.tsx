import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Home, Layers, Plus, Inbox, UserRound } from 'lucide-react';
import { PrefetchLink } from '../PrefetchLink';
import { supabase } from '../../lib/supabase';

export const MobileBottomNav: React.FC = () => {
  const location = useLocation();
  const [inboxCount, setInboxCount] = useState(0);

  // Fetch unorganized item count for inbox badge
  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        // The badge prints the number up to 999 and "999+" above, so it never needs an exact count.
        // my_unorganized_photo_count counts the signed-in user's own rows and stops at 1,000; the old
        // count=exact read fetched every unorganized row from the heap (5.5 s cold for 10k photos).
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: count } = await supabase.rpc('my_unorganized_photo_count');
        if (!cancelled && typeof count === 'number') setInboxCount(count);
      } catch { /* ignore */ }
    };
    fetchCount();
    return () => { cancelled = true; };
  }, [location.pathname]); // refresh on nav

  const items = [
    { to: '/', label: 'Home', icon: Home, match: (p: string) => p === '/' },
    { to: '/stacks', label: 'Stacks', icon: Layers, match: (p: string) => p.startsWith('/stacks') },
    { to: '/capture', label: 'Capture', icon: Plus, match: (p: string) => p === '/capture', isAdd: true },
    { to: '/inbox', label: 'Inbox', icon: Inbox, match: (p: string) => p.startsWith('/inbox') || p.startsWith('/photo-library'), badge: inboxCount },
    { to: '/profile', label: 'Profile', icon: UserRound, match: (p: string) => p.startsWith('/profile') },
  ];

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary">
      {items.map(item => (
        <PrefetchLink
          key={item.to}
          to={item.to}
          aria-label={item.label}
          aria-current={item.match(location.pathname) ? 'page' : undefined}
          className={`mobile-bottom-nav-item${item.match(location.pathname) ? ' active' : ''}${item.isAdd ? ' mobile-bottom-nav-item--capture' : ''}`}
        >
          <item.icon aria-hidden="true" size={21} strokeWidth={item.match(location.pathname) ? 2.3 : 1.8} />
          <small>{item.label}</small>
          {(item.badge ?? 0) > 0 && (
            <span className="mobile-bottom-nav-badge">{(item.badge ?? 0) > 999 ? '999+' : item.badge}</span>
          )}
        </PrefetchLink>
      ))}
    </nav>
  );
};
