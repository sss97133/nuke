import React, { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useHeaderHeight } from './hooks/useHeaderHeight';
import { useSession } from './hooks/useSession';
import { useNotificationBadge } from './hooks/useNotificationBadge';
import { useAdminStatus } from './hooks/useAdminStatus';
import AIDataIngestionSearch from '../search/AIDataIngestionSearch';
import { UserArea } from './UserArea';
import { UserDropdown } from './UserDropdown';
import GlobalUploadIndicator from '../GlobalUploadIndicator';
import './AppHeader.css';

interface AppHeaderProps {
  onOpenNotifications: () => void;
}

/**
 * AppHeader — One row, three zones, 40px.
 *
 * [NUKE wordmark]  [command input (1fr)]  [upload + user]
 *
 * No variants. No toolbar slot. No nav links.
 * The command input IS the navigation.
 */
export const AppHeader: React.FC<AppHeaderProps> = ({
  onOpenNotifications,
}) => {
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeight(headerRef);

  const { session, userProfile } = useSession();
  const userId = session?.user?.id;
  const unreadCount = useNotificationBadge(userId);
  const isAdmin = useAdminStatus(userId);

  const [showUserDropdown, setShowUserDropdown] = useState(false);

  // Global Cmd+K — focus the command input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        // AIDataIngestionSearch manages its own focus internally
        // Dispatch a custom event it can listen for
        document.dispatchEvent(new CustomEvent('nuke:focus-command'));
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="header-wrapper" ref={headerRef}>
      <div className="header">
        {/* Zone 1: Identity */}
        <Link to="/" className="header-wordmark" aria-label="Nuke — home">
          NUKE
        </Link>

        {/* Zone 2: Command Input */}
        <div className="header-command">
          <AIDataIngestionSearch />
        </div>

        {/* Zone 3: Session */}
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
