import React from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../SearchBar';
import { NavLinks, TWO_ROW_NAV } from '../NavLinks';
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
  hideSearch?: boolean;
}

/**
 * Variant C — Two Row
 * Row 1 (28px): wordmark + nav + user
 * Row 2 (36px): full-width search + filter controls
 * Total: 64px
 */
export const TwoRowLayout: React.FC<Props> = ({
  query,
  onQueryChange,
  onSubmit,
  onSearchFocus,
  onSearchBlur,
  searchInputRef,
  session,
  userProfile,
  unreadCount,
  onUserClick,
  hideSearch,
}) => {
  return (
    <div className="header-variant header-variant--two-row">
      {/* Row 1: Identity */}
      <div className="header-two-row-identity">
        <Link to="/" className="header-wordmark header-wordmark--sm" aria-label="Nuke — home">
          NUKE
        </Link>

        <NavLinks items={TWO_ROW_NAV} />

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

      {/* Row 2: Search */}
      {!hideSearch && (
        <div className="header-two-row-search">
          <SearchBar
            value={query}
            onChange={onQueryChange}
            onSubmit={onSubmit}
            onFocus={onSearchFocus}
            onBlur={onSearchBlur}
            mode="inline"
            inputRef={searchInputRef}
          />
        </div>
      )}
    </div>
  );
};
