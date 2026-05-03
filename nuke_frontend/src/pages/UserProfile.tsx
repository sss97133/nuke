/**
 * UserProfile.tsx — Thin orchestrator page.
 *
 * Wraps all user profile components in the shared context provider.
 * Same pattern as VehicleProfile.tsx.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { UserProfileProvider, useUserProfile } from './user-profile/UserProfileContext';
import '../styles/user-profile.css';

const UserHeader = React.lazy(() => import('./user-profile/UserHeader'));
const UserSubHeader = React.lazy(() => import('./user-profile/UserSubHeader'));
const UserBarcodeTimeline = React.lazy(() => import('./user-profile/UserBarcodeTimeline'));
const UserWorkspaceContent = React.lazy(() => import('./user-profile/UserWorkspaceContent'));
const UserSettingsDrawer = React.lazy(() => import('./user-profile/UserSettingsDrawer'));

const UserProfileInner: React.FC = () => {
  const { loading, profile } = useUserProfile();

  if (loading) {
    return <div style={{ height: '100vh', background: 'var(--bg)' }} />;
  }

  if (!profile) {
    return (
      <div className="card" style={{ margin: '40px auto', maxWidth: 400, padding: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Profile Not Found</h2>
        <p style={{ fontSize: 10, color: '#888', marginBottom: 16 }}>
          The requested user profile could not be found.
        </p>
        <Link to="/" style={{ fontSize: 10 }}>Return Home</Link>
      </div>
    );
  }

  return (
    <div className="user-profile-page">
      {/* User Header — sticky */}
      <React.Suspense fallback={null}>
        <UserHeader />
      </React.Suspense>

      {/* Sub-Header — badge bar */}
      <React.Suspense fallback={null}>
        <UserSubHeader />
      </React.Suspense>

      {/* Barcode Timeline — sticky */}
      <React.Suspense fallback={null}>
        <UserBarcodeTimeline />
      </React.Suspense>

      {/* Two-Column Workspace (includes Briefing in left column) */}
      <React.Suspense fallback={null}>
        <UserWorkspaceContent />
      </React.Suspense>

      {/* Settings Drawer — opens via up:open-settings event */}
      <React.Suspense fallback={null}>
        <UserSettingsDrawer />
      </React.Suspense>
    </div>
  );
};

const UserProfile: React.FC = () => (
  <UserProfileProvider>
    <UserProfileInner />
  </UserProfileProvider>
);

export default UserProfile;
