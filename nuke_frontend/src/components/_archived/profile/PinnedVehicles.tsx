import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface PinnedVehiclesProps {
  userId: string;
  isOwnProfile: boolean;
}

interface PinnedVehicle {
  id: string;
  vehicle_id: string;
  make: string;
  model: string;
  year: number;
  image_url?: string;
  views: number;
  saves: number;
}

interface VehicleWithImages extends PinnedVehicle {
  images?: string[];
  mileage?: number;
  updated_at?: string;
}

const PinnedVehicles: React.FC<PinnedVehiclesProps> = ({ userId, isOwnProfile }) => {
  const [vehicles, setVehicles] = useState<VehicleWithImages[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 9;
  const offsetRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // reset pagination when userId changes
    setVehicles([]);
    setHasMore(true);
    offsetRef.current = 0;
    loadVehicles(true);
  }, [userId]);

  useEffect(() => {
    // Infinite scroll via IntersectionObserver
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && hasMore && !loadingMore && !loading) {
        loadVehicles(false);
      }
    }, { root: null, rootMargin: '200px', threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading]);

  const loadVehicles = async (initial = false) => {
    try {
      if (initial) setLoading(true); else setLoadingMore(true);
      // Get user's vehicles with real data (paginated)
      const start = offsetRef.current;
      const end = start + pageSize - 1;
      const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select(`
          id,
          make,
          model,
          year,
          mileage,
          updated_at
        `)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .range(start, end);

      if (vehiclesData) {
        // Load images for each vehicle
        const vehiclesWithImages = await Promise.all(
          vehiclesData.map(async (v) => {
            const { data: images } = await supabase
              .from('vehicle_images')
              .select('image_url')
              .eq('vehicle_id', v.id)
              .limit(3);
            
            // Get view count from vehicle_views table
            const { data: viewsData } = await supabase
              .from('vehicle_views')
              .select('id')
              .eq('vehicle_id', v.id);

            // Get save count from user_vehicle_saves table
            const { data: savesData } = await supabase
              .from('user_vehicle_saves')
              .select('id')
              .eq('vehicle_id', v.id);

            return {
              ...v,
              vehicle_id: v.id,
              images: images?.map(img => img.image_url) || [],
              views: viewsData?.length || 0,
              saves: savesData?.length || 0
            };
          })
        );

        setVehicles(prev => initial ? vehiclesWithImages : [...prev, ...vehiclesWithImages]);
        // Update pagination cursor and hasMore
        offsetRef.current += vehiclesData.length;
        if (vehiclesData.length < pageSize) setHasMore(false);
      }
    } catch (error) {
      console.error('Error loading vehicles:', error);
    } finally {
      if (initial) setLoading(false); else setLoadingMore(false);
    }
  };

  if (loading) return null;
  if (vehicles.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="text-[10pt] font-semibold mb-2">Vehicles</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {vehicles.map(vehicle => (
          <a
            key={vehicle.id}
            href={`/vehicle/${vehicle.vehicle_id}`}
            className="block border border-gray-300 rounded overflow-hidden hover:shadow-sm transition-shadow"
          >
            {vehicle.images && vehicle.images[0] ? (
              <div className="h-[120px] bg-cover bg-center" style={{ backgroundImage: `url(${vehicle.images[0]})` }} />
            ) : (
              <div className="h-[120px] bg-gray-100 flex items-center justify-center text-[8pt] text-gray-500">
                No image
              </div>
            )}
            <div className="p-2">
              <div className="text-[8pt] font-semibold">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </div>
              {vehicle.mileage && (
                <div className="text-[8pt] text-gray-500 mt-1">
                  {vehicle.mileage.toLocaleString()} miles
                </div>
              )}
            </div>
          </a>
        ))}
      </div>
      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-px" />

      {/* Manual fallback */}
      {hasMore && (
        <div className="flex justify-center mt-2">
          <button className="button button-small" onClick={() => loadVehicles(false)} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </div>
  );
};

export default PinnedVehicles;
