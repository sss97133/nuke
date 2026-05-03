import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useUserProfile } from './UserProfileContext';
import { supabase } from '../../lib/supabase';

const ChangePasswordForm = React.lazy(
  () => import('../../components/auth/ChangePasswordForm')
);
const ProfileVerification = React.lazy(
  () => import('../../components/ProfileVerification').then((m) => ({ default: m.ProfileVerification }))
);
const ConnectedPlatforms = React.lazy(
  () => import('../../components/bidding/ConnectedPlatforms')
);
const SocialConnections = React.lazy(
  () => import('../../components/profile/SocialConnections')
);
const DatabaseDiagnostic = React.lazy(
  () => import('../../components/debug/DatabaseDiagnostic')
);

const LOADING_FALLBACK = (
  <div style={{ padding: '8px 0', fontFamily: 'Arial, sans-serif', fontSize: '9px', color: '#888' }}>
    LOADING...
  </div>
);

interface UserSettingsDrawerProps {
  open?: boolean;
  onClose?: () => void;
}

const UserSettingsDrawer: React.FC<UserSettingsDrawerProps> = ({ open: openProp, onClose }) => {
  const { profile, userId, isAdmin, saveProfileField, uploadAvatar } = useUserProfile();

  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = openProp !== undefined ? openProp : internalOpen;

  // Local form state
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [emailMsg, setEmailMsg] = useState('');

  // Sync from profile
  useEffect(() => {
    if (profile) {
      setBio(profile.bio || '');
      setLocation(profile.location || '');
      setWebsite(profile.website || '');
    }
  }, [profile]);

  // Listen for custom open event
  useEffect(() => {
    const handler = () => setInternalOpen(true);
    window.addEventListener('up:open-settings', handler);
    return () => window.removeEventListener('up:open-settings', handler);
  }, []);

  const close = useCallback(() => {
    setInternalOpen(false);
    onClose?.();
  }, [onClose]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  const handleSave = async (field: string, value: string) => {
    setSaving(field);
    try {
      await saveProfileField(field, value);
    } finally {
      setSaving(null);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving('avatar');
    try {
      await uploadAvatar(file);
    } finally {
      setSaving(null);
    }
  };

  const handleEmailUpdate = async () => {
    if (!newEmail.trim()) return;
    setSaving('email');
    setEmailMsg('');
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (error) {
        setEmailMsg(error.message);
      } else {
        setEmailMsg('Confirmation sent to new email.');
        setNewEmail('');
      }
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <div
        className={`up-drawer-backdrop${isOpen ? ' up-drawer-backdrop--open' : ''}`}
        onClick={close}
      />
      <div className={`up-drawer${isOpen ? ' up-drawer--open' : ''}`}>
        <div className="up-drawer__header">
          <span className="up-drawer__title">SETTINGS</span>
          <button className="up-drawer__close" onClick={close} title="Close">
            X
          </button>
        </div>
        <div className="up-drawer__body">
          {/* ── PROFILE ── */}
          <div className="up-dossier-group">
            <div className="up-dossier-group__label">PROFILE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt="avatar"
                  style={{ width: 40, height: 40, objectFit: 'cover', border: '2px solid #1a1a1a' }}
                />
              ) : (
                <div
                  style={{
                    width: 40,
                    height: 40,
                    background: '#e0e0e0',
                    border: '2px solid #1a1a1a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'Arial',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  ?
                </div>
              )}
              <label style={{ cursor: 'pointer' }}>
                <span className="up-btn" style={{ pointerEvents: 'none' }}>
                  {saving === 'avatar' ? 'UPLOADING...' : 'CHANGE AVATAR'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
            <div style={{ marginBottom: 4 }}>
              <label style={{ display: 'block', fontFamily: 'Arial', fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#888', marginBottom: 2 }}>
                BIO
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  fontFamily: 'Arial',
                  fontSize: 10,
                  border: '1px solid #ddd',
                  padding: '4px 6px',
                  resize: 'vertical',
                  borderRadius: 0,
                }}
              />
              <button
                className="up-btn"
                onClick={() => handleSave('bio', bio)}
                disabled={saving === 'bio'}
                style={{ marginTop: 2 }}
              >
                {saving === 'bio' ? 'SAVING...' : 'SAVE BIO'}
              </button>
            </div>
            <div style={{ marginBottom: 4 }}>
              <label style={{ display: 'block', fontFamily: 'Arial', fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#888', marginBottom: 2 }}>
                LOCATION
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  style={{
                    flex: 1,
                    fontFamily: 'Arial',
                    fontSize: 10,
                    border: '1px solid #ddd',
                    padding: '3px 6px',
                    borderRadius: 0,
                  }}
                />
                <button
                  className="up-btn"
                  onClick={() => handleSave('location', location)}
                  disabled={saving === 'location'}
                >
                  {saving === 'location' ? '...' : 'SAVE'}
                </button>
              </div>
            </div>
            <div style={{ marginBottom: 4 }}>
              <label style={{ display: 'block', fontFamily: 'Arial', fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#888', marginBottom: 2 }}>
                WEBSITE
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  style={{
                    flex: 1,
                    fontFamily: 'Arial',
                    fontSize: 10,
                    border: '1px solid #ddd',
                    padding: '3px 6px',
                    borderRadius: 0,
                  }}
                />
                <button
                  className="up-btn"
                  onClick={() => handleSave('website', website)}
                  disabled={saving === 'website'}
                >
                  {saving === 'website' ? '...' : 'SAVE'}
                </button>
              </div>
            </div>
          </div>

          {/* ── EMAIL ── */}
          <div className="up-dossier-group">
            <div className="up-dossier-group__label">EMAIL</div>
            <div style={{ fontFamily: 'Courier New', fontSize: 9, marginBottom: 4, color: '#1a1a1a' }}>
              {profile?.email || 'No email on file'}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="email"
                placeholder="New email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                style={{
                  flex: 1,
                  fontFamily: 'Arial',
                  fontSize: 10,
                  border: '1px solid #ddd',
                  padding: '3px 6px',
                  borderRadius: 0,
                }}
              />
              <button
                className="up-btn"
                onClick={handleEmailUpdate}
                disabled={saving === 'email' || !newEmail.trim()}
              >
                {saving === 'email' ? '...' : 'UPDATE'}
              </button>
            </div>
            {emailMsg && (
              <div style={{ fontFamily: 'Arial', fontSize: 8, marginTop: 2, color: '#888' }}>
                {emailMsg}
              </div>
            )}
          </div>

          {/* ── PASSWORD ── */}
          <div className="up-dossier-group">
            <div className="up-dossier-group__label">PASSWORD</div>
            <Suspense fallback={LOADING_FALLBACK}>
              <ChangePasswordForm />
            </Suspense>
          </div>

          {/* ── VERIFICATION ── */}
          <div className="up-dossier-group">
            <div className="up-dossier-group__label">VERIFICATION</div>
            <Suspense fallback={LOADING_FALLBACK}>
              <ProfileVerification />
            </Suspense>
          </div>

          {/* ── CONNECTED PLATFORMS ── */}
          <div className="up-dossier-group">
            <div className="up-dossier-group__label">CONNECTED PLATFORMS</div>
            <Suspense fallback={LOADING_FALLBACK}>
              <ConnectedPlatforms />
            </Suspense>
          </div>

          {/* ── SOCIAL ── */}
          <div className="up-dossier-group">
            <div className="up-dossier-group__label">SOCIAL</div>
            <Suspense fallback={LOADING_FALLBACK}>
              <SocialConnections userId={userId || ''} />
            </Suspense>
          </div>

          {/* ── DATABASE (admin only) ── */}
          {isAdmin && (
            <div className="up-dossier-group">
              <div className="up-dossier-group__label">DATABASE</div>
              <Suspense fallback={LOADING_FALLBACK}>
                <DatabaseDiagnostic />
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default UserSettingsDrawer;
