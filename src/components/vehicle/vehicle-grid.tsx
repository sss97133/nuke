import React from 'react';
import { VehicleCard } from '@/components/ui/vehicle-card';
import { cn } from '@/lib/utils';
import { trackInteraction } from '@/utils/adaptive-ui';

/**
 * Interface for a vehicle object
 */
export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  imageUrl?: string;
  trustScore?: number;
  verificationLevel?: string;
  ownershipType?: 'FULL' | 'FRACTIONAL';
  ownershipStatus?: 'owned' | 'watching' | 'discovered';
  fractions?: {
    available: number;
    total: number;
    pricePerFraction?: number;
  };
  price?: number;
  location?: string;
  lastUpdated?: string;
  events?: Array<{
    id: string;
    type: string;
    date: string;
    title: string;
    description?: string;
    verificationLevel?: string;
    sourceType?: string;
  }>;
}

export interface VehicleGridProps {
  vehicles: Vehicle[];
  className?: string;
  emptyStateMessage?: string;
  loading?: boolean;
  gridType?: 'default' | 'compact' | 'marketplace' | 'portfolio';
  onVehicleClick?: (vehicle: Vehicle) => void;
  hideIfEmpty?: boolean;
}

/**
 * VehicleGrid Component
 * 
 * A responsive grid layout for displaying multiple vehicle cards.
 * This component is designed to showcase vehicles as first-class digital entities,
 * emphasizing their trust levels and verification status in alignment with
 * the Nuke platform's vehicle-centric architecture.
 */
