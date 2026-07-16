import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import VehicleCardDense from '../vehicles/VehicleCardDense';

interface VehicleCollectionProps {
  userId: string;
  isOwnProfile: boolean;
}

const VehicleCollection: React.FC<VehicleCollectionProps> = ({ userId, isOwnProfile }) => {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    loadVehicles();
  }, [userId]);

  const loadVehicles = async () => {
    try {
      setLoading(true);

      // OWNED / BUILT only — the C0-correct ownership signal (founder teardown
      // PROFILE_BUILD_ORDER 2026-06-13, item 8 "the ONE thing I wanna see").
      //
      // The old query (user_id ∪ uploaded_by ∪ owner_id) returned ~330 rows —
      // mostly scraped Craigslist listings and a truck he SOLD (the 1983 K2500
      // sits here as a `contributor` row). Showing those as "his" is the cardinal
      // sin he named ("I'm not the verified owner of the K2500 … I sold that
      // fucking truck"). owner_id is set by ingestion, not ownership.
      //
      // Truth comes from two gated rungs:
      //   1. active owner/co_owner permissions  (vehicle_user_permissions)
      //   2. approved title verifications        (ownership_verifications)
      // The `contributor` role is deliberately EXCLUDED — it's the scraped/touched
      // noise bucket (it even contains the sold K2500), so it fails the
      // built/owned confidence test.
      const [permRes, titleRes] = await Promise.all([
        supabase
          .from('vehicle_user_permissions')
          .select('vehicle_id')
          .eq('user_id', userId)
          .is('revoked_at', null)
          .in('role', ['owner', 'co_owner']),
        supabase
          .from('ownership_verifications')
          .select('vehicle_id')
          .eq('user_id', userId)
          .eq('status', 'approved'),
      ]);

      const ownedIds = Array.from(new Set([
        ...((permRes.data || []).map((r: any) => r.vehicle_id)),
        ...((titleRes.data || []).map((r: any) => r.vehicle_id)),
      ].filter(Boolean)));

      if (ownedIds.length === 0) {
        setVehicles([]);
        return;
      }

      let query = supabase
        .from('vehicles')
        .select(`
          *,
          vehicle_images(image_url, is_primary)
        `)
        .in('id', ownedIds);

      // For public profiles, only show public vehicles
      if (!isOwnProfile) {
        query = query.eq('is_public', true);
      }

      const { data, error } = await query
        .order('year', { ascending: false })
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
          {isOwnProfile ? (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                No vehicles yet
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
                Add your first vehicle to start tracking ownership history, photos, and events.
              </div>
              <Link
                to="/vehicle/add"
                className="button"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                + Add a vehicle
              </Link>
            </div>
          ) : (
            <div className="text text-muted" style={{ fontSize: '11px' }}>
              No public vehicles to display.
            </div>
          )}
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

