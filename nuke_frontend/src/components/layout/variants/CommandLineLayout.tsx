import React from 'react';
import { Link } from 'react-router-dom';
import AIDataIngestionSearch from '../../search/AIDataIngestionSearch';
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
  hideSearch?: boolean;
}

/**
 * Variant A — Command Line
 * Universal input bar takes ~65% width — accepts URLs, VINs, images, text, drag-drop.
 * grid: [wordmark] [universal input ~65%] [nav links] [user]
 * Height: 40px
 */
export const CommandLineLayout: React.FC<Props> = ({
  session,
  userProfile,
  unreadCount,
  onUserClick,
  hideSearch,
}) => {
  return (
    <div className={`header-variant header-variant--command-line${hideSearch ? ' header-variant--no-search' : ''}`}>
      <Link to="/" className="header-wordmark" aria-label="Nuke — home">
        NUKE
      </Link>

      {!hideSearch && (
        <div className="header-search-zone">
          <AIDataIngestionSearch />
        </div>
      )}

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
