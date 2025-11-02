/**
 * Ghost User Profile Page
 * Shows contributions from unclaimed camera devices
 * Matches user profile structure for consistency
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../design-system.css';

type GhostTab = 'overview' | 'contributions' | 'devices';

export const GhostUserProfile: React.FC = () => {
  const { ghostUserId } = useParams<{ ghostUserId: string }>();
  const navigate = useNavigate();
  const [ghostUser, setGhostUser] = useState<any>(null);
  const [contributions, setContributions] = useState<any[]>([]);
  const [vehicleStats, setVehicleStats] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [activeTab, setActiveTab] = useState<GhostTab>('overview');

  useEffect(() => {
    loadGhostUser();
    checkSession();
  }, [ghostUserId]);

  const checkSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
  };

  const loadGhostUser = async () => {
    if (!ghostUserId) return;

    try {
      setLoading(true);

      // Get ghost user info
      const { data: ghost } = await supabase
        .from('ghost_users')
        .select('*')
        .eq('id', ghostUserId)
        .single();

      if (!ghost) {
        setLoading(false);
        return;
      }

      setGhostUser(ghost);

      // Get all contributions with vehicle info
      const { data: contribs } = await supabase
        .from('device_attributions')
        .select(`
          *,
          image:vehicle_images(
            id,
            image_url,
            taken_at,
            vehicle:vehicles(id, year, make, model)
          )
        `)
        .eq('ghost_user_id', ghostUserId)
        .order('created_at', { ascending: false });

      setContributions(contribs || []);

      // Calculate vehicle stats
      const uniqueVehicles = new Set(contribs?.map(c => c.image?.vehicle?.id).filter(Boolean));
      const dateRange = contribs
        ?.map(c => c.image?.taken_at)
        .filter(Boolean)
        .sort();

      setVehicleStats({
        totalImages: contribs?.length || 0,
        uniqueVehicles: uniqueVehicles.size,
        firstPhoto: dateRange?.[0],
        lastPhoto: dateRange?.[dateRange.length - 1]
      });

    } catch (err) {
      console.error('Error loading ghost user:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!session?.user) {
      alert('Please sign in to claim this profile');
      navigate('/login');
      return;
    }

    if (!ghostUser?.device_fingerprint) {
      alert('Invalid ghost user');
      return;
    }

    if (!confirm(`Are you sure these ${contributions.length} photos were taken with your ${ghostUser.camera_make} ${ghostUser.camera_model}? This action cannot be undone.`)) {
      return;
    }

    setClaiming(true);

    try {
      const { data, error } = await supabase.rpc('claim_ghost_user', {
        p_user_id: session.user.id,
        p_device_fingerprint: ghostUser.device_fingerprint
      });

      if (error) throw error;

      if (data.success) {
        alert(`Success! Claimed ${data.contributions_transferred} contributions.`);
        navigate('/profile');
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err: any) {
      console.error('Claim error:', err);
      alert(`Failed to claim: ${err.message}`);
    } finally {
      setClaiming(false);
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="main">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!ghostUser) {
    return (
      <div className="container">
        <div className="main">
          <div className="section">
            <h2>Ghost User Not Found</h2>
            <button onClick={() => navigate('/')} className="button">
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isClaimed = ghostUser.claimed_by_user_id !== null;

  return (
    <div className="container">
      <div className="main">
        {/* Profile Header */}
        <div className="section">
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-3)'
          }}>
            {/* Avatar - Device Icon */}
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: isClaimed ? 'var(--success)' : 'var(--warning)',
              border: '2px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              color: 'white'
            }}>
              {ghostUser.camera_model?.charAt(0) || 'D'}
            </div>
            
            {/* Name and Stats */}
            <div style={{ flex: 1 }}>
              <h2 className="heading-2" style={{ margin: 0 }}>
                {ghostUser.display_name}
              </h2>
              <div className="text text-small text-muted" style={{ marginTop: 'var(--space-1)' }}>
                {isClaimed ? 'CLAIMED' : 'UNCLAIMED DEVICE'}
              </div>
            </div>
          </div>

          {/* Device Info Card */}
          <div className="card">
            <div className="card-body">
              <div className="text text-small" style={{ lineHeight: '1.6' }}>
                <div><strong>Device:</strong> {ghostUser.camera_make} {ghostUser.camera_model}</div>
                {ghostUser.lens_model && <div><strong>Lens:</strong> {ghostUser.lens_model}</div>}
                {ghostUser.software_version && <div><strong>Software:</strong> {ghostUser.software_version}</div>}
                <div><strong>First Seen:</strong> {new Date(ghostUser.first_seen_at).toLocaleDateString()}</div>
                {vehicleStats && (
                  <>
                    <div><strong>Photos:</strong> {vehicleStats.totalImages}</div>
                    <div><strong>Vehicles:</strong> {vehicleStats.uniqueVehicles}</div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Claim Button */}
          {!isClaimed && session && (
            <div className="card" style={{ 
              marginTop: 'var(--space-3)',
              border: '2px solid var(--accent)'
            }}>
              <div className="card-body">
                <h3 className="heading-3" style={{ marginTop: 0 }}>
                  Is this your camera?
                </h3>
                <p className="text text-small" style={{ margin: 'var(--space-2) 0' }}>
                  If you took these photos with your {ghostUser.camera_make} {ghostUser.camera_model}, 
                  you can claim all {contributions.length} contributions.
                </p>
                <button
                  onClick={handleClaim}
                  disabled={claiming}
                  className="button button-primary"
                  style={{ width: '100%' }}
                >
                  {claiming ? 'CLAIMING...' : 'CLAIM THIS PROFILE'}
                </button>
              </div>
            </div>
          )}

          {!isClaimed && !session && (
            <div className="card" style={{ 
              marginTop: 'var(--space-3)',
              border: '2px solid var(--warning)'
            }}>
              <div className="card-body">
                <p className="text text-small" style={{ margin: 0 }}>
                  <strong>Sign in to claim this profile</strong> if these photos were taken with your device.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Tab Navigation - Match user profile style */}
        <div style={{ 
          display: 'flex',
          gap: '0',
          marginBottom: 'var(--space-2)',
          borderBottom: '2px solid var(--border-dark)'
        }}>
          {[
            { key: 'overview' as const, label: 'Overview' },
            { key: 'contributions' as const, label: 'Contributions' },
            { key: 'devices' as const, label: 'Device Info' }
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                background: activeTab === tab.key ? 'var(--grey-200)' : 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : 'none',
                padding: '8px 12px',
                fontSize: '9pt',
                cursor: 'pointer',
                fontFamily: 'Arial, sans-serif',
                color: activeTab === tab.key ? 'var(--accent)' : 'var(--text)'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="section">
          {activeTab === 'overview' && (
            <div>
              <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
                <div className="card-header">
                  <h3 className="heading-3">Contribution Summary</h3>
                </div>
                <div className="card-body">
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: 'var(--space-2)'
                  }}>
                    <div className="text-center">
                      <div className="text text-bold" style={{ fontSize: '16pt' }}>
                        {vehicleStats?.totalImages || 0}
                      </div>
                      <div className="text text-small text-muted">Photos</div>
                    </div>
                    <div className="text-center">
                      <div className="text text-bold" style={{ fontSize: '16pt' }}>
                        {vehicleStats?.uniqueVehicles || 0}
                      </div>
                      <div className="text text-small text-muted">Vehicles</div>
                    </div>
                    <div className="text-center">
                      <div className="text text-bold" style={{ fontSize: '16pt' }}>
                        {vehicleStats?.firstPhoto ? new Date(vehicleStats.firstPhoto).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'N/A'}
                      </div>
                      <div className="text text-small text-muted">First Photo</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Contributions */}
              <div className="card">
                <div className="card-header">
                  <h3 className="heading-3">Recent Contributions</h3>
                </div>
                <div className="card-body">
                  <div style={{ 
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: 'var(--space-2)'
                  }}>
                    {contributions.slice(0, 8).map(contrib => {
                      const img = contrib.image;
                      if (!img) return null;

                      return (
                        <div
                          key={contrib.id}
                          style={{
                            border: '2px solid var(--border)',
                            borderRadius: '0px',
                            overflow: 'hidden',
                            cursor: 'pointer',
                            transition: 'all 0.12s ease'
                          }}
                          onClick={() => img.vehicle && navigate(`/vehicle/${img.vehicle.id}`)}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                          }}
                        >
                          <div style={{
                            width: '100%',
                            height: '120px',
                            backgroundImage: `url(${img.image_url})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center'
                          }} />
                          <div style={{ padding: '8px', background: 'var(--white)' }}>
                            {img.vehicle && (
                              <div className="text text-small text-bold" style={{ marginBottom: '2px' }}>
                                {img.vehicle.year} {img.vehicle.make}
                              </div>
                            )}
                            {img.taken_at && (
                              <div className="text text-tiny text-muted">
                                {new Date(img.taken_at).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'contributions' && (
            <div className="card">
              <div className="card-header">
                <h3 className="heading-3">All Contributions ({contributions.length})</h3>
              </div>
              <div className="card-body">
                <div style={{ 
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 'var(--space-3)'
                }}>
                  {contributions.map(contrib => {
                    const img = contrib.image;
                    if (!img) return null;

                    return (
                      <div
                        key={contrib.id}
                        style={{
                          border: '2px solid var(--border)',
                          borderRadius: '0px',
                          overflow: 'hidden',
                          cursor: 'pointer',
                          transition: 'all 0.12s ease'
                        }}
                        onClick={() => img.vehicle && navigate(`/vehicle/${img.vehicle.id}`)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        <div style={{
                          width: '100%',
                          height: '180px',
                          backgroundImage: `url(${img.image_url})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center'
                        }} />
                        <div style={{ padding: '12px', background: 'var(--white)' }}>
                          {img.vehicle && (
                            <div className="text text-small text-bold" style={{ marginBottom: '4px' }}>
                              {img.vehicle.year} {img.vehicle.make} {img.vehicle.model}
                            </div>
                          )}
                          {img.taken_at && (
                            <div className="text text-tiny text-muted">
                              {new Date(img.taken_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {contributions.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '40px' }}>
                    <p className="text text-muted">No contributions found</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'devices' && (
            <div className="card">
              <div className="card-header">
                <h3 className="heading-3">Device Information</h3>
              </div>
              <div className="card-body">
                <div style={{ lineHeight: '1.8' }}>
                  <div className="text">
                    <strong>Fingerprint:</strong><br/>
                    <code style={{ fontSize: '8pt', background: 'var(--grey-100)', padding: '2px 4px' }}>
                      {ghostUser.device_fingerprint}
                    </code>
                  </div>
                  <div className="text" style={{ marginTop: 'var(--space-2)' }}>
                    <strong>Camera Make:</strong> {ghostUser.camera_make || 'Unknown'}
                  </div>
                  <div className="text">
                    <strong>Camera Model:</strong> {ghostUser.camera_model || 'Unknown'}
                  </div>
                  <div className="text">
                    <strong>Lens:</strong> {ghostUser.lens_model || 'Unknown'}
                  </div>
                  <div className="text">
                    <strong>Software Version:</strong> {ghostUser.software_version || 'Unknown'}
                  </div>
                  <div className="text" style={{ marginTop: 'var(--space-2)' }}>
                    <strong>Status:</strong> {isClaimed ? 'Claimed' : 'Unclaimed'}
                  </div>
                  {isClaimed && ghostUser.claimed_at && (
                    <div className="text">
                      <strong>Claimed On:</strong> {new Date(ghostUser.claimed_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GhostUserProfile;
