import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AppLayout from '../components/layout/AppLayout';
import { PersonalPhotoLibrary } from './PersonalPhotoLibrary';
import ShopFinancials from './ShopFinancials';
import OrganizationAffiliations from '../components/profile/OrganizationAffiliations';
import ProfessionalToolbox from '../components/profile/ProfessionalToolbox';
import VehicleMergeInterface from '../components/vehicle/VehicleMergeInterface';
import { ProfileVerification } from '../components/ProfileVerification';
import ChangePasswordForm from '../components/auth/ChangePasswordForm';
import CashBalance from '../components/trading/CashBalance';
import StripeKeysManager from '../components/settings/StripeKeysManager';
import AIProviderSettings from '../components/settings/AIProviderSettings';
import APIAccessSubscription from '../components/settings/APIAccessSubscription';
import KnowledgeLibrary from '../components/profile/KnowledgeLibrary';
import StreamingDashboard from '../components/profile/StreamingDashboard';

type CapsuleTab = 'dashboard' | 'api-access' | 'settings' | 'financials' | 'organizations' | 'knowledge' | 'streaming' | 'professional' | 'photos';

const Capsule: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<CapsuleTab>('dashboard');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

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
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      
      setUserProfile(profile);
    } catch (error) {
      console.error('Error checking auth:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <div className="text text-muted">Loading...</div>
        </div>
      </AppLayout>
    );
  }

  if (!session) {
    return null; // Will redirect
  }

  const tabs: Array<{ key: CapsuleTab; label: string }> = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'api-access', label: 'API Access' },
    { key: 'settings', label: 'Settings' },
    { key: 'financials', label: 'Financials' },
    { key: 'organizations', label: 'Organizations' },
    { key: 'knowledge', label: 'Knowledge Library' },
    { key: 'streaming', label: 'Streaming' },
    { key: 'professional', label: 'Professional' },
    { key: 'photos', label: 'Photos' }
  ];

  return (
    <AppLayout>
      <div style={{ display: 'flex', gap: 'var(--space-4)', minHeight: '600px' }}>
        {/* Sidebar Navigation */}
        <div style={{
          width: '200px',
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          paddingRight: 'var(--space-4)'
        }}>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: 'var(--space-2) var(--space-3)',
                  textAlign: 'left',
                  background: activeTab === tab.key ? 'var(--grey-200)' : 'transparent',
                  border: activeTab === tab.key ? '2px outset var(--border-medium)' : '1px solid transparent',
                  cursor: 'pointer',
                  fontSize: '9pt',
                  fontWeight: activeTab === tab.key ? 'bold' : 'normal'
                }}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <div style={{ flex: 1 }}>
          {activeTab === 'dashboard' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="card">
                <div className="card-header">
                  <h3 className="heading-3">Dashboard Overview</h3>
                </div>
                <div className="card-body">
                  <div>
                    <div className="text text-small text-muted" style={{ marginBottom: '8px', fontWeight: 600 }}>Cash Balance</div>
                    <CashBalance compact={false} showActions={true} />
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

              <StripeKeysManager />
            </div>
          )}

          {activeTab === 'financials' && (
            <div>
              <ShopFinancials />
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
    </AppLayout>
  );
};

export default Capsule;

