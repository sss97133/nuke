import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Simple auth hook to work with existing session-based auth
const useAuth = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
    };
    
    getUser();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    
    return () => subscription.unsubscribe();
  }, []);
  
  return { user, loading };
};
import AppLayout from '../components/layout/AppLayout';
import EditableField from '../components/editable/EditableField';
import { ProfileService } from '../services/profileService';
import { ProfileActivityService } from '../services/profileActivityService';
import type { ProfileData, ProfileEditForm } from '../types/profile';
import ProfileCompletion from '../components/profile/ProfileCompletion';
import ProfileAchievements from '../components/profile/ProfileAchievements';
import VehicleActivityTimeline from '../components/profile/VehicleActivityTimeline';
import ProfileStats from '../components/profile/ProfileStats';
import VerificationSummary from '../components/profile/VerificationSummary';
import ContributionTimeline from '../components/profile/ContributionTimeline';
import ProfessionalToolbox from '../components/profile/ProfessionalToolbox';
import { ProfileVerification } from '../components/ProfileVerification';
import ChangePasswordForm from '../components/auth/ChangePasswordForm';
import DatabaseDiagnostic from '../components/debug/DatabaseDiagnostic';
import LivePlayer from '../components/profile/LivePlayer';
import InventoryQuickPanel from '../components/profile/InventoryQuickPanel';
import ActivityOverview from '../components/profile/ActivityOverview';
import PinnedVehicles from '../components/profile/PinnedVehicles';
import WalletStatus from '../components/profile/WalletStatus';

