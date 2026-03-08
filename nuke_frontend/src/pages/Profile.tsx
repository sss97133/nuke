import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
// AppLayout now provided globally by App.tsx
import EditableField from '../components/editable/EditableField';
import { ProfileService } from '../services/profileService';
import { ProfileActivityService } from '../services/profileActivityService';
import type { ProfileData, ProfileEditForm } from '../types/profile';
import { AdminNotificationService } from '../services/adminNotificationService';
import { PersonalPhotoLibraryService } from '../services/personalPhotoLibraryService';
import { getUserProfileData } from '../services/profileStatsService';

// Overview tab — loaded immediately
import ContributionTimeline from '../components/profile/ContributionTimeline';
import KnowledgeLibrary from '../components/profile/KnowledgeLibrary';
import LivePlayer from '../components/profile/LivePlayer';
import MemelordPanel from '../components/profile/MemelordPanel';
import { ComprehensiveProfileStats } from '../components/profile/ComprehensiveProfileStats';

// Tab-specific — loaded on demand
const ProfessionalToolbox = React.lazy(() => import('../components/profile/ProfessionalToolbox'));
const VehicleCollection = React.lazy(() => import('../components/profile/VehicleCollection'));
const PublicImageGallery = React.lazy(() => import('../components/profile/PublicImageGallery'));
const ActivityTimeline = React.lazy(() => import('../components/profile/ActivityTimeline'));
const ProfileVerification = React.lazy(() => import('../components/ProfileVerification').then(m => ({ default: m.ProfileVerification })));
const ChangePasswordForm = React.lazy(() => import('../components/auth/ChangePasswordForm'));
const DatabaseDiagnostic = React.lazy(() => import('../components/debug/DatabaseDiagnostic'));
const OrganizationAffiliations = React.lazy(() => import('../components/profile/OrganizationAffiliations'));
const MyOrganizations = React.lazy(() => import('./MyOrganizations'));
const MyAuctions = React.lazy(() => import('./MyAuctions'));
const PublicAuctionTrackRecord = React.lazy(() => import('../components/profile/PublicAuctionTrackRecord'));
const VehicleMergeInterface = React.lazy(() => import('../components/vehicle/VehicleMergeInterface'));
const PersonalPhotoLibrary = React.lazy(() => import('./PersonalPhotoLibrary').then(m => ({ default: m.PersonalPhotoLibrary })));
const ShopFinancials = React.lazy(() => import('./ShopFinancials'));
const TechInbox = React.lazy(() => import('../components/profile/TechInbox'));
const ProfileListingsTab = React.lazy(() => import('../components/profile/ProfileListingsTab').then(m => ({ default: m.ProfileListingsTab })));
const ProfileBidsTab = React.lazy(() => import('../components/profile/ProfileBidsTab').then(m => ({ default: m.ProfileBidsTab })));
const ProfileCommentsTab = React.lazy(() => import('../components/profile/ProfileCommentsTab').then(m => ({ default: m.ProfileCommentsTab })));
const ProfileSuccessStoriesTab = React.lazy(() => import('../components/profile/ProfileSuccessStoriesTab').then(m => ({ default: m.ProfileSuccessStoriesTab })));
const ConnectedPlatforms = React.lazy(() => import('../components/bidding/ConnectedPlatforms'));
const SocialConnections = React.lazy(() => import('../components/profile/SocialConnections'));
const UserDiscoveries = React.lazy(() => import('../components/profile/UserDiscoveries'));

