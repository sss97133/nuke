import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface Contributor {
  user_id: string;
  username?: string;
  full_name?: string;
  avatar_url?: string;
  image_count: number;
  latest_upload: string;
}

interface VehicleContributorsProps {
  vehicleId: string;
}

const VehicleContributors: React.FC<VehicleContributorsProps> = ({ vehicleId }) => {
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadContributors();
  }, [vehicleId]);

  const loadContributors = async () => {
    try {
      setLoading(true);
      
      // Get all images for this vehicle
      const { data: images, error: imgError } = await supabase
        .from('vehicle_images')
        .select('user_id, created_at')
        .eq('vehicle_id', vehicleId);

      if (imgError) throw imgError;

      // Get unique user IDs
      const userIds = [...new Set((images || []).filter(img => img.user_id).map(img => img.user_id))];
      
      // Get user profiles separately (only if there are user IDs)
      let profiles: any[] = [];
      if (userIds.length > 0) {
        const { data, error: profError } = await supabase
          .from('profiles')
          .select('id, username, full_name, avatar_url')
          .in('id', userIds);
        
        if (profError) {
          console.warn('Error loading profiles:', profError);
        } else {
          profiles = data || [];
        }
      }

      // Create profile lookup
      const profileMap = new Map();
      (profiles || []).forEach(p => profileMap.set(p.id, p));

      // Aggregate by user
      const contributorMap = new Map<string, Contributor>();
      
      (images || []).forEach((img: any) => {
        const userId = img.user_id;
        if (!userId) return;
        
        const profile = profileMap.get(userId) || {};
        const existing = contributorMap.get(userId) || {
          user_id: userId,
          username: profile.username,
          full_name: profile.full_name,
          avatar_url: profile.avatar_url,
          image_count: 0,
          latest_upload: img.created_at
        };
        
        existing.image_count += 1;
        if (new Date(img.created_at) > new Date(existing.latest_upload)) {
          existing.latest_upload = img.created_at;
        }
        
        contributorMap.set(userId, existing);
      });
      
      // Sort by contribution count
      const sorted = Array.from(contributorMap.values())
        .sort((a, b) => b.image_count - a.image_count);
      
      setContributors(sorted);
    } catch (error) {
      console.error('Error loading contributors:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text text-muted" style={{ fontSize: '7pt' }}>Loading contributors...</div>;
  }

  if (contributors.length === 0) {
    return null;
  }

  return (
    <div className="contributors-section">
      <h3 className="text" style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>Contributors</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {contributors.map((contributor) => (
          <div
            key={contributor.user_id}
            className="card"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-2)', cursor: 'pointer' }}
            onClick={() => navigate(`/profile/${contributor.user_id}`)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {contributor.avatar_url ? (
                <img
                  src={contributor.avatar_url}
                  alt=""
                  style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                />
              ) : (
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--grey-300)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="text" style={{ fontSize: '6pt', color: 'var(--grey-600)' }}>
                    {(contributor.full_name || contributor.username || '?')[0].toUpperCase()}
                  </span>
                </div>
              )}
              <div>
                <div className="text" style={{ fontSize: '7pt', fontWeight: 'bold' }}>
                  {contributor.full_name || contributor.username || 'Anonymous'}
                </div>
                <div className="text text-muted" style={{ fontSize: '6pt' }}>
                  {contributor.image_count} image{contributor.image_count !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
            <div className="text text-muted" style={{ fontSize: '6pt' }}>
              {new Date(contributor.latest_upload).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VehicleContributors;
