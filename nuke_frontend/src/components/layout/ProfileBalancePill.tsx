import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CashBalance } from './hooks/useCashBalance';

interface Props {
  session: any;
  userProfile: any;
  balance: CashBalance | null;
  isAdmin: boolean;
  unreadCount?: number;
  onOpenNotifications?: () => void;
}

export const ProfileBalancePill: React.FC<Props> = ({
  session,
  userProfile,
  balance,
  isAdmin,
  unreadCount = 0,
  onOpenNotifications,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  // Calculate dropdown position when menu opens
  useEffect(() => {
    if (showMenu && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      setDropdownPosition({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    } else {
      setDropdownPosition(null);
    }
  }, [showMenu]);

  const availableCents = balance?.available_cents ?? 0;
  const amount = (availableCents / 100).toFixed(2);

  const balanceWidth = (() => {
    const len = amount.length;
    if (len <= 4) return 50;
    if (len === 5) return 60;
    if (len === 6) return 70;
    if (len === 7) return 80;
    if (len === 8) return 90;
    return 100;
  })();

  const circleSize = 36;
  const capsuleWidth = expanded ? balanceWidth + circleSize : circleSize;

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          width: `${capsuleWidth}px`,
          height: `${circleSize}px`,
          backgroundColor: 'var(--surface)',
          borderRadius: '50px',
          overflow: 'hidden',
          transition: 'width 0.3s ease',
          cursor: 'pointer',
          border: '2px solid var(--border)'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text)',
              fontSize: '10pt',
              fontWeight: 700,
              fontFamily: '"MS Sans Serif", sans-serif',
              userSelect: 'none',
              height: '100%',
              paddingLeft: '0px'
            }}
          >
            ${amount}
          </div>
        )}

        <div
          style={{
            position: 'relative',
            width: `${circleSize}px`,
            height: `${circleSize}px`,
            minWidth: `${circleSize}px`,
            minHeight: `${circleSize}px`,
            borderRadius: '50%',
            overflow: 'hidden',
            flexShrink: 0,
            backgroundColor: 'var(--surface-hover)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {unreadCount > 0 && (
            <div
              style={{
                position: 'absolute',
                right: '-2px',
                bottom: '-2px',
                width: '10px',
                height: '10px',
                borderRadius: '999px',
                background: 'var(--error)',
                boxShadow: '0 0 0 2px var(--bg)'
              }}
            />
          )}
          {userProfile?.avatar_url ? (
            <img
              src={userProfile.avatar_url}
              alt="Profile"
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14pt',
                fontWeight: 700,
                color: 'var(--text)'
              }}
            >
              {session.user?.email?.[0].toUpperCase() || 'U'}
            </div>
          )}
        </div>
      </div>

      {showMenu && dropdownPosition && (
        <>
          <div className="profile-dropdown-backdrop" onClick={() => setShowMenu(false)} />
          <div
            className="profile-dropdown-menu"
            style={{ top: `${dropdownPosition.top}px`, right: `${dropdownPosition.right}px` }}
          >
            <button
              onClick={() => {
                if (onOpenNotifications) onOpenNotifications();
                else navigate('/notifications');
                setShowMenu(false);
              }}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}
            >
              <span>Notifications</span>
              {unreadCount > 0 && (
                <span style={{ background: '#dc2626', color: '#ffffff', borderRadius: '12px', padding: '2px 8px', fontSize: '10px', minWidth: '24px', textAlign: 'center' }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            {[
              { label: 'Capsule', action: '/capsule' },
              { label: 'Profile', action: `/profile/${session?.user?.id || ''}` },
              { label: 'Vehicles', action: '/vehicle/list' },
              { label: 'Auctions', action: '/auctions' },
              { label: 'Organizations', action: '/org' },
              { label: 'Market', action: '/market' },
              { label: 'Photos', action: '/capsule?tab=photos' },
              { label: 'Settings', action: '/capsule?tab=settings' },
              ...(isAdmin ? [{ label: 'Admin', action: '/admin' }] : [])
            ].map((item, i) => (
              <button key={i} onClick={() => { navigate(item.action); setShowMenu(false); }}>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
