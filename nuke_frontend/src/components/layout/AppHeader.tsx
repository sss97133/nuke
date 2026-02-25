import React, { useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import GlobalUploadIndicator from '../GlobalUploadIndicator';
import { ProfileBalancePill } from './ProfileBalancePill';
import { NukeMenu } from './NukeMenu';
import { SearchSlot } from './SearchSlot';
import { useHeaderHeight } from './hooks/useHeaderHeight';
import type { QuickVehicle } from './hooks/useQuickVehicles';
import type { CashBalance } from './hooks/useCashBalance';

interface AppHeaderProps {
  session: any;
  userProfile: any;
  unreadCount: number;
  balance: CashBalance | null;
  isAdmin: boolean;
  quickVehicles: QuickVehicle[];
  quickVehiclesLoading: boolean;
  onLoadQuickVehicles: (userId: string) => void;
  onOpenNotifications: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  session,
  userProfile,
  unreadCount,
  balance,
  isAdmin,
  quickVehicles,
  quickVehiclesLoading,
  onLoadQuickVehicles,
  onOpenNotifications,
}) => {
  const headerWrapperRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useHeaderHeight(headerWrapperRef);

  return (
    <div className="header-wrapper" ref={headerWrapperRef}>
      <div className="header-content">
        {/* Left: Nuke menu */}
        <div className="header-slot-left">
          <div className="header-left">
            <NukeMenu
              session={session}
              quickVehicles={quickVehicles}
              quickVehiclesLoading={quickVehiclesLoading}
              onLoadQuickVehicles={onLoadQuickVehicles}
            />
          </div>
        </div>

        <div className="header-spacer" aria-hidden="true" />

        {/* Center: Search */}
        <div className="header-slot-center">
          <SearchSlot />
        </div>

        <div className="header-spacer" aria-hidden="true" />

        {/* Right: Upload + Profile/Login */}
        <div className="header-slot-right">
          <div className="header-right">
            <GlobalUploadIndicator />
            {session ? (
              <ProfileBalancePill
                session={session}
                userProfile={userProfile}
                balance={balance}
                isAdmin={isAdmin}
                unreadCount={unreadCount}
                onOpenNotifications={onOpenNotifications}
              />
            ) : (
              <Link
                to={(() => {
                  const loc = location.pathname + location.search;
                  const returnUrl = loc && loc !== '/' ? encodeURIComponent(loc) : '';
                  return returnUrl ? `/login?returnUrl=${returnUrl}` : '/login';
                })()}
                className="button button-primary"
                style={{ border: '2px solid #0ea5e9', transition: 'all 0.12s ease' }}
              >
                Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
