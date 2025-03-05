
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";
import { useNavigate } from 'react-router-dom';

interface VehicleCollectionProps {
  userId: string;
  isOwnProfile: boolean;
  filter: string; // Add filter prop
}

const VehicleCollection: React.FC<VehicleCollectionProps> = ({ 
  userId,
  isOwnProfile,
  filter
}) => {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  
  React.useEffect(() => {
    // Simulate fetching vehicles with a delay
    const fetchVehicles = async () => {
      setLoading(true);
      try {
        // This would be a real API call in a production app
        // Simulating API delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Mock data
        const mockVehicles = Array(6).fill(null).map((_, i) => ({
          id: `vehicle-${i}`,
          make: ['Toyota', 'Honda', 'Ford', 'BMW', 'Tesla', 'Audi'][i % 6],
          model: ['Corolla', 'Civic', 'F-150', 'X5', 'Model 3', 'A4'][i % 6],
          year: 2018 + (i % 5),
          status: ['owned', 'claimed', 'discovered'][i % 3],
          likes_count: Math.floor(Math.random() * 50),
          views_count: Math.floor(Math.random() * 200),
          color: ['Red', 'Blue', 'Black', 'White', 'Silver', 'Green'][i % 6],
          image_url: `/placeholder.svg`
        }));
        
        // Filter vehicles based on the filter prop
        let filteredVehicles = mockVehicles;
        if (filter !== 'all') {
          filteredVehicles = mockVehicles.filter(v => v.status === filter);
        }
        
        setVehicles(filteredVehicles);
      } catch (error) {
        console.error('Error fetching vehicles:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchVehicles();
  }, [userId, filter]);
  
  const handleAddVehicle = () => {
    navigate('/add-vehicle');
  };
  
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {Array(6).fill(null).map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <Skeleton className="h-48 w-full" />
            <CardContent className="p-4">
              <Skeleton className="h-6 w-2/3 mb-2" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  
  if (vehicles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground mb-4">
          {filter === 'all' 
            ? 'No vehicles in collection yet.' 
            : `No ${filter} vehicles in collection.`}
        </p>
        {isOwnProfile && (
          <Button onClick={handleAddVehicle}>
            <Plus className="h-4 w-4 mr-2" />
            Add Vehicle
          </Button>
        )}
      </div>
    );
  }
  
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {vehicles.map((vehicle) => (
          <Card key={vehicle.id} className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer">
            <div className="h-48 bg-muted relative overflow-hidden">
              <img 
                src={vehicle.image_url || "/placeholder.svg"} 
                alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                className="w-full h-full object-cover" 
              />
              <div className="absolute top-2 right-2 bg-background/80 text-xs font-medium px-2 py-1 rounded">
                {vehicle.status || "owned"}
              </div>
            </div>
            <CardContent className="p-4">
              <h3 className="font-medium truncate">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h3>
              <p className="text-sm text-muted-foreground truncate">
                {vehicle.color || "No color specified"}
              </p>
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span>{vehicle.likes_count || 0} likes</span>
                <span>{vehicle.views_count || 0} views</span>
              </div>
            </CardContent>
          </Card>
        ))}
        
        {isOwnProfile && (
          <Card 
            className="flex items-center justify-center h-[280px] border-dashed cursor-pointer hover:bg-accent/10 transition-colors"
            onClick={handleAddVehicle}
          >
            <div className="flex flex-col items-center justify-center text-muted-foreground">
              <Plus className="h-10 w-10 mb-2" />
              <span>Add Vehicle</span>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default VehicleCollection;
