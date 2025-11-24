import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import GlobalUploadIndicator from '../GlobalUploadIndicator';
import { ProfileBalancePill } from './ProfileBalancePill';
import { UploadStatusBar } from './UploadStatusBar';
import VehicleSearch from '../VehicleSearch';
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
  const [orgNavPath, setOrgNavPath] = useState<string>('/organizations');
  const [navExpanded, setNavExpanded] = useState<boolean>(true);
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
    setOrgNavPath('/organizations');
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
      {/* Upload Status Bar */}
      <UploadStatusBar />
      
      {/* Main Navigation Header */}
      <header className="app-header" style={{
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div className="header-content">
          <div className="header-left">
            <button
              type="button"
              onClick={() => setNavExpanded(prev => !prev)}
              className="logo"
              style={{
                border: 'none',
                padding: 0,
                background: 'transparent',
                cursor: 'pointer'
              }}
            >
              <span className="logo-text">n-zero</span>
            </button>
            
            {/* Desktop Navigation */}
            <nav className={`main-nav desktop-nav ${navExpanded ? '' : 'collapsed'}`}>
              <Link 
                to="/dashboard" 
                className={`nav-link ${isActivePage('/dashboard') ? 'active' : ''}`}
              >
                Home
              </Link>
              <Link 
                to="/vehicles" 
                className={`nav-link ${isActivePage('/vehicles') ? 'active' : ''}`}
              >
                Vehicles
              </Link>
              <Link 
                to="/auctions" 
                className={`nav-link ${isActivePage('/auctions') ? 'active' : ''}`}
              >
                Auctions
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
            {/* Global Search - compact to fit in header */}
            <div style={{ minWidth: '200px', maxWidth: '300px', flex: '1 1 auto' }}>
              <VehicleSearch />
            </div>

            {/* Upload Indicator - Windows 95 style */}
            <GlobalUploadIndicator />

            {/* Profile Balance Capsule - Combined balance + profile + navigation */}
            {session ? (
              <ProfileBalancePill session={session} userProfile={userProfile} />
            ) : (
              <Link to="/login" className="button button-primary" style={{ border: '2px solid #0ea5e9', transition: 'all 0.12s ease' }}>
                Login
              </Link>
            )}
          </div>
        </div>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'center', fontSize: '8pt' }}>
          <span>NUKE © 2025</span>
          <a href="/privacy" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy Policy</a>
          <a href="/terms" style={{ color: 'inherit', textDecoration: 'underline' }}>Terms of Service</a>
          <a href="/data-deletion" style={{ color: 'inherit', textDecoration: 'underline' }}>Data Deletion</a>
        </div>
      </footer>
    </div>
  );
};

export default AppLayout;
