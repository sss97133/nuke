import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AppLayoutProvider, useAppLayoutContext, usePreventDoubleLayout } from './AppLayoutContext';
import { getVehicleIdentityParts } from '../../utils/vehicleIdentity';
import { useSession } from './hooks/useSession';
import { useNotificationBadge } from './hooks/useNotificationBadge';
import { useAdminStatus } from './hooks/useAdminStatus';
import { useCashBalance } from './hooks/useCashBalance';
import { useQuickVehicles } from './hooks/useQuickVehicles';
import { UploadStatusBar } from './UploadStatusBar';
import { AppHeader } from './AppHeader';
import { VehicleTabBar } from './VehicleTabBar';
import { PageHeader } from './PageHeader';
import { AppFooter } from './AppFooter';
import { MobileBottomNav } from './MobileBottomNav';
import '../../design-system.css';

const LazyNotificationCenter = lazy(() => import('../notifications/NotificationCenter'));

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
  showBackButton?: boolean;
  primaryAction?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  };
  breadcrumbs?: Array<{
    label: string;
    path?: string;
  }>;
}

const AppLayoutInner: React.FC<AppLayoutProps> = ({
  children,
  title,
  showBackButton = false,
  primaryAction,
  breadcrumbs
}) => {
  const { session, loading, userProfile } = useSession();
  const userId = session?.user?.id;
  const unreadCount = useNotificationBadge(userId);
  const isAdmin = useAdminStatus(userId);
  const balance = useCashBalance(userId);
  const { vehicles: quickVehicles, loading: quickVehiclesLoading, load: loadQuickVehicles } = useQuickVehicles();
  const [showNotifications, setShowNotifications] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();
  const { openVehicleTab, activeVehicleId, vehicleTabs } = useAppLayoutContext();

  // Sync vehicle tabs with URL
  useEffect(() => {
    const m = location.pathname.match(/^\/vehicle\/([^/]+)/i);
    const maybeId = m?.[1] ? String(m[1]).trim() : '';
    if (!maybeId || maybeId === 'list' || maybeId === 'add') return;
    const stateTitle = (location.state as any)?.vehicleTitle;
    const tabTitle = typeof stateTitle === 'string' ? stateTitle.trim() : '';
    openVehicleTab({ vehicleId: maybeId, title: tabTitle });
  }, [location.pathname, location.state, openVehicleTab]);

  // Fetch vehicle title for tabs without one
  useEffect(() => {
    if (!activeVehicleId) return;
    const tab = vehicleTabs.find((t) => t.vehicleId === activeVehicleId);
    if (!tab) return;
    const existing = String(tab.title || '').trim();
    if (existing && existing !== 'Vehicle') return;

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('id, year, make, model, normalized_model, series, trim, transmission, transmission_model')
          .eq('id', activeVehicleId)
          .maybeSingle();
        if (cancelled || error || !data) return;

        const identity = getVehicleIdentityParts(data as any);
        let nextTitle = [...identity.primary, ...identity.differentiators].join(' ').trim();

        if (nextTitle) {
          nextTitle = nextTitle.replace(/\s*for sale on BaT Auctions?\s*/gi, ' ').trim();
          nextTitle = nextTitle.replace(/\s*sold for \$[\d,]+ on [A-Z][a-z]+ \d{1,2}, \d{4}\s*/gi, ' ').trim();
          nextTitle = nextTitle.replace(/\s*\(Lot\s*#[\d,]+\s*\)\s*/gi, ' ').trim();
          nextTitle = nextTitle.replace(/\s*\|\s*Bring a Trailer\s*/gi, ' ').trim();
          nextTitle = nextTitle.replace(/\s*on bringatrailer\.com\s*/gi, ' ').trim();
          nextTitle = nextTitle.replace(/^\s*Euro\s+/i, ' ').trim();

          const year = data.year ? String(data.year) : null;
          const make = String(data.make || '').trim();
          if (year && make) {
            const escapedMake = make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const ymmRegex = new RegExp(`\\b${year}\\s+${escapedMake}\\b`, 'gi');
            const matches = Array.from(nextTitle.matchAll(ymmRegex));
            if (matches.length > 1) {
              const firstMatchEnd = matches[0].index! + matches[0][0].length;
              const afterFirstYMM = nextTitle.slice(firstMatchEnd).trim();
              if (afterFirstYMM.match(ymmRegex)) {
                const secondMatchIndex = nextTitle.indexOf(matches[1][0], firstMatchEnd);
                if (secondMatchIndex > 0) {
                  nextTitle = nextTitle.slice(0, secondMatchIndex).trim();
                }
              }
            }
          }

          nextTitle = nextTitle.replace(/\s*-\s*sold for.*$/i, '').trim();
          nextTitle = nextTitle.replace(/\s+for sale.*$/i, '').trim();
          nextTitle = nextTitle.replace(/\s+-\s+.*$/i, '').trim();
          nextTitle = nextTitle.replace(/\s+/g, ' ').trim();

          if (nextTitle.length > 50 && (nextTitle.includes('$') || nextTitle.toLowerCase().includes('sold'))) {
            const cleanBreak = nextTitle.search(/\s+(?:for sale|sold|-\s*\$\d|\(Lot)/i);
            if (cleanBreak > 0 && cleanBreak < nextTitle.length) {
              nextTitle = nextTitle.slice(0, cleanBreak).trim();
            }
          }
        }

        if (!nextTitle || nextTitle.length < 3) return;
        openVehicleTab({ vehicleId: activeVehicleId, title: nextTitle });
      } catch {
        // ignore
      }
    })();

    return () => { cancelled = true; };
  }, [activeVehicleId, vehicleTabs, openVehicleTab]);

  if (loading) {
    return (
      <div className="app-layout compact win95">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout compact win95">
      <a href="#main-content" className="sr-only focus:not-sr-only" style={{ position: 'absolute', left: '-9999px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden', zIndex: 9999 }} onFocus={(e) => { e.currentTarget.style.position = 'fixed'; e.currentTarget.style.top = '0'; e.currentTarget.style.left = '0'; e.currentTarget.style.width = 'auto'; e.currentTarget.style.height = 'auto'; e.currentTarget.style.padding = '8px 16px'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#000'; e.currentTarget.style.border = '2px solid #0ea5e9'; }} onBlur={(e) => { e.currentTarget.style.position = 'absolute'; e.currentTarget.style.left = '-9999px'; e.currentTarget.style.width = '1px'; e.currentTarget.style.height = '1px'; }}>Skip to content</a>

      <UploadStatusBar />

      <AppHeader
        session={session}
        userProfile={userProfile}
        unreadCount={unreadCount}
        balance={balance}
        isAdmin={isAdmin}
        quickVehicles={quickVehicles}
        quickVehiclesLoading={quickVehiclesLoading}
        onLoadQuickVehicles={loadQuickVehicles}
        onOpenNotifications={() => setShowNotifications(true)}
      />

      <VehicleTabBar />

      <PageHeader
        title={title}
        showBackButton={showBackButton}
        primaryAction={primaryAction}
        breadcrumbs={breadcrumbs}
      />

      <main id="main-content" className="main-content">
        <div className="content-container">
          {children}
        </div>
      </main>

      <MobileBottomNav />

      <Suspense fallback={null}>
        {showNotifications && (
          <LazyNotificationCenter isOpen={showNotifications} onClose={() => setShowNotifications(false)} />
        )}
      </Suspense>

      <AppFooter />
    </div>
  );
};

/**
 * AppLayout Component
 *
 * Provided at the route level in App.tsx.
 * Pages should NOT import and wrap themselves in AppLayout.
 */
const AppLayout: React.FC<AppLayoutProps> = (props) => {
  const isAlreadyWrapped = usePreventDoubleLayout();

  if (isAlreadyWrapped) {
    if (import.meta.env.DEV) {
      console.error('AppLayout double-wrap prevented');
    }
    return null;
  }

  return (
    <AppLayoutProvider>
      <AppLayoutInner {...props} />
    </AppLayoutProvider>
  );
};

export default AppLayout;
