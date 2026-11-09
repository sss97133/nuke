import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import VehicleCardDense from '../vehicles/VehicleCardDense';
import { VEHICLE_CARD_COLUMNS } from '../vehicles/vehicleCardColumns';
import { isCurrentGarageOwner, useVehiclesDashboard } from '../../hooks/useVehiclesDashboard';
import { useAuth } from '../../hooks/useAuth';

interface VehicleCollectionProps {
  userId: string;
  isOwnProfile: boolean;
}

/** Show qualified current ownership with private statements confined to the own-account view. */
const VehicleCollection: React.FC<VehicleCollectionProps> = ({ userId, isOwnProfile }) => {
  const { user, loading: authLoading } = useAuth();
  const viewerId = user?.id ?? null;
  const authPending = authLoading || (isOwnProfile && !!viewerId && viewerId !== userId);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const scope = `${userId}:${isOwnProfile}:${viewerId}:${authLoading}`;
  const garage = useVehiclesDashboard(isOwnProfile && viewerId && !authPending ? userId : null, 'ownership');
  useEffect(() => {
    let cancelled = false;
    if (authPending || !viewerId) {
      setVehicles([]);
      setLoadError(false);
      setLoadedScope(null);
      return () => { cancelled = true; };
    }
    if (isOwnProfile && garage.isLoading) return () => { cancelled = true; };
    const loadVehicles = async () => {
      try {
        setLoading(true);

        setLoadError(false);
        setVehicles([]);
        if (isOwnProfile && garage.error) throw new Error(garage.error);
        let ownedIds: string[];
        if (isOwnProfile) {
          ownedIds = garage.vehicles.filter(isCurrentGarageOwner).map(vehicle => vehicle.id);
        } else {
          // This authenticated reader qualifies public title evidence for another signed-in viewer.
          const { data, error } = await supabase.rpc('get_user_garage', { p_user_id: userId })
            .eq('relationship', 'owner').limit(50);
          if (error) throw error;
          ownedIds = (data ?? []).map((row: { vehicle_id: string }) => row.vehicle_id);
        }
        if (cancelled) return;
        if (ownedIds.length === 0) {
          setVehicles([]);
          return;
        }

        let query = supabase
          .from('vehicles')
          .select(`
            ${VEHICLE_CARD_COLUMNS},
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

        if (!cancelled) setVehicles(vehiclesWithImages);
      } catch (error) {
        console.error('Error loading vehicle collection:', error);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) { setLoading(false); setLoadedScope(scope); }
      }
    };
    void loadVehicles();
    return () => { cancelled = true; };
  }, [userId, isOwnProfile, viewerId, authPending, scope, garage.isLoading, garage.error, garage.vehicles]);

  if (!authLoading && !viewerId) {
    return <p className="text text-muted">Sign in to view this collection.</p>;
  }

  if (loadedScope === scope && loadError) return <p role="alert">Vehicle ownership evidence unavailable. Please reload to retry.</p>;

  if (authPending || loading || loadedScope !== scope || (isOwnProfile && garage.isLoading)) {
    return (
      <div className="card">
        <div className="card-body text-center" style={{ padding: 'var(--space-6)' }}>
          <div className="text text-muted">Loading collection...</div>
        </div>
      </div>
    );
  }

  const visibleVehicles = isOwnProfile ? vehicles.filter(vehicle =>
    garage.vehicles.some(row => row.id === vehicle.id && isCurrentGarageOwner(row))) : vehicles;
  if (visibleVehicles.length === 0) {
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
          <h3 className="heading-3">Vehicle Collection ({visibleVehicles.length})</h3>
        </div>
        <div className="card-body">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--space-3)'
          }}>
            {visibleVehicles.map(vehicle => (
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

