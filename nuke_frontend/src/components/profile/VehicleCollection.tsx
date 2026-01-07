import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import VehicleCardDense from '../vehicles/VehicleCardDense';

interface VehicleCollectionProps {
  userId: string;
  isOwnProfile: boolean;
}

const VehicleCollection: React.FC<VehicleCollectionProps> = ({ userId, isOwnProfile }) => {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadVehicles();
  }, [userId]);

  const loadVehicles = async () => {
    try {
      setLoading(true);
      
      // Load vehicles the user owns (user_id) or has verified ownership of
      let query = supabase
        .from('vehicles')
        .select(`
          *,
          vehicle_images(image_url, is_primary)
        `)
        .eq('user_id', userId);

      // For public profiles, only show public vehicles
      if (!isOwnProfile) {
        query = query.eq('is_public', true);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Get primary images for each vehicle (vehicles without images are still included)
      const vehiclesWithImages = (data || []).map(vehicle => {
        const images = vehicle.vehicle_images || [];
        const primaryImage = images.find((img: any) => img.is_primary) || images[0];
        return {
          ...vehicle,
          image_url: primaryImage?.image_url,
          image_count: images.length
        };
      });

      setVehicles(vehiclesWithImages);
    } catch (error) {
      console.error('Error loading vehicle collection:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body text-center" style={{ padding: 'var(--space-6)' }}>
          <div className="text text-muted">Loading collection...</div>
        </div>
      </div>
    );
  }

  if (vehicles.length === 0) {
    return (
      <div className="card">
        <div className="card-body text-center" style={{ padding: 'var(--space-6)' }}>
          <div className="text text-muted">
            {isOwnProfile ? 'No vehicles in your collection yet.' : 'No public vehicles to display.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h3 className="heading-3">Vehicle Collection ({vehicles.length})</h3>
        </div>
        <div className="card-body">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--space-3)'
          }}>
            {vehicles.map(vehicle => (
              <VehicleCardDense
                key={vehicle.id}
                vehicle={vehicle}
                viewMode="gallery"
                showPriceOverlay={true}
                showDetailOverlay={true}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VehicleCollection;

