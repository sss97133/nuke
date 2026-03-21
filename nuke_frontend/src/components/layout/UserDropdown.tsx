import React, { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';

interface UserDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  session: any;
  isAdmin: boolean;
  unreadCount: number;
  onOpenNotifications: () => void;
}

export const UserDropdown: React.FC<UserDropdownProps> = ({
  isOpen,
  onClose,
  session,
  isAdmin,
  unreadCount,
  onOpenNotifications,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  return (
    <>
      <div className="user-dropdown-backdrop" onClick={onClose} />
      <div className="user-dropdown" ref={ref}>
        {/* Account section */}
        <div className="user-dropdown-section">
          <div className="user-dropdown-section-label">ACCOUNT</div>
          <button onClick={() => go(`/profile/${session?.user?.id || ''}`)}>Profile</button>
          <button onClick={() => go('/inbox')}>
            Inbox
          </button>
          <button onClick={() => { onOpenNotifications(); onClose(); }}>
            <span>Notifications</span>
            {unreadCount > 0 && (
              <span className="user-dropdown-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>
        </div>

        {/* Vehicles section */}
        <div className="user-dropdown-section">
          <div className="user-dropdown-section-label">VEHICLES</div>
          <button onClick={() => go('/vehicle/list')}>My Vehicles</button>
          <button onClick={() => go('/pipeline')}>Acquisitions</button>
        </div>

        {/* Navigation section */}
        <div className="user-dropdown-section">
          <div className="user-dropdown-section-label">NAVIGATION</div>
          <button onClick={() => go('/market')}>Market</button>
          <button onClick={() => go('/auctions')}>Auctions</button>
          <button onClick={() => go('/search')}>Search</button>
          <button onClick={() => go('/org')}>Organizations</button>
        </div>

        {/* Developer section */}
        <div className="user-dropdown-section">
          <div className="user-dropdown-section-label">DEVELOPER</div>
          <button onClick={() => go('/api')}>API</button>
          <button onClick={() => go('/developers')}>SDK Docs</button>
        </div>

        {/* Settings section */}
        <div className="user-dropdown-section">
          <div className="user-dropdown-section-label">SETTINGS</div>
          <button onClick={() => go('/capsule')}>Appearance</button>
          <button onClick={() => go('/capsule?tab=settings')}>Settings</button>
          {isAdmin && <button onClick={() => go('/admin')}>Admin</button>}
        </div>

        {/* Theme + Header variant */}
        <div className="user-dropdown-section user-dropdown-section--footer">
          <button onClick={(e) => { e.stopPropagation(); toggleTheme(); }}>
            <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            <span style={{ fontSize: '11px' }}>{theme === 'dark' ? '\u2600' : '\u263E'}</span>
          </button>
          <button
            className="user-dropdown-signout"
            onClick={async () => {
              onClose();
              try {
                await supabase.auth.signOut();
                navigate('/');
              } catch {
                // ignore
              }
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
};
