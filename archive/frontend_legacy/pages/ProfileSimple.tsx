import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
// AppLayout now provided globally by App.tsx
import ProfessionalToolbox from '../components/profile/ProfessionalToolbox';

interface ProfileData {
  id: string;
  full_name: string | null;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  location: string | null;
}

const ProfileSimple: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    username: '',
    bio: '',
    location: ''
  });

  useEffect(() => {
    loadProfile();
  }, [userId]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
      
      const targetUserId = userId || user?.id;
      if (!targetUserId) {
        setLoading(false);
        return;
      }

      // Load profile
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', targetUserId)
        .single();

      if (error) throw error;
      
      setProfile(data);
      setFormData({
        full_name: data.full_name || '',
        username: data.username || '',
        bio: data.bio || '',
        location: data.location || ''
      });
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async () => {
    if (!currentUser || !profile) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update(formData)
        .eq('id', profile.id);

      if (error) throw error;

      await loadProfile();
      setEditing(false);
    } catch (error) {
      console.error('Error saving profile:', error);
      alert('Failed to save profile');
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  if (loading) {
    return (
      
        <div className="container">
          <div className="card">
            <div className="card-body text-center">
              <p className="text">Loading...</p>
            </div>
          </div>
        </div>
      
    );
  }

  if (!profile) {
    return (
      
        <div className="container">
          <div className="card">
            <div className="card-body text-center">
              <p className="text">Profile not found</p>
            </div>
          </div>
        </div>
      
    );
  }

  const isOwnProfile = currentUser?.id === profile.id;

  return (
    
      <div className="container">
        <div className="main">
          {/* Profile Card */}
          <div className="card">
            <div className="card-header">
              <h2 className="text font-bold">Profile</h2>
            </div>
            <div className="card-body">
              {editing ? (
                // Edit Mode
                <>
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={formData.full_name}
                      onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Username</label>
                    <input
                      type="text"
                      className="form-input"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Bio</label>
                    <textarea
                      className="form-input"
                      rows={3}
                      value={formData.bio}
                      onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Location</label>
                    <input
                      type="text"
                      className="form-input"
                      value={formData.location}
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
                    <button className="button button-primary" onClick={saveProfile}>
                      Save
                    </button>
                    <button className="button button-secondary" onClick={() => setEditing(false)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                // View Mode
                <>
                  <table className="table">
                    <tbody>
                      <tr>
                        <td className="text font-bold">Name:</td>
                        <td className="text">{profile.full_name || 'Not set'}</td>
                      </tr>
                      <tr>
                        <td className="text font-bold">Username:</td>
                        <td className="text">@{profile.username || 'Not set'}</td>
                      </tr>
                      <tr>
                        <td className="text font-bold">Bio:</td>
                        <td className="text">{profile.bio || 'Not set'}</td>
                      </tr>
                      <tr>
                        <td className="text font-bold">Location:</td>
                        <td className="text">{profile.location || 'Not set'}</td>
                      </tr>
                    </tbody>
                  </table>

                  {isOwnProfile && (
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
                      <button className="button button-primary" onClick={() => setEditing(true)}>
                        Edit Profile
                      </button>
                      <button className="button button-secondary" onClick={handleSignOut}>
                        Sign Out
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Professional Tools Section - Only show for own profile */}
          {isOwnProfile && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <ProfessionalToolbox userId={profile.id} isOwnProfile={true} />
            </div>
          )}
        </div>
      </div>
    
  );
};

export default ProfileSimple;
