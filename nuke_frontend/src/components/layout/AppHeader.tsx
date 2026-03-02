import React, { useRef, useState } from 'react';
import { useHeaderHeight } from './hooks/useHeaderHeight';
import { useHeaderVariant } from './hooks/useHeaderVariant';
import { useSearch } from './hooks/useSearch';
import { useSearchRouter } from './hooks/useSearchRouter';
import { useRecentItems } from './hooks/useRecentItems';
import { useCommandPalette } from './hooks/useCommandPalette';
import { useSession } from './hooks/useSession';
import { useNotificationBadge } from './hooks/useNotificationBadge';
import { useAdminStatus } from './hooks/useAdminStatus';
import { SearchOverlay } from './SearchOverlay';
import { UserDropdown } from './UserDropdown';
import { CommandLineLayout } from './variants/CommandLineLayout';
import { SegmentedLayout } from './variants/SegmentedLayout';
import { TwoRowLayout } from './variants/TwoRowLayout';
import { MinimalLayout } from './variants/MinimalLayout';
import './AppHeader.css';

interface AppHeaderProps {
  onOpenNotifications: () => void;
  toolbarSlot?: React.ReactElement | null;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  onOpenNotifications,
  toolbarSlot,
}) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useHeaderHeight(headerRef);

  const [variant] = useHeaderVariant();
  const { session, userProfile } = useSession();
  const userId = session?.user?.id;
  const unreadCount = useNotificationBadge(userId);
  const isAdmin = useAdminStatus(userId);

  const search = useSearch();
  const { handleSubmit, handleAutocompleteSelect } = useSearchRouter(search);
  const recentItems = useRecentItems();
  const cmdK = useCommandPalette();

  const [showUserDropdown, setShowUserDropdown] = useState(false);

  // Cmd+K behavior: focus search input in variants A/B/C, open palette in D
  const handleCmdK = () => {
    if (variant === 'minimal') {
      cmdK.open();
    } else {
      searchInputRef.current?.focus();
      search.setIsOpen(true);
    }
  };

  // Register global Cmd+K — the useCommandPalette hook handles the listener,
  // but we also connect it to focusing the search input
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        handleCmdK();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [variant]);

  const onSearchFocus = () => {
    search.setIsFocused(true);
    search.setIsOpen(true);
  };

  const onSearchBlur = () => {
    search.setIsFocused(false);
    // Don't close overlay immediately — let click events on overlay items fire first
    setTimeout(() => {
      if (!search.isFocused) {
        // Will be set false if user didn't click an overlay item
      }
    }, 200);
  };

  const onSearchSubmit = (q: string) => {
    recentItems.addItem(q, 'search');
    handleSubmit(q);
    search.setIsOpen(false);
  };

  const sharedProps = {
    query: search.query,
    onQueryChange: search.setQuery,
    onSubmit: onSearchSubmit,
    onSearchFocus,
    onSearchBlur,
    searchInputRef,
    session,
    userProfile,
    unreadCount,
    onUserClick: () => setShowUserDropdown(true),
  };

  return (
    <div className="header-wrapper" ref={headerRef}>
      {/* Variant layout */}
      {variant === 'command-line' && <CommandLineLayout {...sharedProps} />}
      {variant === 'segmented' && <SegmentedLayout {...sharedProps} />}
      {variant === 'two-row' && <TwoRowLayout {...sharedProps} />}
      {variant === 'minimal' && (
        <MinimalLayout
          {...sharedProps}
          onCommandPaletteOpen={handleCmdK}
        />
      )}

      {/* Contextual page toolbar (injected by pages via AppLayoutContext) */}
      {toolbarSlot && (
        <div className="header-toolbar-slot">{toolbarSlot}</div>
      )}

      {/* Search overlay (shared across all variants) */}
      <SearchOverlay
        isOpen={search.isOpen && (search.query.length >= 2 || (search.isFocused && !search.query))}
        onClose={() => search.setIsOpen(false)}
        autocompleteResults={search.autocompleteResults}
        autocompleteLoading={search.autocompleteLoading}
        recentItems={recentItems.items}
        onSelect={(cat, val, label) => {
          recentItems.addItem(label, cat);
          handleAutocompleteSelect(cat, val, label);
        }}
        onRecentSelect={(q) => {
          search.setQuery(q);
          onSearchSubmit(q);
        }}
        onRecentRemove={recentItems.removeItem}
        onRecentClear={recentItems.clearAll}
        query={search.query}
      />

      {/* User dropdown (shared across all variants) */}
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
