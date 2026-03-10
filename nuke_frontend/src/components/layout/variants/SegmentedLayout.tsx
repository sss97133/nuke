import React from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../SearchBar';
import { NavLinks, SEGMENTED_NAV } from '../NavLinks';
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
 * Variant B — Segmented
 * Nav with underline indicator, search ~35-40%
 * grid: [wordmark] [nav links 1fr] [search minmax(200px,40%)] [user]
 * Height: 40px
 */
export const SegmentedLayout: React.FC<Props> = ({
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
    <div className={`header-variant header-variant--segmented${hideSearch ? ' header-variant--no-search' : ''}`}>
      <Link to="/" className="header-wordmark" aria-label="Nuke — home">
        NUKE
      </Link>

      <NavLinks items={SEGMENTED_NAV} />

      {!hideSearch && (
        <div className="header-search-zone">
          <SearchBar
            value={query}
            onChange={onQueryChange}
            onSubmit={onSubmit}
            onFocus={onSearchFocus}
            onBlur={onSearchBlur}
            mode="compact"
            inputRef={searchInputRef}
          />
        </div>
      )}

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
