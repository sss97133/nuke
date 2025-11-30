/**
 * ProfileBalanceCapsule - Clean redesign from scratch
 * 
 * Design:
 * - Capsule shape with balance (left) and profile circle (right)
 * - Left side width grows with balance amount
 * - Default: expanded with balance visible
 * - Click anywhere: toggle expand/collapse
 * - Click balance: show dropdown menu
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface Props {
  session: any;
  userProfile: any;
}

interface CashBalance {
  available_cents: number;
  pending_cents: number;
}

export const ProfileBalancePill: React.FC<Props> = ({ session, userProfile }) => {
  const [balance, setBalance] = useState<CashBalance | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Load balance
  useEffect(() => {
    if (!session?.user?.id) return;
    
    const loadBalance = async () => {
      try {
        const { data, error } = await supabase
          .from('user_cash_balances')
          .select('available_cents, reserved_cents')
          .eq('user_id', session.user.id)
          .maybeSingle();
        
        if (error) {
          // If no row exists, set balance to 0
          if (error.code === 'PGRST116' || error.code === 'PGRST301') {
            setBalance({ available_cents: 0, pending_cents: 0 });
            return;
          }
          console.error('Error loading balance:', error);
          setBalance({ available_cents: 0, pending_cents: 0 });
          return;
        }
        
        // Map reserved_cents to pending_cents
        setBalance({
          available_cents: data?.available_cents ?? 0,
          pending_cents: data?.reserved_cents ?? 0
        });
      } catch (err) {
        console.error('Error loading balance:', err);
        setBalance({ available_cents: 0, pending_cents: 0 });
      }
    };

    loadBalance();

    // Subscribe to changes
    const channel = supabase
      .channel('balance')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_cash_balances',
        filter: `user_id=eq.${session.user.id}`
      }, loadBalance)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id]);

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
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; right: number } | null>(null);
  
  useEffect(() => {
    if (showMenu && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right
      });
    } else {
      setDropdownPosition(null);
    }
  }, [showMenu]);

  // Always show balance, default to 0.00 if no balance
  const availableCents = balance?.available_cents ?? 0;
  const amount = (availableCents / 100).toFixed(2);
  
  // Calculate balance width based on digits
  const balanceWidth = (() => {
    const len = amount.length;
    if (len <= 4) return 50;   // 0.00
    if (len === 5) return 60;   // 00.00
    if (len === 6) return 70;   // 000.00
    if (len === 7) return 80;   // 0000.00
    if (len === 8) return 90;   // 00000.00
    return 100;                 // 000000.00+
  })();

  const circleSize = 36;
  const capsuleWidth = expanded ? balanceWidth + circleSize : circleSize;

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {/* The Capsule */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          width: `${capsuleWidth}px`,
          height: `${circleSize}px`,
          backgroundColor: '#1a1a1a',
          borderRadius: '50px',
          overflow: 'hidden',
          transition: 'width 0.3s ease',
          cursor: 'pointer',
          border: '1px solid #333'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Balance (left side) - Always show when expanded */}
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
              color: '#fff',
              fontSize: '10pt',
              fontWeight: 700,
              fontFamily: '"MS Sans Serif", sans-serif',
              userSelect: 'none',
              height: '100%',
              paddingLeft: '12px'
            }}
          >
            ${amount}
          </div>
        )}

        {/* Profile circle (right side) */}
        <div
          style={{
            width: `${circleSize}px`,
            height: `${circleSize}px`,
            minWidth: `${circleSize}px`,
            minHeight: `${circleSize}px`,
            borderRadius: '50%',
            overflow: 'hidden',
            flexShrink: 0,
            backgroundColor: '#e5e5e5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {userProfile?.avatar_url ? (
            <img
              src={userProfile.avatar_url}
              alt="Profile"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center',
                display: 'block'
              }}
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
                color: '#333'
              }}
            >
              {session.user?.email?.[0].toUpperCase() || 'U'}
            </div>
          )}
        </div>
      </div>

      {/* Dropdown Menu */}
      {showMenu && dropdownPosition && (
        <>
          {/* Backdrop to prevent clicks and ensure dropdown is on top */}
          <div
            onClick={() => setShowMenu(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 9998,
              backgroundColor: 'transparent'
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: `${dropdownPosition.top}px`,
              right: `${dropdownPosition.right}px`,
              minWidth: '200px',
              backgroundColor: '#fff',
              border: '2px solid #000',
              boxShadow: '4px 4px 0 rgba(0,0,0,0.2)',
              zIndex: 9999
            }}
          >
          {/* Menu items - consolidated navigation */}
          {[
            { label: 'Capsule', action: '/capsule' },
            { label: 'Profile', action: `/profile/${session?.user?.id || ''}` },
            { label: 'Vehicles', action: '/vehicles' },
            { label: 'Auctions', action: '/auctions' },
            { label: 'Organizations', action: '/organizations' },
            { label: 'Photos', action: '/capsule?tab=photos' }
          ].map((item, i) => (
            <button
              key={i}
              onClick={() => {
                navigate(item.action);
                setShowMenu(false);
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: 'none',
                borderBottom: i < 9 ? '1px solid #eee' : 'none',
                backgroundColor: 'transparent',
                textAlign: 'left',
                fontSize: '9pt',
                cursor: 'pointer',
                fontFamily: '"MS Sans Serif", sans-serif'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e5e5'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              {item.label}
            </button>
          ))}
          </div>
        </>
      )}
    </div>
  );
};

