import React from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../SearchBar';
import { NavLinks, COMMAND_LINE_NAV } from '../NavLinks';
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
}

/**
 * Variant A — Command Line
 * Search takes ~65% width, MARKET + API text links on left
 * grid: [wordmark] [search ~65%] [nav links] [user]
 * Height: 40px
 */
export const CommandLineLayout: React.FC<Props> = ({
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
}) => {
  return (
    <div className="header-variant header-variant--command-line">
      <Link to="/" className="header-wordmark" aria-label="Nuke — home">
        NUKE
      </Link>

      <div className="header-search-zone">
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

      <NavLinks items={COMMAND_LINE_NAV} />

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
