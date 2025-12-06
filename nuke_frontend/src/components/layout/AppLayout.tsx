import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import GlobalUploadIndicator from '../GlobalUploadIndicator';
import { ProfileBalancePill } from './ProfileBalancePill';
import { UploadStatusBar } from './UploadStatusBar';
import AIDataIngestionSearch from '../search/AIDataIngestionSearch';
import NotificationCenter from '../notifications/NotificationCenter';
import { AppLayoutProvider, usePreventDoubleLayout } from './AppLayoutContext';
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
  const [orgNavPath, setOrgNavPath] = useState<string>('/organizations');
  const [nZeroMenuOpen, setNZeroMenuOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

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
    setOrgNavPath('/organizations');
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
      <div className="header-wrapper">
        <div className="header-content">
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
                    background: '#ffffff',
                    border: '2px solid #bdbdbd',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    zIndex: 1000,
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
                      borderBottom: '1px solid #f0f0f0'
                    }}
                    onClick={() => setNZeroMenuOpen(false)}
                  >
                    Vehicles
                  </Link>
                  <Link
                    to="/auctions"
                    className={`nav-link ${isActivePage('/auctions') ? 'active' : ''}`}
                    style={{
                      display: 'block',
                      padding: '8px 12px',
                      textDecoration: 'none',
                      borderBottom: '1px solid #f0f0f0'
                    }}
                    onClick={() => setNZeroMenuOpen(false)}
                  >
                    Auctions
                  </Link>
                  <Link
                    to={orgNavPath}
                    className={`nav-link ${isActivePage('/shops') ? 'active' : ''}`}
                    style={{
                      display: 'block',
                      padding: '8px 12px',
                      textDecoration: 'none',
                      borderBottom: '1px solid #f0f0f0'
                    }}
                    onClick={() => setNZeroMenuOpen(false)}
                  >
                    Organizations
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

            {/* Home link - separate from menu */}
            <Link 
              to="/dash" 
              className={`nav-link ${isActivePage('/dash') ? 'active' : ''}`}
            >
              Home
            </Link>
          </div>

          <div className="header-right">
            {/* Global Search - AI Data Ingestion */}
            <div style={{ flex: '0 0 auto', minWidth: 0, maxWidth: '400px', marginRight: '8px' }}>
              <AIDataIngestionSearch />
            </div>

            {/* Upload Indicator - Windows 95 style */}
            <div style={{ flex: '0 0 auto', marginRight: '8px' }}>
              <GlobalUploadIndicator />
            </div>

            {/* Profile Balance Capsule - Combined balance + profile + navigation */}
            <div style={{ flex: '0 0 auto' }}>
              {session ? (
                <ProfileBalancePill
                  session={session}
                  userProfile={userProfile}
                  unreadCount={unreadNotifications}
                  onOpenNotifications={() => setShowNotifications(true)}
                />
              ) : (
                <Link to="/login" className="button button-primary" style={{ border: '2px solid #0ea5e9', transition: 'all 0.12s ease' }}>
                  Login
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Page Header with Title and Actions */}
      {(title || breadcrumbs || showBackButton || primaryAction) && (
        <div className="page-header">
          <div className="page-header-content">
            <div className="page-header-left">
              {showBackButton && (
                <button 
                  onClick={() => navigate(-1)} 
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

      {/* Notifications Flyout */}
      <NotificationCenter isOpen={showNotifications} onClose={() => setShowNotifications(false)} />

      {/* Footer */}
      <footer className="app-footer">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'center', fontSize: '8pt' }}>
          <span>NUKE © 2025</span>
          <a href="/about" style={{ color: 'inherit', textDecoration: 'underline' }}>About</a>
          <a href="/privacy" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy Policy</a>
          <a href="/terms" style={{ color: 'inherit', textDecoration: 'underline' }}>Terms of Service</a>
          <a href="/data-deletion" style={{ color: 'inherit', textDecoration: 'underline' }}>Data Deletion</a>
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
