import React, { useRef, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PrefetchLink } from '../PrefetchLink';
import { useHeaderHeight } from './hooks/useHeaderHeight';
import { useSession } from './hooks/useSession';
import { useNotificationBadge } from './hooks/useNotificationBadge';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import HeaderSearch from '../HeaderSearch';
import { UserArea } from './UserArea';
import { UserDropdown } from './UserDropdown';
import { useBranding } from '../../branding/BrandingContext';
import { useOptionalTheme } from '../../contexts/ThemeContext';
import GlobalUploadIndicator from '../GlobalUploadIndicator';
import './AppHeader.css';

interface AppHeaderProps {
  onOpenNotifications: () => void;
}

const NAV_LINKS = [
  { label: 'MARKET', to: '/?tab=market' },
  { label: 'FEED', to: '/?tab=feed' },
  { label: 'SEARCH', to: '/search' },
  { label: 'GARAGE', to: '/?tab=garage' },
  { label: 'JOURNAL', to: '/journal' },
  { label: 'STACKS', to: '/stacks' },
];
// Signed-in only: the work console (signature queue and the viewer's jobs).
const SIGNED_IN_NAV_LINKS = [{ label: 'WORK', to: '/work' }, { label: 'MESSAGES', to: '/messages' }];

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
  const { brand } = useBranding();
  const themeCtx = useOptionalTheme();
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
      const requestedTab = new URLSearchParams(location.search).get('tab');
      const currentTab = requestedTab === 'feed' || requestedTab === 'garage' ? requestedTab : 'market';
      return location.pathname === '/' && currentTab === tab;
    }
    return location.pathname.startsWith(to);
  };

  return (
    <div className="header-wrapper" ref={headerRef}>
      <div className="header">
        {/* Zone 1: Identity — wears the active brand if one is projected onto
            the shell, otherwise the Nuke wordmark. */}
        <Link
          to="/"
          className="header-wordmark"
          aria-label={brand ? `${brand.name} — home` : 'Nuke — home'}
          title={brand ? 'Powered by Nuke' : undefined}
        >
          {brand ? brand.name : 'NUKE'}
        </Link>

        {/* Zone 2: Navigation — hover-prefetch per McMaster benchmark */}
        <nav className="header-nav" aria-label="Main navigation">
          {(session ? [...NAV_LINKS, ...SIGNED_IN_NAV_LINKS] : NAV_LINKS).map(({ label, to }) => (
            <PrefetchLink
              key={to}
              to={to}
              className={`header-nav-link${isActive(to) ? ' active' : ''}`}
              aria-current={isActive(to) ? 'page' : undefined}
            >
              {label}
            </PrefetchLink>
          ))}
        </nav>

        {/* Zone 3: Command Input */}
        <div className="header-command">
          <HeaderSearch />
        </div>

        {/* Zone 4: Session */}
        <div className="header-session">
          {themeCtx && (
            <button
              type="button"
              className="header-theme-btn"
              onClick={themeCtx.toggleTheme}
              title={`Theme: ${themeCtx.theme.toUpperCase()} (${themeCtx.preference === 'auto' ? 'Auto' : 'Manual'}) — click to switch to ${themeCtx.theme === 'dark' ? 'Day (Light)' : 'Night (Dark)'}`}
              aria-label={`Switch to ${themeCtx.theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {themeCtx.theme === 'dark' ? 'DAY' : 'NIGHT'}
            </button>
          )}
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
