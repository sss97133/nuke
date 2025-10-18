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
