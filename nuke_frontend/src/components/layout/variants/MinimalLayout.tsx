import React from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../SearchBar';
import { UserArea } from '../UserArea';
import GlobalUploadIndicator from '../../GlobalUploadIndicator';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: (q: string) => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  session: any;
  userProfile: any;
  unreadCount: number;
  onUserClick: () => void;
  onCommandPaletteOpen: () => void;
}

/**
 * Variant D — Minimal
 * wordmark + Cmd+K trigger button + avatar
 * grid: [wordmark] [spacer] [user]
 * Height: 40px
 * Cmd+K opens full command palette overlay instead of focusing inline input
 */
export const MinimalLayout: React.FC<Props> = ({
  onSearchFocus,
  onCommandPaletteOpen,
  session,
  userProfile,
  unreadCount,
  onUserClick,
}) => {
  return (
    <div className="header-variant header-variant--minimal">
      <Link to="/" className="header-wordmark" aria-label="Nuke — home">
        NUKE
      </Link>

      <div className="header-minimal-spacer" />

      <SearchBar
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        onFocus={onCommandPaletteOpen}
        mode="trigger"
      />

      <div className="header-user-zone">
        <GlobalUploadIndicator />
        {session ? (
          <UserArea
            session={session}
            userProfile={userProfile}
            unreadCount={unreadCount}
            onClick={onUserClick}
          />
        ) : (
          <Link to="/login" className="header-login-btn">LOGIN</Link>
        )}
      </div>
    </div>
  );
};
