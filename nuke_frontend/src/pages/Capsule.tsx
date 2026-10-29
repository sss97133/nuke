import { ProfileService } from '../services/profileService';
import React, { useState, useEffect } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { readCachedSession } from '../utils/cachedSession';
import { PersonalPhotoLibrary } from './PersonalPhotoLibrary';
import PrefetchLink from '../components/PrefetchLink';
import './Capsule.css';
import OrganizationAffiliations from '../components/profile/OrganizationAffiliations';
import ProfessionalToolbox from '../components/profile/ProfessionalToolbox';
import { ProfileVerification } from '../components/ProfileVerification';
import ChangePasswordForm from '../components/auth/ChangePasswordForm';
import StripeKeysManager from '../components/settings/StripeKeysManager';
import AIProviderSettings from '../components/settings/AIProviderSettings';
import APIAccessSubscription from '../components/settings/APIAccessSubscription';
import KnowledgeLibrary from '../components/profile/KnowledgeLibrary';
import StreamingDashboard from '../components/profile/StreamingDashboard';
import AppearanceSpecimen from '../components/settings/AppearanceSpecimen';
import FacebookConnectionSettings from '../components/facebook/FacebookConnectionSettings';

type CapsuleTab =
  | 'dashboard'
  | 'api-access'
  | 'settings'
  | 'appearance'
  | 'financials'
  | 'organizations'
  | 'knowledge'
  | 'streaming'
  | 'professional'
  | 'photos';

const capsuleTabs: CapsuleTab[] = ['dashboard', 'api-access', 'settings', 'appearance', 'financials', 'organizations', 'knowledge', 'streaming', 'professional', 'photos'];

const Capsule: React.FC = () => {
  const [session, setSession] = useState<any>(() => readCachedSession());
  const [, setUserProfile] = useState<any>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as CapsuleTab | null;
  const activeTab: CapsuleTab = tabParam && capsuleTabs.includes(tabParam) ? tabParam : 'dashboard';
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Update URL when tab changes
  const handleTabChange = (tab: CapsuleTab) => {
    if (tab === 'financials') { navigate('/accounting'); return; }
    setSearchParams({ tab });
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/login');
        return;
      }
      setSession(session);
      
      // Load user profile
      const { data: profile } = await ProfileService.getProfileRecord(session.user.id);
      
      setUserProfile(profile);
    } catch (error) {
      console.error('Error checking auth:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="capsule-workspace"><p role="status">Loading your workspace…</p></div>;

  if (!session) {
    return null; // Will redirect
  }

  // Keep saved links to the old financials tab useful. Its event-summary reader
  // is retired; the owner-scoped accounting office owns books and evidence.
  if (activeTab === 'financials') return <Navigate to="/accounting" replace />;

  const tabs: Array<{ key: CapsuleTab; label: string }> = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'api-access', label: 'API Access' },
    { key: 'settings', label: 'Settings' },
    { key: 'appearance', label: 'Appearance' },
    { key: 'financials', label: 'Accounting' },
    { key: 'organizations', label: 'Organizations' },
    { key: 'knowledge', label: 'Knowledge Library' },
    { key: 'streaming', label: 'Streaming' },
    { key: 'professional', label: 'Professional' },
    { key: 'photos', label: 'Photos' }
  ];

  return (
      <div className="capsule-workspace">
        {/* Sidebar Navigation - Hidden on Photos tab */}
        {activeTab !== 'photos' && (
          <div className="capsule-sidebar">
            <nav aria-label="Your workspace">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleTabChange(tab.key)}
                  aria-current={activeTab === tab.key ? 'page' : undefined}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Main Content */}
        <div className="capsule-content">
          {activeTab === 'dashboard' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="card">
                <div className="card-header">
                  <h1>Your workspace</h1>
                </div>
                <div className="card-body">
                  <p>Open your books, contribute evidence, or pick up the work that needs you.</p>
                  <div className="capsule-destinations">
                    <PrefetchLink to="/accounting"><strong>Accounting</strong><span>Books, receipts, review questions and shared access.</span><span aria-hidden="true">›</span></PrefetchLink>
                    <PrefetchLink to="/work"><strong>Work</strong><span>Jobs, work days and confirmations awaiting your review.</span><span aria-hidden="true">›</span></PrefetchLink>
                    <PrefetchLink to="/photo-library"><strong>Your photo library</strong><span>Organize your captures and the evidence they carry.</span><span aria-hidden="true">›</span></PrefetchLink>
                    <PrefetchLink to="/settings"><strong>Settings</strong><span>Your account, connected agents and business preferences.</span><span aria-hidden="true">›</span></PrefetchLink>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'api-access' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <APIAccessSubscription />
              <AIProviderSettings />
            </div>
          )}

          {activeTab === 'settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="card">
                <div className="card-header">
                  <h3 className="heading-3">Appearance</h3>
                </div>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div className="text text-small text-muted" style={{ maxWidth: 520 }}>
                    Theme (Auto/Dark/Light), contrast profiles, and automotive colorways — previewed live.
                  </div>
                  <button
                    className="button button-secondary"
                    style={{ fontSize: '12px', whiteSpace: 'nowrap' }}
                    onClick={() => handleTabChange('appearance')}
                  >
                    Open Appearance →
                  </button>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h3 className="heading-3">Profile Settings</h3>
                </div>
                <div className="card-body">
                  <ProfileVerification />
                </div>
              </div>
              
              <div className="card">
                <div className="card-header">
                  <h3 className="heading-3">Change Password</h3>
                </div>
                <div className="card-body">
                  <ChangePasswordForm />
                </div>
              </div>

              {/* Connected Accounts */}
              <div className="card">
                <div className="card-header">
                  <h3 className="heading-3">Connected Accounts</h3>
                </div>
                <div className="card-body">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <FacebookConnectionSettings userId={session.user.id} />
                  </div>
                </div>
              </div>

              <StripeKeysManager />
            </div>
          )}

          {activeTab === 'appearance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <AppearanceSpecimen />
            </div>
          )}

          {activeTab === 'organizations' && (
            <div>
              <OrganizationAffiliations userId={session.user.id} isOwnProfile={true} />
            </div>
          )}

          {activeTab === 'knowledge' && (
            <div>
              <KnowledgeLibrary userId={session.user.id} isOwnProfile={true} />
            </div>
          )}

          {activeTab === 'streaming' && (
            <div>
              <StreamingDashboard userId={session.user.id} isOwnProfile={true} />
            </div>
          )}

          {activeTab === 'professional' && (
            <div>
              <ProfessionalToolbox userId={session.user.id} isOwnProfile={true} />
            </div>
          )}

          {activeTab === 'photos' && (
            <div>
              <PersonalPhotoLibrary />
            </div>
          )}
        </div>
      </div>
  );
};

export default Capsule;

