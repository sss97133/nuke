import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Car, Heart, Eye, Settings, CalendarDays, ShieldCheck, Medal, Wrench, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface VehicleStats {
  likes_count: number;
  views_count: number;
}

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  trim?: string;
  color?: string;
  image_url?: string;
  vehicle_stats?: VehicleStats;
  ownership_status: 'owned' | 'discovered' | 'claimed';
  is_serviced?: boolean;
}

interface VehicleCollectionProps {
  userId: string;
  isOwnProfile: boolean;
  filter?: string; // 'all', 'owned', 'discovered', 'recent'
}

export const VehicleCollection = ({ userId, isOwnProfile, filter = 'all' }: VehicleCollectionProps) => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchVehicles = async () => {
      setIsLoading(true);
      try {
        let query = supabase
          .from('vehicles')
          .select('*, vehicle_stats(*)')
          .eq('user_id', userId);

        if (filter === 'owned') {
          query = query.eq('status', 'owned');
        } else if (filter === 'discovered') {
          query = query.eq('status', 'discovered');
        } else if (filter === 'recent') {
          // No additional filter, just sort by most recent
        }

        let orderColumn = filter === 'recent' ? 'created_at' : 'created_at';
        const { data, error } = await query.order(orderColumn, { ascending: false });
        
        if (error) throw error;
        
        const mappedVehicles: Vehicle[] = (data || []).map(vehicle => ({
          id: vehicle.id,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          trim: vehicle.trim,
          color: vehicle.color,
          image_url: vehicle.icloud_album_link || vehicle.vin_image_url,
          vehicle_stats: vehicle.vehicle_stats,
          ownership_status: (vehicle.status as 'owned' | 'discovered' | 'claimed') || 'discovered',
          is_serviced: false,
        }));
        
        setVehicles(mappedVehicles);
      } catch (error) {
        console.error('Error fetching vehicles:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchVehicles();
  }, [userId, filter]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, index) => (
          <Skeleton key={index} className="h-[300px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (vehicles.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="space-y-4">
          <Car className="h-16 w-16 mx-auto text-muted-foreground/40" />
          <h3 className="text-lg font-medium">No vehicles found</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            {isOwnProfile 
              ? "You haven't added any vehicles to your collection yet." 
              : "This user hasn't added any vehicles to their collection yet."}
          </p>
          
          {isOwnProfile && (
            <Button 
              onClick={() => navigate('/vehicles/add')}
              className="mt-4"
            >
              Add Your First Vehicle
            </Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {vehicles.map(vehicle => (
          <VehicleCard 
            key={vehicle.id} 
            vehicle={vehicle} 
            isOwner={isOwnProfile} 
          />
        ))}
      </div>
      
      {vehicles.length > 0 && isOwnProfile && (
        <div className="flex justify-center mt-6">
          <Button 
            variant="outline" 
            onClick={() => navigate('/vehicles/add')}
          >
            Add Another Vehicle
          </Button>
        </div>
      )}
    </div>
  );
};

interface VehicleCardProps {
  vehicle: Vehicle;
  isOwner: boolean;
}

const VehicleCard = ({ vehicle, isOwner }: VehicleCardProps) => {
  const [likes, setLikes] = useState<number>(vehicle.vehicle_stats?.likes_count || 0);
  const [views, setViews] = useState<number>(vehicle.vehicle_stats?.views_count || 0);
  const [isLiked, setIsLiked] = useState<boolean>(false);
  const navigate = useNavigate();

  const getOwnershipBadge = () => {
    switch (vehicle.ownership_status) {
      case 'owned':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400">
            <ShieldCheck className="h-3 w-3 mr-1" />
            Owned
          </Badge>
        );
      case 'discovered':
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400">
            <Medal className="h-3 w-3 mr-1" />
            Discovered
          </Badge>
        );
      case 'claimed':
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-400">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Claimed
          </Badge>
        );
      default:
        return null;
    }
  };

  const handleLike = async () => {
    setIsLiked(!isLiked);
    setLikes(isLiked ? likes - 1 : likes + 1);
    
    // In a real implementation, this would call your API to update the like status
  };

  const handleViewDetails = () => {
    navigate(`/vehicles/${vehicle.id}`);
  };

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow duration-200">
      <div 
        className="aspect-[16/9] bg-muted relative cursor-pointer" 
        onClick={handleViewDetails}
      >
        {vehicle.image_url ? (
          <img 
            src={vehicle.image_url} 
            alt={`${vehicle.make} ${vehicle.model}`} 
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <Car className="h-16 w-16 text-muted-foreground/40" />
          </div>
        )}
        
        <div className="absolute top-2 right-2 flex gap-1">
          {getOwnershipBadge()}
        </div>
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/60 text-white px-2 py-1 rounded-md text-xs">
                <CalendarDays className="h-3 w-3" />
                {vehicle.year}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Year of manufacture</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        
        {vehicle.is_serviced && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="absolute bottom-2 right-2 bg-black/60 text-white p-1 rounded-md">
                  <Wrench className="h-3 w-3" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Recently serviced</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      
      <CardContent className="p-4">
        <h3 className="font-semibold truncate cursor-pointer hover:text-primary" onClick={handleViewDetails}>
          {vehicle.year} {vehicle.make} {vehicle.model}
        </h3>
        <p className="text-sm text-muted-foreground truncate">
          {vehicle.trim || 'Standard'} • {vehicle.color || 'Unknown color'}
        </p>
      </CardContent>
      
      <CardFooter className="px-4 py-2 border-t flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Button 
            variant="ghost" 
            size="sm" 
            className={`h-8 px-2 flex items-center gap-1 ${isLiked ? 'text-red-500' : ''}`}
            onClick={handleLike}
          >
            <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
            {likes}
          </Button>
          
          <span className="flex items-center gap-1">
            <Eye className="h-4 w-4" />
            {views}
          </span>
        </div>
        
        {isOwner && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 w-8 p-0"
            onClick={() => navigate(`/vehicles/${vehicle.id}/edit`)}
          >
            <Settings className="h-4 w-4" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};

export default VehicleCollection;