const Profile: React.FC = () => {
  const { userId, externalIdentityId } = useParams<{ userId?: string; externalIdentityId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'overview' |
    'discoveries' |
    'collection' |
    'gallery' |
    'professional' |
    'organizations' |
    'auctions' |
    'listings' |
    'bids' |
    'comments' |
    'stories' |
    'photos' |
    'financials' |
    'duplicates' |
    'inbox' |
    'settings'
  >('overview');
  const [comprehensiveData, setComprehensiveData] = useState<any>(null);
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [photoLibraryStats, setPhotoLibraryStats] = useState<any>(null);

  // Handle window resize for responsive behavior
  useEffect(() => {
    const handleResize = () => {
      setIsLargeScreen(window.innerWidth >= 1024);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { user, loading: authLoading } = useAuth();
  
  // Set current user ID when auth state changes
  useEffect(() => {
    if (user) {
      setCurrentUserId(user.id);
    }
  }, [user]);

  // Load profile data - OPTIMIZED with fast RPC
  const loadProfileData = async () => {
    const startTime = performance.now();
    try {
      setLoading(true);
      setError(null);

      // Handle external identity profiles (unclaimed BaT users)
      if (externalIdentityId) {
        const { getPublicProfileByExternalIdentity } = await import('../services/profileStatsService');
        const externalData = await getPublicProfileByExternalIdentity(externalIdentityId);
        if (externalData) {
          setComprehensiveData(externalData);
          // Create synthetic profile data for display
          setProfileData({
            profile: externalData.profile,
            stats: externalData.stats,
            recentContributions: [],
            recentActivity: [],
            dailySummaries: []
          } as any);
          setLoading(false);
          return;
        } else {
          setError('External identity not found');
          setLoading(false);
          return;
        }
      }

      // Resolve userId — could be a UUID or a username slug
      let targetUserId = userId || currentUserId;

      if (targetUserId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
        // Not a UUID — treat as username, resolve to UUID
        const { data: profileLookup, error: lookupError } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', targetUserId)
          .single();

        if (lookupError || !profileLookup) {
          setError(`Profile "${targetUserId}" not found`);
          setLoading(false);
          return;
        }
        targetUserId = profileLookup.id;
      }

      if (!targetUserId) {
        setError('No user ID provided');
        setLoading(false);
        return;
      }

      console.log('[Profile] Starting fast load...');

      // Try fast RPC first
      const { data: fastData, error: rpcError } = await supabase
        .rpc('get_user_profile_fast', { p_user_id: targetUserId });

      if (!rpcError && fastData) {
        console.log('[Profile] Fast RPC succeeded in', (performance.now() - startTime).toFixed(0), 'ms');
        
        // Load contributions separately (lazy)
        const contributionsPromise = ProfileService.getProfileData(targetUserId);
        
        // Use fast data immediately
        setProfileData({
          profile: fastData.profile,
          stats: fastData.stats,
          recentContributions: [], // Will be loaded lazily
          recentActivity: [],
          dailySummaries: []
        } as any);
        
        // Load full contributions in background
        contributionsPromise.then(fullData => {
          if (fullData) {
            setProfileData(fullData);
            console.log('[Profile] Full data loaded in', (performance.now() - startTime).toFixed(0), 'ms');
          }
        });
        
      } else {
        // Fallback to full load
        console.log('[Profile] Using fallback load method');
        const data = userId && userId !== currentUserId
          ? await ProfileService.getPublicProfile(userId)
          : await ProfileService.getProfileData(targetUserId);
        
        setProfileData(data);
      }

      // Load photo library stats if this is own profile
      if (targetUserId === currentUserId) {
        try {
          const stats = await PersonalPhotoLibraryService.getLibraryStats();
          setPhotoLibraryStats(stats);
        } catch (err) {
          console.warn('Failed to load photo library stats:', err);
        }
      }

      // Load comprehensive profile data (BaT-style stats)
      try {
        const comprehensive = await getUserProfileData(targetUserId);
        setComprehensiveData(comprehensive);
      } catch (err) {
        console.warn('Failed to load comprehensive profile data:', err);
      }

    } catch (err: any) {
      console.error('Error loading profile:', err);
      setError(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUserId || userId || externalIdentityId) {
      loadProfileData();
    } else if (!authLoading && !userId && !externalIdentityId) {
      // Auth resolved with no user and no URL-provided ID — redirect to login
      navigate(`/login?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }, [currentUserId, userId, externalIdentityId, authLoading]);

  // Handle URL query parameters for tab navigation
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    const validTabs = ['overview', 'collection', 'gallery', 'professional', 'organizations', 'auctions', 'listings', 'bids', 'comments', 'stories', 'photos', 'financials', 'duplicates', 'inbox', 'settings'];
    if (tabParam && validTabs.includes(tabParam)) {
      setActiveTab(tabParam as any);
    }
  }, [location.search]);

  // Check admin status
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (currentUserId) {
        const admin = await AdminNotificationService.isCurrentUserAdmin();
        setIsAdmin(admin);
      }
    };
    checkAdminStatus();
  }, [currentUserId]);

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
      <div className="container">
        <div className="main">
          <div className="card">
            <div className="card-body text-center">
              <h2 className="text font-bold" style={{ fontSize: '11px' }}>Loading...</h2>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="main">
          <div className="card">
            <div className="card-body text-center">
              <h2 className="text font-bold" style={{ fontSize: '11px' }}>Error</h2>
              <p className="text-small text-muted">{error}</p>
              <button className="button button-primary" onClick={() => loadProfileData()}>
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profileData || !profileData.profile) {
    return (
      <div className="container">
        <div className="main">
          <div className="card">
            <div className="card-body text-center">
              <h2 className="text font-bold" style={{ fontSize: '11px' }}>Profile Not Found</h2>
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
    );
  }

  const { profile, completion, achievements, recentActivity, stats } = profileData;
  const dailySummaries = profileData.dailyContributionSummaries || [];
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
    <div className="container">
        <div className="main">
          {/* Minimal Profile Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
            background: 'var(--surface)',
            borderRadius: '4px',
            border: '1px solid var(--border)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 1 }}>
              {/* Avatar - Circular - Larger */}
              <div style={{
                width: '64px',
                height: '64px',
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
                  border: '2px solid var(--border)',
                  cursor: isOwnProfile ? 'pointer' : 'default',
                  background: 'var(--surface)',
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
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      objectFit: 'cover',
                      objectPosition: 'center'
                    }}
                  />
                ) : (
                  <div style={{ 
                    width: '100%', 
                    height: '100%', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    background: 'var(--surface-hover)',
                    fontSize: '11px',
                    fontWeight: 'bold'
                  }}>
                    {(profile.full_name || profile.username || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            </div>
            
              {/* Username + Meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <h2 className="text font-bold" style={{ margin: 0, fontSize: '11px' }}>
                    @{profile.username || 'username'}
                  </h2>
                  {profile.is_verified && (
                    <span style={{
                      fontSize: '9px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      background: 'var(--success, #28a745)',
                      color: '#fff',
                      borderRadius: '3px',
                      lineHeight: '1.4'
                    }}>Verified</span>
                  )}
                  {profile.user_type && profile.user_type !== 'user' && (
                    <span style={{
                      fontSize: '9px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      background: 'var(--text-muted)',
                      color: 'var(--surface)',
                      borderRadius: '3px',
                      lineHeight: '1.4',
                      textTransform: 'capitalize'
                    }}>{profile.user_type}</span>
                  )}
                </div>

                {/* Meta line: location + member since */}
                {(profile.location || profile.created_at) && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    marginTop: '2px',
                    fontSize: '7.5pt',
                    color: 'var(--text-muted)'
                  }}>
                    {profile.location && (
                      <span>{profile.location}</span>
                    )}
                    {profile.created_at && (
                      <span>Member since {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
                    )}
                  </div>
                )}

                {/* Bio */}
                {profile.bio && (
                  <p style={{
                    margin: '4px 0 0',
                    fontSize: '7.5pt',
                    color: 'var(--text-muted)',
                    lineHeight: '1.4',
                    maxWidth: '480px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical'
                  }}>{profile.bio}</p>
                )}

                {/* Links row */}
                {(profile.website_url || profile.github_url || profile.linkedin_url) && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    marginTop: '4px',
                    fontSize: '7.5pt'
                  }}>
                    {profile.website_url && (
                      <a href={profile.website_url} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--link, var(--text))', textDecoration: 'underline' }}>
                        Website
                      </a>
                    )}
                    {profile.github_url && (
                      <a href={profile.github_url} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--link, var(--text))', textDecoration: 'underline' }}>
                        GitHub
                      </a>
                    )}
                    {profile.linkedin_url && (
                      <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--link, var(--text))', textDecoration: 'underline' }}>
                        LinkedIn
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {currentUserId && (
                <button
                  className="button button-small"
                  onClick={() => navigate('/claim-identity')}
                  title="Claim external activity sources (handles) and merge them into your activity repo"
                >
                  CLAIM
                </button>
              )}
              {isOwnProfile && (
                <button
                  className="button button-small"
                  onClick={() => setShowProfileDetails(!showProfileDetails)}
                >
                  {showProfileDetails ? 'Hide' : 'Edit'} Profile
                </button>
              )}
              {isAdmin && (
                <button
                  className="button button-small"
                  onClick={() => navigate('/admin')}
                  style={{
                    background: 'var(--black)',
                    color: 'var(--white)',
                    border: '2px solid var(--black)',
                    fontWeight: 700
                  }}
                >
                  ADMIN
                </button>
              )}
            </div>
          </div>

          {/* Expandable Profile Details */}
          {showProfileDetails && isOwnProfile && (
            <div className="card" style={{ 
              marginBottom: 'var(--space-4)',
              border: '2px solid var(--border)',
              background: 'var(--surface)'
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

                <EditableField
                  label="Website URL"
                  name="website_url"
                  type="text"
                  value={profile.website_url || ''}
                  placeholder="https://yoursite.com"
                  onSave={(v) => saveProfileField('website_url', v)}
                />

                <EditableField
                  label="GitHub URL"
                  name="github_url"
                  type="text"
                  value={profile.github_url || ''}
                  placeholder="https://github.com/username"
                  onSave={(v) => saveProfileField('github_url', v)}
                />

                <EditableField
                  label="LinkedIn URL"
                  name="linkedin_url"
                  type="text"
                  value={profile.linkedin_url || ''}
                  placeholder="https://linkedin.com/in/username"
                  onSave={(v) => saveProfileField('linkedin_url', v)}
                />

                <EditableField
                  label="Public profile"
                  name="is_public"
                  type="toggle"
                  value={profile.is_public ?? true}
                  onSave={(v) => saveProfileField('is_public', v)}
                />

                {/* Account type selector */}
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <label className="text-small font-bold" style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
                    Account Type
                  </label>
                  <select
                    className="form-input text-small"
                    value={profile.user_type || 'user'}
                    onChange={async (e) => {
                      try {
                        await saveProfileField('user_type', e.target.value);
                      } catch (err) {
                        console.error('Failed to update user_type:', err);
                      }
                    }}
                    style={{ padding: '4px 8px', fontSize: '11px' }}
                  >
                    <option value="user">User</option>
                    <option value="professional">Professional</option>
                    <option value="dealer">Dealer</option>
                  </select>
                </div>

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
          borderBottom: '2px solid var(--border)'
        }}>
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'discoveries', label: 'Discoveries', public: true },
            { key: 'collection', label: 'Collection', public: true },
            { key: 'gallery', label: 'Gallery', public: true },
            { key: 'photos', label: 'Photos' },
            { key: 'professional', label: 'Professional' },
            { key: 'organizations', label: 'My Organizations' },
            { key: 'auctions', label: 'My Auctions' },
            { key: 'listings', label: 'Listings', public: true },
            { key: 'bids', label: 'Bids', public: true },
            { key: 'comments', label: 'Comments', public: true },
            { key: 'stories', label: 'Success Stories', public: true },
            { key: 'inbox', label: 'Tech Inbox' },
            { key: 'settings', label: 'Settings' }
          ].filter(tab => tab.key === 'settings' ? isOwnProfile : (tab.public || isOwnProfile || tab.key === 'overview' || tab.key === 'professional' || tab.key === 'organizations' || tab.key === 'auctions' || tab.key === 'listings' || tab.key === 'bids' || tab.key === 'comments' || tab.key === 'stories')).map((tab) => (
            <button
              key={tab.key}
              className="text-small"
              style={{
                padding: 'var(--space-2) var(--space-4)',
                background: activeTab === tab.key ? 'var(--surface)' : 'var(--surface-hover)',
                border: activeTab === tab.key 
                  ? '2px solid var(--border)' 
                  : '1px solid var(--border)',
                borderBottom: activeTab === tab.key ? 'none' : '2px solid var(--border)',
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
        <Suspense fallback={null}>
        <div className="profile-content">
            {activeTab === 'overview' && (
              <div className="section">
                {/* First-run onboarding checklist (own profile, not complete) */}
                {isOwnProfile && !isProfileComplete && (
                  <div style={{
                    marginBottom: 'var(--space-4)',
                    border: '2px solid var(--border-light)',
                    backgroundColor: 'var(--white)',
                    padding: 'var(--space-4)',
                    borderRadius: '0px',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-3)' }}>
                      Get started
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      {!profileData.completion?.avatar_uploaded && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '11px' }}>
                          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>[ ]</span>
                          <button
                            style={{ all: 'unset', cursor: 'pointer', color: 'var(--text)', textDecoration: 'underline' }}
                            onClick={() => setShowProfileDetails(true)}
                          >
                            Upload a profile photo
                          </button>
                        </div>
                      )}
                      {!profileData.completion?.bio_added && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '11px' }}>
                          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>[ ]</span>
                          <button
                            style={{ all: 'unset', cursor: 'pointer', color: 'var(--text)', textDecoration: 'underline' }}
                            onClick={() => setShowProfileDetails(true)}
                          >
                            Add a bio
                          </button>
                        </div>
                      )}
                      {!profileData.completion?.first_vehicle_added && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '11px' }}>
                          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>[ ]</span>
                          <button
                            style={{ all: 'unset', cursor: 'pointer', color: 'var(--text)', textDecoration: 'underline' }}
                            onClick={() => navigate('/vehicle/add')}
                          >
                            Add your first vehicle
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Comprehensive Profile Stats (BaT-style) */}
                {comprehensiveData?.stats && (
                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <ComprehensiveProfileStats
                      stats={comprehensiveData.stats}
                      profileType="user"
                      profileId={profile.id}
                      location={profile.location}
                    />
                  </div>
                )}

                {/* Contribution Timeline - Forefront */}
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <ContributionTimeline
                    key={`contributions-${(profileData.recentContributions || []).length}`}
                    contributions={profileData.recentContributions || []}
                    userId={profile.id}
                  />
                </div>

                {/* Live Player/Streaming */}
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <LivePlayer userId={profile.id} isOwnProfile={isOwnProfile} />
                </div>

                {/* Memelord history (own profile only) */}
                {isOwnProfile && (
                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <MemelordPanel userId={profile.id} />
                  </div>
                )}

              </div>
            )}

            {activeTab === 'discoveries' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <UserDiscoveries userId={profile.id} isOwnProfile={isOwnProfile} />
              </div>
            )}

            {activeTab === 'collection' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <VehicleCollection userId={profile.id} isOwnProfile={isOwnProfile} />
              </div>
            )}

            {activeTab === 'gallery' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <PublicImageGallery userId={profile.id} isOwnProfile={isOwnProfile} />
              </div>
            )}
            
            {/* Removed achievements and stats tabs */}
            
            {activeTab === 'professional' && (
              <ProfessionalToolbox userId={userId || currentUserId || ''} isOwnProfile={isOwnProfile} />
            )}
            
            {activeTab === 'organizations' && (
              <div>
                {isOwnProfile ? (
                  <MyOrganizations />
                ) : (
                  <OrganizationAffiliations userId={profile.id} isOwnProfile={isOwnProfile} />
                )}
              </div>
            )}

            {activeTab === 'auctions' && (
              <div>
                {isOwnProfile ? (
                  <MyAuctions />
                ) : (
                  <PublicAuctionTrackRecord
                    listings={comprehensiveData?.listings || []}
                    loading={!comprehensiveData}
                    profileName={profile.full_name || profile.username || null}
                  />
                )}
              </div>
            )}

            {activeTab === 'listings' && comprehensiveData && (
              <div>
                <ProfileListingsTab
                  listings={comprehensiveData.listings || []}
                  profileType="user"
                />
              </div>
            )}

            {activeTab === 'bids' && comprehensiveData && (
              <div>
                <ProfileBidsTab
                  bids={comprehensiveData.bids || []}
                  profileType="user"
                />
              </div>
            )}

            {activeTab === 'comments' && comprehensiveData && (
              <div>
                <ProfileCommentsTab
                  comments={comprehensiveData.comments || []}
                  profileType="user"
                />
              </div>
            )}

            {activeTab === 'stories' && comprehensiveData && (
              <div>
                <ProfileSuccessStoriesTab
                  stories={comprehensiveData.success_stories || []}
                  profileType="user"
                />
              </div>
            )}

            {activeTab === 'overview' && isOwnProfile && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <KnowledgeLibrary userId={profile.id} isOwnProfile={isOwnProfile} />
              </div>
            )}
            
            {activeTab === 'photos' && isOwnProfile && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <PersonalPhotoLibrary />
              </div>
            )}

            {activeTab === 'financials' && isOwnProfile && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <ShopFinancials />
              </div>
            )}
            
            {activeTab === 'duplicates' && isOwnProfile && (
              <div>
                <div className="card" style={{ marginBottom: '16px' }}>
                  <div className="card-header" style={{ fontSize: '11px', fontWeight: 700 }}>
                    Duplicate Vehicle Detection
                  </div>
                  <div className="card-body" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    When potential duplicate vehicles are detected in your profile, they'll appear below for review.
                    You can merge duplicates to consolidate all images, events, and data into a single vehicle profile.
                  </div>
                </div>
                <VehicleMergeInterface userId={profile.id} />
              </div>
            )}

            {activeTab === 'inbox' && isOwnProfile && (
              <div>
                <TechInbox />
              </div>
            )}

            {activeTab === 'settings' && isOwnProfile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

                {/* ── ACCOUNT ── */}
                <h3 style={{ fontSize: '12px', fontWeight: 700, marginBottom: 0, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Account</h3>

                {/* Email Management */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold" style={{ fontSize: '11px' }}>Email Settings</h3>
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

                {/* Password Change */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold" style={{ fontSize: '11px' }}>Change Password</h3>
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

                {/* ── CONNECTIONS ── */}
                <h3 style={{ fontSize: '12px', fontWeight: 700, marginBottom: 0, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Connections</h3>

                <ConnectedPlatforms />
                <SocialConnections userId={profile.id} />

                {/* ── VERIFICATION ── */}
                <h3 style={{ fontSize: '12px', fontWeight: 700, marginBottom: 0, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Verification</h3>

                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold" style={{ fontSize: '11px' }}>Identity Verification</h3>
                  </div>
                  <div className="card-body">
                    <ProfileVerification />
                  </div>
                </div>

                {/* ── ACTIVITY ── */}
                <h3 style={{ fontSize: '12px', fontWeight: 700, marginBottom: 0, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Activity</h3>

                <div className="card">
                  <div className="card-header">
                    <h3 className="text font-bold" style={{ fontSize: '11px' }}>History</h3>
                  </div>
                  <div className="card-body">
                    <ActivityTimeline scope="user" id={profile.id} limit={200} />
                  </div>
                </div>

                {/* ── ADVANCED ── */}
                <h3 style={{ fontSize: '12px', fontWeight: 700, marginBottom: 0, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Advanced</h3>

                <DatabaseDiagnostic />
              </div>
            )}
        </div>
        </Suspense>
      </div>
    </div>
  );
};

export default Profile;
