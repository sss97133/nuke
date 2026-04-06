import React, { useRef, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useHeaderHeight } from './hooks/useHeaderHeight';
import { useSession } from './hooks/useSession';
import { useNotificationBadge } from './hooks/useNotificationBadge';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import AIDataIngestionSearch from '../search/AIDataIngestionSearch';
import { UserArea } from './UserArea';
import { UserDropdown } from './UserDropdown';
import GlobalUploadIndicator from '../GlobalUploadIndicator';
import './AppHeader.css';

interface AppHeaderProps {
  onOpenNotifications: () => void;
}

const NAV_LINKS = [
  { label: 'FEED', to: '/?tab=feed' },
  { label: 'SEARCH', to: '/search' },
  { label: 'GARAGE', to: '/?tab=garage' },
  { label: 'MARKET', to: '/market/trends' },
];

/**
 * AppHeader — One row, four zones, 40px.
 *
 * [NUKE wordmark]  [nav links]  [command input (1fr)]  [upload + user]
 */
export const AppHeader: React.FC<AppHeaderProps> = ({
  onOpenNotifications,
}) => {
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeight(headerRef);

  const { session, userProfile } = useSession();
  const userId = session?.user?.id;
  const unreadCount = useNotificationBadge(userId);
  const { isAdmin } = useAdminAccess();
  const location = useLocation();

  const [showUserDropdown, setShowUserDropdown] = useState(false);

  // Global Cmd+K — focus the command input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('nuke:focus-command'));
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const isActive = (to: string) => {
    if (to.includes('?tab=')) {
      const tab = new URLSearchParams(to.split('?')[1]).get('tab');
      const currentTab = new URLSearchParams(location.search).get('tab');
      return location.pathname === '/' && currentTab === tab;
    }
    return location.pathname.startsWith(to);
  };

  return (
    <div className="header-wrapper" ref={headerRef}>
      <div className="header">
        {/* Zone 1: Identity */}
        <Link to="/" className="header-wordmark" aria-label="Nuke — home">
          NUKE
        </Link>

        {/* Zone 2: Navigation */}
        <nav className="header-nav" aria-label="Main navigation">
          {NAV_LINKS.map(({ label, to }) => (
            <Link
              key={to}
              to={to}
              className={`header-nav-link${isActive(to) ? ' active' : ''}`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Zone 3: Command Input */}
        <div className="header-command">
          <AIDataIngestionSearch />
        </div>

        {/* Zone 4: Session */}
        <div className="header-session">
          <GlobalUploadIndicator />
          {session ? (
            <UserArea
              session={session}
              userProfile={userProfile}
              unreadCount={unreadCount}
              onClick={() => setShowUserDropdown(true)}
            />
          ) : (
            <Link to="/login" className="header-login-btn">LOGIN</Link>
          )}
        </div>
      </div>

      {/* User dropdown (shared) */}
      {session && (
        <UserDropdown
          isOpen={showUserDropdown}
          onClose={() => setShowUserDropdown(false)}
          session={session}
          isAdmin={isAdmin}
          unreadCount={unreadCount}
          onOpenNotifications={onOpenNotifications}
        />
      )}
    </div>
  );
};
