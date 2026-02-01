import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import VehicleThumbnail from '../VehicleThumbnail';
import { VehicleSearchService, type VehicleSearchResult } from '../../services/vehicleSearchService';

const FeaturedVehicles: React.FC = () => {
  const [featuredVehicles, setFeaturedVehicles] = useState<VehicleSearchResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFeaturedVehicles();
  }, []);

  const loadFeaturedVehicles = async () => {
    try {
      setLoading(true);
      
      // Get a mix of interesting vehicles: recent, for sale, and high-value
      const [recentVehicles, forSaleVehicles, highValueRaw] = await Promise.all([
        VehicleSearchService.searchVehicles({}),
        VehicleSearchService.searchVehicles({ forSale: true }),
        supabase
          .from('vehicles')
          .select('*')
          .eq('is_public', true)
          .neq('status', 'pending')
          .not('current_value', 'is', null)
          .order('current_value', { ascending: false })
          .limit(3)
      ]);

      // Hydrate high value vehicles with profile info
      let highValueVehicles: any[] = (highValueRaw.data || []) as any[];
      if (highValueVehicles.length > 0) {
        const userIds = Array.from(new Set(highValueVehicles.map(v => v.user_id).filter(Boolean)));
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, username, full_name')
            .in('id', userIds);
          if (profiles) {
            const pmap = new Map(profiles.map((p: any) => [p.id, { username: p.username ?? null, full_name: p.full_name ?? null }]));
            highValueVehicles = highValueVehicles.map(v => ({ ...v, profiles: v.user_id ? pmap.get(v.user_id) : undefined }));
          }
        }
      }

      // Combine and deduplicate
      const allVehicles = [
        ...recentVehicles.slice(0, 2),
        ...forSaleVehicles.slice(0, 2),
        ...highValueVehicles.slice(0, 2)
      ];

      // Remove duplicates and limit to 6
      const uniqueVehicles = allVehicles.filter((vehicle, index, self) => 
        index === self.findIndex(v => v.id === vehicle.id)
      ).slice(0, 6);

      setFeaturedVehicles(uniqueVehicles);
    } catch (error) {
      console.error('Error loading featured vehicles:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUserDisplay = (vehicle: VehicleSearchResult) => {
    if (vehicle.profiles?.username) {
      return `@${vehicle.profiles.username}`;
    } else if (vehicle.profiles?.full_name) {
      return vehicle.profiles.full_name;
    } else {
      return 'Anonymous User';
    }
  };

  if (loading) {
    return (
      <section className="section">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Featured Vehicles</h2>
        </div>
        <div className="card">
          <div className="card-body text-center py-8">
            <div className="loading-spinner mx-auto mb-4"></div>
            <p className="text-muted">Loading featured vehicles...</p>
          </div>
        </div>
      </section>
    );
  }

  if (featuredVehicles.length === 0) {
    return null;
  }

  return (
    <section className="section">
      <div className="space-y-2">
        {featuredVehicles.map((vehicle) => (
          <div key={vehicle.id} className="bg-white p-3 rounded border hover:shadow-sm transition-shadow">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-xs font-medium text-gray-900">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </h3>
                  
                  {vehicle.is_for_sale && (
                    <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                      For Sale
                    </span>
                  )}
                  
                  {vehicle.source && (
                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">
                      {vehicle.source}
                    </span>
                  )}
                </div>

                <div className="text-xs text-gray-600 space-y-0.5">
                  <div>by {getUserDisplay(vehicle)}</div>
                  
                  <div className="flex items-center gap-4">
                    {vehicle.asking_price && vehicle.is_for_sale && (
                      <span className="font-medium text-green-600">
                        {VehicleSearchService.formatPrice(vehicle.asking_price)}
                      </span>
                    )}
                    
                    {vehicle.mileage && (
                      <span>{vehicle.mileage.toLocaleString()} miles</span>
                    )}
                    
                    {vehicle.city && vehicle.state && (
                      <span>{vehicle.city}, {vehicle.state}</span>
                    )}
                  </div>
                </div>
              </div>

              <Link 
                to={`/vehicle/${vehicle.id}`}
                className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                style={{ textDecoration: 'none' }}
              >
                View
              </Link>
            </div>
          </div>
        ))}
      </div>
      
      <div className="text-center mt-4">
        <Link 
          to="/all-vehicles"
          className="text-xs px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
          style={{ textDecoration: 'none' }}
        >
          View All Vehicles
        </Link>
      </div>
    </section>
  );
};

export default FeaturedVehicles;
