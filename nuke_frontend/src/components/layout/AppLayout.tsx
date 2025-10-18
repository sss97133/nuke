import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import GlobalUploadIndicator from '../GlobalUploadIndicator';
import NotificationBell from '../notifications/NotificationBell';
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

const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  title,
  showBackButton = false,
  primaryAction,
  breadcrumbs
}) => {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [orgNavPath, setOrgNavPath] = useState<string>('/shops');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session?.user) {
        fetchUserProfile(session.user.id);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setLoading(false);
        if (session?.user) {
          fetchUserProfile(session.user.id);
        } else {
          setUserProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Compute destination for Organizations nav
  useEffect(() => {
    try {
      if (session?.user && typeof window !== 'undefined') {
        const id = window.localStorage.getItem('primaryShopId');
        if (id) {
          setOrgNavPath(`/org/${id}`);
          return;
        }
      }
    } catch {}
    setOrgNavPath('/shops');
  }, [session]);

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
      {/* Main Navigation Header */}
      <header className="app-header" style={{
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div className="header-content">
          <div className="header-left">
            <Link to="/" className="logo">
              <span className="logo-text">n-zero</span>
            </Link>
            
            {/* Desktop Navigation */}
            <nav className="main-nav desktop-nav">
              <Link 
                to="/dashboard" 
                className={`nav-link ${isActivePage('/dashboard') ? 'active' : ''}`}
              >
                Dashboard
              </Link>
              <Link 
                to="/vehicles" 
                className={`nav-link ${isActivePage('/vehicles') ? 'active' : ''}`}
              >
                Vehicles
              </Link>
              <Link 
                to={orgNavPath}
                className={`nav-link ${isActivePage('/shops') ? 'active' : ''}`}
              >
                Organizations
              </Link>
            </nav>
          </div>

          <div className="header-right">
            <button 
              className="mobile-menu-button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{ display: 'none' }}
            >
              ☺
            </button>

            {/* Upload Indicator - Windows 95 style */}
            <GlobalUploadIndicator />

            {/* Notifications */}
            {session ? <NotificationBell /> : null}

            {session ? (
              <>
              <Link to="/inbox" className="nav-link">Inbox</Link>
              <Link to="/profile" className="profile-bubble">
                {userProfile?.avatar_url ? (
                  <img
                    src={userProfile.avatar_url}
                    className="profile-image"
                  />
                ) : (
                  <div className="profile-initials">
                    {session.user?.email?.charAt(0).toUpperCase() || 'U'}
                  </div>
                )}
                Profile
              </Link>
              </>
            ) : (
              <Link to="/login" className="button button-primary">
                Login
              </Link>
            )}
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <nav className="mobile-nav">
            <Link 
              to="/dashboard" 
              className={`mobile-nav-link ${isActivePage('/dashboard') ? 'active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              Dashboard
            </Link>
            <Link 
              to="/vehicles" 
              className={`mobile-nav-link ${isActivePage('/vehicles') ? 'active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              Vehicles
            </Link>
            <Link 
              to="/shops" 
              className={`mobile-nav-link ${isActivePage('/shops') ? 'active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              Organizations
            </Link>
            {session && (
              <Link 
                to="/profile" 
                className="mobile-nav-link"
                onClick={() => setMobileMenuOpen(false)}
              >
                Profile
              </Link>
            )}
          </nav>
        )}
      </header>

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

      {/* Footer */}
      <footer className="app-footer">
        NUKE © 2025
      </footer>
    </div>
  );
};

export default AppLayout;
