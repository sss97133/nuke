import React, { useRef, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import GlobalUploadIndicator from '../GlobalUploadIndicator';
import { ProfileBalancePill } from './ProfileBalancePill';
import { UploadStatusBar } from './UploadStatusBar';
import AIDataIngestionSearch from '../search/AIDataIngestionSearch';
import NotificationCenter from '../notifications/NotificationCenter';
import { AppLayoutProvider, useAppLayoutContext, usePreventDoubleLayout } from './AppLayoutContext';
import { getVehicleIdentityParts } from '../../utils/vehicleIdentity';
import '../../design-system.css';

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
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [orgNavPath, setOrgNavPath] = useState<string>('/org');
  const [nZeroMenuOpen, setNZeroMenuOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { vehicleTabs, activeVehicleId, openVehicleTab, closeVehicleTab, setActiveVehicleTab } = useAppLayoutContext();
  const headerWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const m = location.pathname.match(/^\/vehicle\/([^/]+)/i);
    const maybeId = m?.[1] ? String(m[1]).trim() : '';
    if (!maybeId || maybeId === 'list' || maybeId === 'add') return;

    const stateTitle = (location.state as any)?.vehicleTitle;
    const title = typeof stateTitle === 'string' ? stateTitle.trim() : '';
    openVehicleTab({ vehicleId: maybeId, title });
  }, [location.pathname, location.state, openVehicleTab]);

  useEffect(() => {
    if (!activeVehicleId) return;
    const tab = vehicleTabs.find((t) => t.vehicleId === activeVehicleId);
    if (!tab) return;

    // If we already have a meaningful title, don't fetch.
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
        if (cancelled) return;
        if (error || !data) return;

        const identity = getVehicleIdentityParts(data as any);
        let nextTitle = [...identity.primary, ...identity.differentiators].join(' ').trim();
        
        // Final sanitization pass to remove any remaining BaT contamination
        if (nextTitle) {
          // Remove BaT listing patterns that might have slipped through
          nextTitle = nextTitle.replace(/\s*for sale on BaT Auctions?\s*/gi, ' ').trim();
          nextTitle = nextTitle.replace(/\s*sold for \$[\d,]+ on [A-Z][a-z]+ \d{1,2}, \d{4}\s*/gi, ' ').trim();
          nextTitle = nextTitle.replace(/\s*\(Lot\s*#[\d,]+\s*\)\s*/gi, ' ').trim();
          nextTitle = nextTitle.replace(/\s*\|\s*Bring a Trailer\s*/gi, ' ').trim();
          nextTitle = nextTitle.replace(/\s*on bringatrailer\.com\s*/gi, ' ').trim();
          
          // Remove "Euro" prefix that's often contamination
          nextTitle = nextTitle.replace(/^\s*Euro\s+/i, ' ').trim();
          
          // Remove duplicate year/make/model patterns
          // Pattern: "1973 BMW 3.0CSi ... Euro 1973 BMW 3.0CSi" -> "1973 BMW 3.0CSi"
          const year = data.year ? String(data.year) : null;
          const make = String(data.make || '').trim();
          if (year && make) {
            // Look for duplicate YMM pattern
            const escapedMake = make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const ymmRegex = new RegExp(`\\b${year}\\s+${escapedMake}\\b`, 'gi');
            const matches = Array.from(nextTitle.matchAll(ymmRegex));
            if (matches.length > 1) {
              // Find where the first YMM pattern ends and check if there's a duplicate after
              const firstMatchEnd = matches[0].index + matches[0][0].length;
              const afterFirstYMM = nextTitle.slice(firstMatchEnd).trim();
              // If there's another year+make pattern after, remove everything from that point
              if (afterFirstYMM.match(ymmRegex)) {
                // Keep only the first YMM + model (everything up to but not including the duplicate)
                const secondMatchIndex = nextTitle.indexOf(matches[1][0], firstMatchEnd);
                if (secondMatchIndex > 0) {
                  nextTitle = nextTitle.slice(0, secondMatchIndex).trim();
                }
              }
            }
          }
          
          // Remove any remaining "for sale" or "sold for" patterns at the end
          nextTitle = nextTitle.replace(/\s*-\s*sold for.*$/i, '').trim();
          nextTitle = nextTitle.replace(/\s+for sale.*$/i, '').trim();
          nextTitle = nextTitle.replace(/\s+-\s+.*$/i, '').trim(); // Remove any trailing " - " patterns
          
          // Collapse whitespace
          nextTitle = nextTitle.replace(/\s+/g, ' ').trim();
          
          // If title is still suspiciously long (>50 chars) and contains price/sale patterns, truncate aggressively
          if (nextTitle.length > 50 && (nextTitle.includes('$') || nextTitle.toLowerCase().includes('sold'))) {
            // Try to find a clean break point (end of model name)
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

    return () => {
      cancelled = true;
    };
  }, [activeVehicleId, vehicleTabs, openVehicleTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!headerWrapperRef.current) return;

    const updateHeaderHeight = () => {
      const el = headerWrapperRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const heightPx = Math.max(0, Math.round(rect.bottom));
      document.documentElement.style.setProperty('--header-height', `${heightPx}px`);
    };

    updateHeaderHeight();

    const onScroll = () => updateHeaderHeight();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', updateHeaderHeight);

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateHeaderHeight()) : null;
    if (ro) ro.observe(headerWrapperRef.current);

    const mo = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => updateHeaderHeight())
      : null;
    if (mo && document?.body) {
      mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', updateHeaderHeight);
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
    };
  }, []);

  useEffect(() => {
    // Close menu when clicking outside
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-n-zero-menu]')) {
        setNZeroMenuOpen(false);
      }
    };

    if (nZeroMenuOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [nZeroMenuOpen]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session?.user) {
        fetchUserProfile(session.user.id);
        loadUnreadCount(session.user.id);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setLoading(false);
        if (session?.user) {
          fetchUserProfile(session.user.id);
          loadUnreadCount(session.user.id);
        } else {
          setUserProfile(null);
          setUnreadNotifications(0);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Compute destination for Organizations nav
  useEffect(() => {
    setOrgNavPath('/org');
  }, [session]);

  useEffect(() => {
    // Subscribe to notification changes for badge updates
    if (!session?.user?.id) return;
    const channel = supabase
      .channel('notification_badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${session.user.id}` },
        () => loadUnreadCount(session.user.id)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  const fetchUserProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (!error && data) {
        setUserProfile(data);
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
    }
  };

  const loadUnreadCount = async (userId: string) => {
    try {
      const { data, error } = await supabase.rpc('get_unread_notification_count', {
        p_user_id: userId
      });
      if (error) throw error;
      setUnreadNotifications(data || 0);
    } catch (error) {
      console.error('Error loading unread notifications:', error);
      setUnreadNotifications(0);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const isActivePage = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

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
      {/* Upload Status Bar */}
      <UploadStatusBar />
      
      {/* Main Navigation Header */}
      <div className="header-wrapper" ref={headerWrapperRef}>
        <div className="header-content">
          {/* 8%: n-zero button (dropdown is popup so doesn't affect layout) */}
          <div className="header-slot-left">
            <div className="header-left">
              {/* n-zero Expandable Menu */}
              <div style={{ position: 'relative' }} data-n-zero-menu>
                <button
                  onClick={() => setNZeroMenuOpen(!nZeroMenuOpen)}
                  className={`nav-link ${nZeroMenuOpen ? 'active' : ''}`}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <span>n-zero</span>
                  <span style={{ fontSize: '7pt' }}>{nZeroMenuOpen ? '▼' : '▶'}</span>
                </button>

                {nZeroMenuOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      background: 'var(--surface)',
                      border: '2px solid var(--border)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      zIndex: 2000,
                      minWidth: '160px',
                      marginTop: '2px'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link
                      to="/vehicles"
                      className={`nav-link ${isActivePage('/vehicles') ? 'active' : ''}`}
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        textDecoration: 'none',
                        borderBottom: '1px solid var(--border)'
                      }}
                      onClick={() => setNZeroMenuOpen(false)}
                    >
                      Vehicles
                    </Link>
                    <Link
                      to="/search"
                      className={`nav-link ${isActivePage('/search') ? 'active' : ''}`}
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        textDecoration: 'none',
                        borderBottom: '1px solid var(--border)'
                      }}
                      onClick={() => setNZeroMenuOpen(false)}
                    >
                      Search
                    </Link>
                    <Link
                      to="/auctions"
                      className={`nav-link ${isActivePage('/auctions') ? 'active' : ''}`}
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        textDecoration: 'none',
                        borderBottom: '1px solid var(--border)'
                      }}
                      onClick={() => setNZeroMenuOpen(false)}
                    >
                      Auctions
                    </Link>
                    <Link
                      to={orgNavPath}
                      className={`nav-link ${isActivePage('/org') ? 'active' : ''}`}
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        textDecoration: 'none',
                        borderBottom: '1px solid var(--border)'
                      }}
                      onClick={() => setNZeroMenuOpen(false)}
                    >
                      Organizations
                    </Link>
                    <Link
                      to="/invoices"
                      className={`nav-link ${isActivePage('/invoices') ? 'active' : ''}`}
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        textDecoration: 'none',
                        borderBottom: '1px solid var(--border)'
                      }}
                      onClick={() => setNZeroMenuOpen(false)}
                    >
                      Invoices
                    </Link>
                    <Link
                      to="/market"
                      className={`nav-link ${isActivePage('/market') ? 'active' : ''}`}
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        textDecoration: 'none',
                        borderBottom: '1px solid var(--border)'
                      }}
                      onClick={() => setNZeroMenuOpen(false)}
                    >
                      Market
                    </Link>
                    <Link
                      to="/market/contracts"
                      className={`nav-link ${isActivePage('/market/contracts') ? 'active' : ''}`}
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        textDecoration: 'none',
                        borderBottom: '1px solid var(--border)'
                      }}
                      onClick={() => setNZeroMenuOpen(false)}
                    >
                      Contract Station
                    </Link>
                    <a
                      href="https://n-zero.dev/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="nav-link"
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        textDecoration: 'none'
                      }}
                      onClick={() => setNZeroMenuOpen(false)}
                    >
                      n-zero
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 2% spacer */}
          <div className="header-spacer" aria-hidden="true" />

          {/* 80%: agent input (shrinks when right capsule expands) */}
          <div className="header-slot-center">
            <AIDataIngestionSearch />
          </div>

          {/* 2% spacer */}
          <div className="header-spacer" aria-hidden="true" />

          {/* 8%: capsule area (can grow beyond 8% when expanded; steals from center) */}
          <div className="header-slot-right">
            <div className="header-right">
              <GlobalUploadIndicator />
              {session ? (
                <ProfileBalancePill
                  session={session}
                  userProfile={userProfile}
                  unreadCount={unreadNotifications}
                  onOpenNotifications={() => setShowNotifications(true)}
                />
              ) : (
                <Link
                  to="/login"
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

      {vehicleTabs.length > 0 && (
        <div
          style={{
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="content-container">
            <div
              style={{
                display: 'flex',
                gap: '2px',
                padding: '4px 0',
                overflowX: 'auto',
                alignItems: 'center',
              }}
            >
              {vehicleTabs.map((t) => {
                const isActive = !!activeVehicleId && t.vehicleId === activeVehicleId;
                return (
                  <div
                    key={t.vehicleId}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      border: '1px solid var(--border)',
                      background: isActive ? 'var(--grey-600)' : 'var(--white)',
                      color: isActive ? 'var(--white)' : 'var(--text)',
                      height: '24px',
                      maxWidth: '240px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveVehicleTab(t.vehicleId);
                        navigate(`/vehicle/${t.vehicleId}`);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'inherit',
                        cursor: 'pointer',
                        fontSize: '8pt',
                        padding: '0 8px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '210px',
                        textAlign: 'left',
                      }}
                      title={t.title}
                    >
                      {t.title}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const wasActive = t.vehicleId === activeVehicleId;
                        const nextId = wasActive ? (vehicleTabs.find((x) => x.vehicleId !== t.vehicleId)?.vehicleId || '') : '';
                        closeVehicleTab(t.vehicleId);
                        if (wasActive) {
                          if (nextId) {
                            setActiveVehicleTab(nextId);
                            navigate(`/vehicle/${nextId}`);
                          } else {
                            setActiveVehicleTab(undefined);
                            navigate('/');
                          }
                        }
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'inherit',
                        cursor: 'pointer',
                        fontSize: '9pt',
                        padding: '0 6px',
                        height: '100%',
                      }}
                      aria-label="Close tab"
                      title="Close"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Page Header with Title and Actions */}
      {(title || breadcrumbs || showBackButton || primaryAction) && (
        <div className="page-header">
          <div className="page-header-content">
            <div className="page-header-left">
              {showBackButton && (
                <button 
                  onClick={() => {
                    // Safe back navigation: check if we can go back in history
                    // If history is empty or would navigate to external/404, go to homepage
                    if (window.history.length > 1) {
                      // Try to go back, but catch any errors
                      try {
                        navigate(-1);
                      } catch (error) {
                        // Fallback to homepage if back navigation fails
                        navigate('/');
                      }
                    } else {
                      // No history, go to homepage
                      navigate('/');
                    }
                  }} 
                  className="button button-secondary back-button"
                >
                  ← Back
                </button>
              )}
              
              <div className="page-title-section">
                {breadcrumbs && (
                  <nav className="breadcrumbs">
                    {breadcrumbs.map((crumb, index) => (
                      <span key={index} className="breadcrumb">
                        {crumb.path ? (
                          <Link to={crumb.path}>{crumb.label}</Link>
                        ) : (
                          <span>{crumb.label}</span>
                        )}
                        {index < breadcrumbs.length - 1 && <span className="breadcrumb-separator">→</span>}
                      </span>
                    ))}
                  </nav>
                )}
                
                {title && <h1 className="page-title">{title}</h1>}
              </div>
            </div>

            {primaryAction && (
              <div className="page-header-right">
                <button 
                  onClick={primaryAction.onClick}
                  className={`button ${primaryAction.variant === 'secondary' ? 'button-secondary' : 'button-primary'}`}
                >
                  {primaryAction.label}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="main-content">
        <div className="content-container">
          {children}
        </div>
      </main>

      <nav className="mobile-bottom-nav" aria-label="Primary">
        <Link
          to="/"
          className={`mobile-bottom-nav-item ${location.pathname === '/' ? 'active' : ''}`}
          onClick={() => setNZeroMenuOpen(false)}
        >
          Home
        </Link>
        <Link
          to="/capture"
          className={`mobile-bottom-nav-item ${location.pathname === '/capture' ? 'active' : ''}`}
          onClick={() => setNZeroMenuOpen(false)}
        >
          +
        </Link>
        <Link
          to="/profile"
          className={`mobile-bottom-nav-item ${location.pathname.startsWith('/profile') ? 'active' : ''}`}
          onClick={() => setNZeroMenuOpen(false)}
        >
          Profile
        </Link>
      </nav>

      {/* Notifications Flyout */}
      <NotificationCenter isOpen={showNotifications} onClose={() => setShowNotifications(false)} />

      {/* Footer */}
      <footer className="app-footer">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'center', fontSize: '8pt' }}>
          <span>NUKE © 2025</span>
          <Link to="/about" style={{ color: 'inherit', textDecoration: 'underline' }}>About</Link>
          <Link to="/privacy" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy Policy</Link>
          <Link to="/terms" style={{ color: 'inherit', textDecoration: 'underline' }}>Terms of Service</Link>
          <Link to="/data-deletion" style={{ color: 'inherit', textDecoration: 'underline' }}>Data Deletion</Link>
        </div>
      </footer>
    </div>
  );
};

/**
 * AppLayout Component
 * 
 * ⚠️ IMPORTANT: AppLayout is already provided at the route level in App.tsx.
 * Pages should NOT import and wrap themselves in AppLayout - this will cause double headers/footers.
 * 
 * If you see this error, remove the AppLayout wrapper from your page component.
 */
const AppLayout: React.FC<AppLayoutProps> = (props) => {
  // Check if we're already inside an AppLayout (nested)
  const isAlreadyWrapped = usePreventDoubleLayout();
  
  // If already wrapped, return null to prevent duplicate headers/footers
  if (isAlreadyWrapped) {
    if (import.meta.env.DEV) {
      console.error('🚨 AppLayout double-wrap prevented - returning null to avoid duplicate headers/footers');
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
