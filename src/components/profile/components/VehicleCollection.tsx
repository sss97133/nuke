
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Car, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Vehicle = {
  id: string;
  make: string;
  model: string;
  year: number;
  trim?: string;
  color?: string;
  image_url?: string;
  ownership_status: 'owned' | 'discovered' | 'claimed';
  vehicle_stats: {
    likes_count: number;
    views_count: number;
  };
};

interface VehicleCollectionProps {
  userId: string;
  isOwnProfile: boolean;
  filter?: string; // Add optional filter prop
}

const VehicleCollection: React.FC<VehicleCollectionProps> = ({ userId, isOwnProfile, filter = 'all' }) => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchVehicles = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('*')
          .eq('user_id', userId);
        
        if (error) {
          console.error('Error fetching vehicles:', error);
          return;
        }
        
        // Transform the data to match the Vehicle type with proper defaults
        const transformedVehicles: Vehicle[] = data.map(vehicle => ({
          id: vehicle.id,
          make: vehicle.make || 'Unknown',
          model: vehicle.model || 'Unknown',
          year: vehicle.year || 0,
          trim: vehicle.trim || undefined,
          color: vehicle.color || undefined,
          image_url: vehicle.image_url || undefined,
          ownership_status: (vehicle.status as 'owned' | 'discovered' | 'claimed') || 'discovered',
          vehicle_stats: {
            likes_count: vehicle.likes_count || 0,
            views_count: vehicle.views_count || 0
          }
        }));
        
        setVehicles(transformedVehicles);
      } catch (error) {
        console.error('Error in fetch operation:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchVehicles();
  }, [userId]);
  
  const handleAddVehicle = () => {
    navigate('/add-vehicle');
  };
  
  if (isLoading) {
    return (
      <Card className="p-8">
        <div className="flex justify-center">
          <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
        </div>
      </Card>
    );
  }
  
  // Filter vehicles based on the filter prop
  const filteredVehicles = filter === 'all' 
    ? vehicles 
    : filter === 'recent'
      ? [...vehicles].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 5) // Sort by ID as proxy for recency
      : vehicles.filter(v => v.ownership_status === filter);
  
  if (filteredVehicles.length === 0) {
    return (
      <Card className="p-8">
        <CardContent className="flex flex-col items-center justify-center pt-6">
          <Car className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No vehicles yet</h3>
          <p className="text-muted-foreground text-center mb-6">
            {isOwnProfile 
              ? filter !== 'all' 
                ? `You haven't added any ${filter} vehicles to your collection yet.`
                : "You haven't added any vehicles to your collection yet."
              : filter !== 'all'
                ? `This user hasn't added any ${filter} vehicles to their collection yet.`
                : "This user hasn't added any vehicles to their collection yet."}
          </p>
          
          {isOwnProfile && (
            <Button onClick={handleAddVehicle}>
              <Plus className="mr-2 h-4 w-4" />
              Add Vehicle
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Vehicles ({filteredVehicles.length})</h3>
        {isOwnProfile && (
          <Button onClick={handleAddVehicle} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add Vehicle
          </Button>
        )}
      </div>
      
      {!filter && (
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="owned">Owned</TabsTrigger>
            <TabsTrigger value="claimed">Claimed</TabsTrigger>
            <TabsTrigger value="discovered">Discovered</TabsTrigger>
          </TabsList>
          
          <TabsContent value="all" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {vehicles.map(vehicle => (
                <VehicleCard key={vehicle.id} vehicle={vehicle} />
              ))}
            </div>
          </TabsContent>
          
          <TabsContent value="owned" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {vehicles
                .filter(v => v.ownership_status === 'owned')
                .map(vehicle => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))
              }
            </div>
          </TabsContent>
          
          <TabsContent value="claimed" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {vehicles
                .filter(v => v.ownership_status === 'claimed')
                .map(vehicle => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))
              }
            </div>
          </TabsContent>
          
          <TabsContent value="discovered" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {vehicles
                .filter(v => v.ownership_status === 'discovered')
                .map(vehicle => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))
              }
            </div>
          </TabsContent>
        </Tabs>
      )}
      
      {filter && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredVehicles.map(vehicle => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </div>
      )}
    </div>
  );
};

interface VehicleCardProps {
  vehicle: Vehicle;
}

const VehicleCard: React.FC<VehicleCardProps> = ({ vehicle }) => {
  return (
    <Card className="overflow-hidden">
      <div className="aspect-video bg-muted flex items-center justify-center">
        {vehicle.image_url ? (
          <img 
            src={vehicle.image_url} 
            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            className="object-cover w-full h-full"
          />
        ) : (
          <Car className="h-12 w-12 text-muted-foreground opacity-50" />
        )}
      </div>
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-2">
          <h3 className="font-semibold">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </h3>
          <div>
            {vehicle.ownership_status === 'owned' && (
              <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                Owned
              </span>
            )}
            {vehicle.ownership_status === 'claimed' && (
              <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                Claimed
              </span>
            )}
            {vehicle.ownership_status === 'discovered' && (
              <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
                Discovered
              </span>
            )}
          </div>
        </div>
        <div className="text-sm text-muted-foreground mb-4">
          {vehicle.trim && <p>Trim: {vehicle.trim}</p>}
          {vehicle.color && <p>Color: {vehicle.color}</p>}
          <div className="flex gap-4 mt-2">
            <span className="flex items-center gap-1">
              <span role="img" aria-label="likes">👍</span> {vehicle.vehicle_stats.likes_count}
            </span>
            <span className="flex items-center gap-1">
              <span role="img" aria-label="views">👁️</span> {vehicle.vehicle_stats.views_count}
            </span>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to={`/vehicles/${vehicle.id}`}>View Details</Link>
        </Button>
      </CardContent>
    </Card>
  );
};

export default VehicleCollection;