const Profile: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'activity' | 'achievements' | 'stats' | 'professional' | 'settings'>('overview');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  // Heatmap year is a hook and must be declared unconditionally (not after early returns)
  const [heatmapYear, setHeatmapYear] = useState<number>(new Date().getFullYear());
  const [isLargeScreen, setIsLargeScreen] = useState(window.innerWidth >= 1024);
  const [emailData, setEmailData] = useState({
    newEmail: '',
    currentPassword: ''
  });
  const [emailUpdating, setEmailUpdating] = useState(false);
  const [emailChangeMessage, setEmailChangeMessage] = useState('');
  const [showProfileDetails, setShowProfileDetails] = useState(false);

  // Handle window resize for responsive behavior
  useEffect(() => {
    const handleResize = () => {
      setIsLargeScreen(window.innerWidth >= 1024);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { user } = useAuth();
  
  // Set current user ID when auth state changes
  useEffect(() => {
    if (user) {
      setCurrentUserId(user.id);
    }
  }, [user]);

  // Load profile data
  const loadProfileData = async () => {
    try {
      setLoading(true);
      setError(null);

      const targetUserId = userId || currentUserId;
      if (!targetUserId) {
        setError('No user ID provided');
        return;
      }

      let data: ProfileData | null;
      
      if (userId && userId !== currentUserId) {
        // Loading another user's public profile
        data = await ProfileService.getPublicProfile(userId);
      } else {
        // Loading own profile with full data
        data = await ProfileService.getProfileData(targetUserId);
        
        // Backfill activities for own profile if no activities exist
        if (data && data.recentActivity.length === 0) {
          console.log('No activities found, attempting to backfill...');
          const backfilledCount = await ProfileActivityService.backfillVehicleActivities(targetUserId);
          if (backfilledCount > 0) {
            console.log(`Backfilled ${backfilledCount} vehicle activities`);
            // Reload profile data to show new activities
            data = await ProfileService.getProfileData(targetUserId);
          }
        }
      }

      setProfileData(data);
    } catch (err: any) {
      console.error('Error loading profile:', err);
      setError(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUserId || userId) {
      loadProfileData();
    }
  }, [currentUserId, userId]);

  // Sync heatmap year to most recent contribution year when profile data loads
  useEffect(() => {
    const allContribs = profileData?.recentContributions || [];
    const years = Array.from(new Set(allContribs.map((c: any) => new Date(c.contribution_date).getFullYear()))).sort((a: number, b: number) => b - a);
    const latestYear = years[0] || new Date().getFullYear();
    if (latestYear !== heatmapYear) {
      setHeatmapYear(latestYear);
    }
  }, [profileData?.recentContributions]);

  // Initialize email data when profile loads
  useEffect(() => {
    if (profileData?.profile?.email) {
      setEmailData(prev => ({ ...prev, newEmail: profileData.profile.email || '' }));
    }
  }, [profileData?.profile?.email]);

  // Handle email update
  const handleEmailUpdate = async () => {
    if (!profileData?.profile?.email || emailData.newEmail === profileData.profile.email) {
      setEmailChangeMessage('Email is the same as current email');
      return;
    }

    if (!emailData.newEmail.includes('@')) {
      setEmailChangeMessage('Please enter a valid email address');
      return;
    }

    setEmailUpdating(true);
    setEmailChangeMessage('');
    
    try {
      const { error } = await supabase.auth.updateUser({
        email: emailData.newEmail
      });

      if (error) {
        setEmailChangeMessage(error.message);
      } else {
        setEmailChangeMessage('Verification email sent! Please check your new email address to confirm the change.');
        setEmailData(prev => ({ ...prev, currentPassword: '' }));
      }
    } catch (error: any) {
      setEmailChangeMessage('Failed to update email. Please try again.');
    } finally {
      setEmailUpdating(false);
    }
  };

  // Inline save helper for owner-only field updates
  const saveProfileField = async (field: keyof ProfileEditForm, value: any) => {
    try {
      if (!currentUserId) return;
      await ProfileService.updateProfile(currentUserId, { [field]: value } as any);
      await loadProfileData();
    } catch (err) {
      console.error('Inline profile save failed:', err);
      throw err;
    }
  };

  // Handle avatar upload
  const handleUploadAvatar = async (file: File): Promise<string> => {
    if (!currentUserId) throw new Error('Not authenticated');
    
    const avatarUrl = await ProfileService.uploadAvatar(currentUserId, file);
    await loadProfileData(); // Refresh profile data
    return avatarUrl;
  };

  // Handle sign out
  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      navigate('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  // Handle completion action clicks
  const handleCompletionAction = (action: string) => {
    switch (action) {
      case 'add_vehicle':
        navigate('/add-vehicle');
        break;
      default:
        console.log('Unknown action:', action);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="container">
          <div className="main">
            <div className="card">
              <div className="card-body text-center">
                <h2 className="text font-bold">Loading...</h2>
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="container">
          <div className="main">
            <div className="card">
              <div className="card-body text-center">
                <h2 className="text font-bold">Error</h2>
                <p className="text-small text-muted">{error}</p>
                <button className="button button-primary" onClick={() => loadProfileData()}>
                  Retry
                </button>
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!profileData || !profileData.profile) {
    return (
      <AppLayout>
        <div className="container">
          <div className="main">
            <div className="card">
              <div className="card-body text-center">
                <h2 className="text font-bold">Profile Not Found</h2>
                <p className="text-small text-muted" style={{ marginBottom: '16px' }}>
                  Unable to load profile data. You may need to sign out and try again.
                </p>
                <button className="button button-secondary" onClick={handleSignOut}>
                  Log Out
                </button>
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const { profile, completion, achievements, recentActivity, stats } = profileData;
  const isOwnProfile = currentUserId === profile.id;
  const allContribs = profileData.recentContributions || [];
  const years = Array.from(new Set(allContribs.map((c: any) => new Date(c.contribution_date).getFullYear()))).sort((a: number, b: number) => b - a);
  const defaultYear = years[0] || new Date().getFullYear();
  const filteredContribs = allContribs.filter((c: any) => new Date(c.contribution_date).getFullYear() === heatmapYear);
  const isProfileComplete = !!profileData?.completion && (
    profileData.completion.total_completion_percentage === 100 || (
      !!profileData.completion.basic_info_complete &&
      !!profileData.completion.avatar_uploaded &&
      !!profileData.completion.bio_added &&
      !!profileData.completion.location_added &&
      !!profileData.completion.social_links_added &&
      !!profileData.completion.first_vehicle_added
    )
  );

  return (
    <AppLayout>
      <div className="container">
        <div className="main">
          {/* Minimal Profile Header */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-4)'
          }}>
            {/* Avatar - Circular */}
            <div style={{
              width: '48px',
              height: '48px',
              flexShrink: 0
            }}>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    await handleUploadAvatar(file);
                  } catch (err) {
                    console.error('Avatar upload failed', err);
                  } finally {
                    if (avatarInputRef.current) avatarInputRef.current.value = '';
                  }
                }}
                style={{ display: 'none' }}
              />
              
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  border: '2px solid var(--border-medium)',
                  cursor: isOwnProfile ? 'pointer' : 'default',
                  background: 'var(--white)',
                  overflow: 'hidden'
                }}
                onClick={() => {
                  if (isOwnProfile && avatarInputRef.current) {
                    avatarInputRef.current.click();
                  }
                }}
              >
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={`${profile.full_name || 'User'}'s avatar`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ 
                    width: '100%', 
                    height: '100%', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    background: 'var(--grey-200)',
                    fontSize: '18px',
                    fontWeight: 'bold'
                  }}>
                    {(profile.full_name || profile.username || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            </div>
            
            {/* Username */}
            <div style={{ flex: 1 }}>
              <h2 className="text font-bold" style={{ margin: 0 }}>
                @{profile.username || 'username'}
              </h2>
            </div>

            {/* Expand button for profile details */}
            {isOwnProfile && (
              <button
                className="button button-small"
                onClick={() => setShowProfileDetails(!showProfileDetails)}
                style={{ marginLeft: 'auto' }}
              >
                {showProfileDetails ? 'Hide' : 'Edit'} Profile
              </button>
            )}
          </div>

          {/* Expandable Profile Details */}
          {showProfileDetails && isOwnProfile && (
            <div className="card" style={{ 
              marginBottom: 'var(--space-4)',
              border: '1px inset var(--border-medium)',
              background: 'var(--grey-50)'
            }}>
              <div className="card-body">
                <EditableField
                  label="Full name"
                  name="full_name"
                  value={profile.full_name || ''}
                  onValidate={(v) => (!v || String(v).trim().length === 0 ? 'Full name is required' : null)}
                  onSave={(v) => saveProfileField('full_name', v)}
                />
                
                <EditableField
                  label="Username"
                  name="username"
                  value={profile.username || ''}
                  onValidate={(v) => (v && String(v).length < 3 ? 'At least 3 characters' : null)}
                  onSave={(v) => saveProfileField('username', v)}
                />
                
                <EditableField
                  label="Bio"
                  name="bio"
                  type="textarea"
                  value={profile.bio || ''}
                  placeholder="Tell others about yourself, your interests, and your vehicles..."
                  onSave={(v) => saveProfileField('bio', v)}
                />
                
                <EditableField
                  label="Location"
                  name="location"
                  value={profile.location || ''}
                  placeholder="City, State/Country"
                  onSave={(v) => saveProfileField('location', v)}
                />
                
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <button
                    onClick={handleSignOut}
                    className="button button-secondary text-small"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            </div>
          )}

        {/* Tab Navigation */}
        <div style={{ 
          display: 'flex',
          gap: '0',
          marginBottom: 'var(--space-2)',
          borderBottom: '2px solid var(--border-dark)'
        }}>
          {[
            { 
              key: 'overview', 
              label: profileData?.recentContributions 
                ? `${profileData.recentContributions.reduce((sum, c) => sum + c.contribution_count, 0)} Contributions`
                : 'Overview' 
            },
            { key: 'activity', label: 'Activity' },
            { key: 'professional', label: 'Professional' },
            ...(isOwnProfile ? [{ key: 'settings', label: 'Settings' }] : [])
          ].map((tab) => (
            <button
              key={tab.key}
              className="text-small"
              style={{
                padding: 'var(--space-2) var(--space-4)',
                background: activeTab === tab.key ? 'var(--white)' : 'var(--grey-200)',
                border: activeTab === tab.key 
                  ? '2px outset var(--border-medium)' 
                  : '1px outset var(--border-light)',
                borderBottom: activeTab === tab.key ? 'none' : '2px solid var(--border-dark)',
                borderTopLeftRadius: '4px',
                borderTopRightRadius: '4px',
                marginBottom: activeTab === tab.key ? -2 : 0,
                color: 'var(--text)',
                fontWeight: activeTab === tab.key ? 'bold' : 'normal',
                cursor: 'pointer'
              }}
              onClick={() => setActiveTab(tab.key as any)}
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={`profile-tabpanel-${tab.key}`}
              id={`profile-tab-${tab.key}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main content area */}
        <div className="profile-content">
            {activeTab === 'overview' && (
              <div className="section">
                {/* Contribution Heatmap */}
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <ContributionTimeline
                    contributions={profileData.recentContributions || []}
                  />
                </div>
                
                {/* Live Player */}
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <LivePlayer userId={profile.id} isOwnProfile={isOwnProfile} />
                </div>
              </div>
            )}

            {activeTab === 'activity' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <VehicleActivityTimeline userId={profile.id} />
              </div>
            )}
            
            {/* Removed achievements and stats tabs */}
            
            {activeTab === 'professional' && (
              <ProfessionalToolbox userId={userId || currentUserId || ''} isOwnProfile={isOwnProfile} />
            )}
            
            {activeTab === 'settings' && isOwnProfile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {/* Verification Section */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold">Identity Verification</h3>
                  </div>
                  <div className="card-body">
                    <ProfileVerification />
                  </div>
                </div>
                
                {/* Password Change */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold">Change Password</h3>
                  </div>
                  <div className="card-body">
                    <div className="text-small text-muted" style={{ marginBottom: 'var(--space-3)' }}>
                      Update your account password for security.
                    </div>
                    <ChangePasswordForm 
                      onSuccess={() => { 
                        console.log('Password changed successfully'); 
                      }}
                      onError={(error) => { 
                        console.error('Password change error:', error); 
                      }}
                    />
                  </div>
                </div>
                
                {/* Email Management */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold">Email Settings</h3>
                  </div>
                  <div className="card-body">
                    <div className="text-small text-muted" style={{ marginBottom: 'var(--space-3)' }}>
                      Current email: {profile.email}
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--space-3)', alignItems: 'end', marginBottom: 'var(--space-2)' }}>
                      <div>
                        <label className="text-small font-bold" style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
                          New Email Address
                        </label>
                        <input
                          type="email"
                          className="form-input text-small"
                          value={emailData.newEmail}
                          onChange={(e) => setEmailData(prev => ({ ...prev, newEmail: e.target.value }))}
                          placeholder="your@email.com"
                        />
                      </div>
                      <button
                        type="button"
                        className="button button-secondary text-small"
                        onClick={handleEmailUpdate}
                        disabled={emailUpdating || emailData.newEmail === profile.email}
                      >
                        {emailUpdating ? 'Updating...' : 'Update Email'}
                      </button>
                    </div>
                    
                    {emailChangeMessage && (
                      <div className="text-small" style={{ 
                        color: emailChangeMessage.includes('sent') ? 'var(--success)' : 'var(--danger)', 
                        marginTop: 'var(--space-1)' 
                      }}>
                        {emailChangeMessage}
                      </div>
                    )}
                    
                    <div className="text-small" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
                      Changing your email will require verification.
                    </div>
                  </div>
                </div>
                
                {/* Database Diagnostic */}
                <DatabaseDiagnostic />
              </div>
            )}
        </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Profile;