export function VehicleGrid({
  vehicles,
  className,
  emptyStateMessage = "No vehicles found",
  loading = false,
  gridType = 'default',
  onVehicleClick,
  hideIfEmpty = false,
}: VehicleGridProps) {
  // Track interaction when a vehicle is clicked
  const handleVehicleClick = (vehicle: Vehicle) => {
    trackInteraction({
      type: 'VEHICLE_VIEW',
      itemId: vehicle.id,
      timestamp: new Date().toISOString(),
      metadata: {
        vehicleMake: vehicle.make,
        vehicleModel: vehicle.model,
        vehicleYear: vehicle.year,
        gridType,
      },
    });
    
    if (onVehicleClick) {
      onVehicleClick(vehicle);
    } else {
      // Default navigation to vehicle detail page
      window.location.href = `/vehicles/${vehicle.id}`;
    }
  };

  // Show loading state
  if (loading) {
    return (
      <div className={cn("w-full", className)}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={`skeleton-${index}`}
              className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800"
            />
          ))}
        </div>
      </div>
    );
  }

  // Hide or show empty state
  if (vehicles.length === 0) {
    if (hideIfEmpty) {
      return null;
    }
    
    return (
      <div className={cn("w-full py-12 text-center", className)}>
        <div className="mx-auto flex max-w-sm flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <svg
            className="h-12 w-12 text-neutral-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M5 17h14v-5.5a5.5 5.5 0 0 0-11 0V17zm6 0v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1M4 5h16l-2 5H6zM12 4V2M7 9l-3 3M17 9l3 3"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-neutral-900 dark:text-white">
            {emptyStateMessage}
          </h3>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Vehicles you add will appear here with their trust scores and verification status.
          </p>
        </div>
      </div>
    );
  }

  // Define grid styles based on grid type
  const gridStyles = {
    default: "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    compact: "grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
    marketplace: "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    portfolio: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3", 
  };

  return (
    <div className={cn("w-full", className)}>
      <div className={gridStyles[gridType]}>
        {vehicles.map((vehicle) => (
          <VehicleCard
            key={vehicle.id}
            id={vehicle.id}
            make={vehicle.make}
            model={vehicle.model}
            year={vehicle.year}
            imageUrl={vehicle.imageUrl || vehicle.images?.[0]}
            trustScore={vehicle.trustScore}
            verificationLevel={vehicle.verificationLevel as keyof typeof tokens.verificationLevels}
            ownershipStatus={vehicle.ownershipStatus || 'discovered'}
            onClick={() => handleVehicleClick(vehicle)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * VehicleRecommendations Component
 * 
 * A specialized grid that shows recommended vehicles based on user preferences
 * and vehicle similarity. This leverages the adaptive UI system to show
 * relevant recommendations.
 */
export function VehicleRecommendations({
  currentVehicleId,
  className,
  title = "Similar Vehicles",
  limit = 4,
}: {
  currentVehicleId: string;
  className?: string;
  title?: string;
  limit?: number;
}) {
  // This would typically fetch recommendations from an API
  // For now, we'll use placeholder data
  const [recommendations, setRecommendations] = React.useState<Vehicle[]>([]);
  const [loading, setLoading] = React.useState(true);
  
  React.useEffect(() => {
    // In a real implementation, this would call an API endpoint
    // to get recommendations based on the current vehicle
    
    // Simulate API call
    const fetchRecommendations = async () => {
      setLoading(true);
      try {
        // Placeholder data - in production, this would be an API call
        const mockRecommendations: Vehicle[] = [
          {
            id: '1',
            make: 'Toyota',
            model: 'Supra',
            year: 1998,
            trustScore: 87,
            verificationLevel: 'PTZ_VERIFIED',
            imageUrl: '/images/placeholder-car.jpg',
          },
          {
            id: '2',
            make: 'Nissan',
            model: 'Skyline GT-R',
            year: 1999,
            trustScore: 92,
            verificationLevel: 'BLOCKCHAIN',
            imageUrl: '/images/placeholder-car.jpg',
          },
          {
            id: '3',
            make: 'Mazda',
            model: 'RX-7',
            year: 1993,
            trustScore: 76,
            verificationLevel: 'PROFESSIONAL',
            imageUrl: '/images/placeholder-car.jpg',
          },
          {
            id: '4',
            make: 'Honda',
            model: 'NSX',
            year: 1995,
            trustScore: 81,
            verificationLevel: 'MULTI_SOURCE',
            imageUrl: '/images/placeholder-car.jpg',
          },
        ];
        
        // Filter out the current vehicle if it's in the recommendations
        const filtered = mockRecommendations.filter(v => v.id !== currentVehicleId);
        
        // Set recommendations
        setRecommendations(filtered.slice(0, limit));
        
        // Track this interaction for adaptive UI
        trackInteraction({
          type: 'RECOMMENDATIONS_VIEW',
          itemId: currentVehicleId,
          timestamp: new Date().toISOString(),
          metadata: {
            recommendationCount: filtered.length,
          },
        });
      } catch (error) {
        console.error('Error fetching recommendations:', error);
        setRecommendations([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchRecommendations();
  }, [currentVehicleId, limit]);
  
  // Don't show anything if no recommendations
  if (!loading && recommendations.length === 0) {
    return null;
  }
  
  return (
    <div className={cn("w-full", className)}>
      <h2 className="mb-4 text-xl font-bold text-neutral-900 dark:text-white">{title}</h2>
      <VehicleGrid
        vehicles={recommendations}
        loading={loading}
        gridType="compact"
        hideIfEmpty
      />
    </div>
  );
}

/**
 * VehicleMarketplaceGrid Component
 * 
 * A specialized grid for the marketplace that emphasizes price
 * and ownership information alongside trust mechanisms.
 */
export function VehicleMarketplaceGrid({
  vehicles,
  className,
  loading = false,
  filterOwnershipType,
}: {
  vehicles: Vehicle[];
  className?: string;
  loading?: boolean;
  filterOwnershipType?: 'FULL' | 'FRACTIONAL' | 'ALL';
}) {
  // Filter vehicles by ownership type if specified
  const filteredVehicles = filterOwnershipType && filterOwnershipType !== 'ALL'
    ? vehicles.filter(v => v.ownershipType === filterOwnershipType)
    : vehicles;
    
  return (
    <VehicleGrid
      vehicles={filteredVehicles}
      loading={loading}
      gridType="marketplace"
      emptyStateMessage={
        filterOwnershipType === 'FRACTIONAL'
          ? "No fractional ownership vehicles available"
          : filterOwnershipType === 'FULL'
          ? "No full ownership vehicles available"
          : "No vehicles available in the marketplace"
      }
      className={className}
    />
  );
}
