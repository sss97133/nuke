import React from 'react';
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Clock, MapPin, Tag, ExternalLink } from "lucide-react";
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from 'date-fns';

interface VehicleCollectionProps {
  userId: string;
  isOwnProfile: boolean;
  filter: string;
}

interface TimelineEvent {
  id: string;
  vehicle_id: string;
  event_type: string;
  source: string;
  event_date: string;
  title: string;
  description: string;
  confidence_score: number;
  metadata: any;
  source_url: string;
  image_urls: string[];
  created_at: string;
}

interface EnhancedVehicle {
  id: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  user_id: string;
  image_url?: string;
  status?: string;
  color?: string;
  public_vehicle?: boolean;
  created_at: string;
  updated_at: string;
  likes_count?: number;
  views_count?: number;
  timelineEvents?: TimelineEvent[];
  primaryImage?: string;
  recentActivity?: string;
  eventCount?: number;
  source?: string;
  source_url?: string;
}

const VehicleCollection: React.FC<VehicleCollectionProps> = ({ 
  userId,
  isOwnProfile,
  filter
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [vehicles, setVehicles] = React.useState<EnhancedVehicle[]>([]);
  const [loading, setLoading] = React.useState(true);
  
  React.useEffect(() => {
    const fetchVehicles = async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('vehicles')
          .select('*');

        // First, handle user-specific filters
        if (filter === 'owned') {
          query = query.eq('user_id', userId);
        } else if (filter === 'claimed') {
          // We'll implement claimed vehicles later
          query = query.eq('user_id', userId);
        } else if (filter === 'discovered') {
          // In the future, we'll track discoveries
          query = query.eq('user_id', userId);
        } else {
          // For 'all', show owned vehicles and public vehicles
          query = query.or(`user_id.eq.${userId},public_vehicle.eq.true`);
        }

        const { data: vehiclesData, error } = await query;

        if (error) {
          throw error;
        }

        // If we have vehicles, fetch the timeline events for each vehicle
        const enhancedVehicles: EnhancedVehicle[] = [];
        
        if (vehiclesData && vehiclesData.length > 0) {
          // Get all vehicle IDs
          const vehicleIds = vehiclesData.map(v => v.id);
          
          // Fetch timeline events for all vehicles in one query
          const { data: timelineEvents, error: timelineError } = await supabase
            .from('vehicle_timeline_events')
            .select('*')
            .in('vehicle_id', vehicleIds)
            .order('event_date', { ascending: false });
            
          if (timelineError) {
            console.error('Error fetching timeline events:', timelineError);
          }
          
          // Group timeline events by vehicle ID
          const eventsByVehicle: Record<string, TimelineEvent[]> = {};
          timelineEvents?.forEach(event => {
            if (!eventsByVehicle[event.vehicle_id]) {
              eventsByVehicle[event.vehicle_id] = [];
            }
            eventsByVehicle[event.vehicle_id].push(event);
          });
          
          // Enhance vehicles with timeline data
          vehiclesData.forEach(vehicle => {
            const vehicleEvents = eventsByVehicle[vehicle.id] || [];
            const sortedEvents = [...vehicleEvents].sort((a, b) => 
              new Date(b.event_date).getTime() - new Date(a.event_date).getTime()
            );
            
            // Find a primary image from timeline events
            let primaryImage = vehicle.image_url;
            if (!primaryImage && vehicleEvents.length > 0) {
              for (const event of vehicleEvents) {
                if (event.image_urls && event.image_urls.length > 0) {
                  primaryImage = event.image_urls[0];
                  break;
                }
              }
            }
            
            // Add to enhanced vehicles
            enhancedVehicles.push({
              ...vehicle,
              timelineEvents: sortedEvents,
              primaryImage,
              eventCount: vehicleEvents.length,
              recentActivity: sortedEvents[0]?.event_date,
              source: sortedEvents[0]?.source || 'manual'
            });
          });
        }

        setVehicles(enhancedVehicles);
      } catch (error) {
        console.error('Error fetching vehicles:', error);
        toast({
          title: "Error loading vehicles",
          description: "Failed to load your vehicle collection. Please try again.",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };
    
    fetchVehicles();
  }, [userId, filter, toast]);
  
  const handleAddVehicle = () => {
    navigate('/add-vehicle');
  };
  
  const handleVehicleClick = (vehicleId: string) => {
    console.log('Vehicle card clicked:', {
      vehicleId,
      currentPath: window.location.pathname,
      timestamp: new Date().toISOString()
    });
    
    try {
      const targetPath = `/vehicles/${vehicleId}`;
      console.log('Attempting navigation to:', targetPath);
      navigate(targetPath);
      console.log('Navigation completed');
    } catch (error) {
      console.error('Navigation error:', error);
    }
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {vehicles.map((vehicle) => (
          <Card 
            key={vehicle.id} 
            className="overflow-hidden hover:shadow-md transition-all cursor-pointer group"
            onClick={(e) => {
              console.log('Card clicked:', {
                vehicleId: vehicle.id,
                event: e,
                timestamp: new Date().toISOString()
              });
              handleVehicleClick(vehicle.id);
            }}
          >
            <div className="h-52 bg-muted relative overflow-hidden">
              <img 
                src={vehicle.primaryImage || vehicle.image_url || "/placeholder.svg"} 
                alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
                onError={(e) => {
                  // Fallback for image loading errors
                  e.currentTarget.src = "/placeholder.svg";
                }}
              />
              <div className="absolute top-2 right-2 flex gap-1">
                {vehicle.public_vehicle && (
                  <Badge variant="secondary" className="text-xs font-medium">
                    Public
                  </Badge>
                )}
                <Badge 
                  variant={vehicle.user_id === userId ? "default" : "outline"}
                  className="bg-background/80 text-xs font-medium"
                >
                  {vehicle.user_id === userId ? "Owned" : "Public"}
                </Badge>
              </div>
              {vehicle.source && (
                <div className="absolute bottom-2 left-2">
                  <Badge variant="outline" className="bg-background/80 text-xs font-medium">
                    {vehicle.source === 'bat' ? 'Bring a Trailer' : vehicle.source}
                  </Badge>
                </div>
              )}
            </div>
            <CardContent className="p-4 pt-3">
              <div className="flex justify-between items-start mb-1">
                <h3 className="font-semibold text-base leading-tight line-clamp-1 flex-1">
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </h3>
                {(vehicle.eventCount && vehicle.eventCount > 0) && (
                  <Badge variant="secondary" className="text-xs font-medium ml-1 whitespace-nowrap">
                    {vehicle.eventCount} {vehicle.eventCount === 1 ? 'event' : 'events'}
                  </Badge>
                )}
              </div>
              
              {/* Timeline preview */}
              {vehicle.timelineEvents && vehicle.timelineEvents.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {vehicle.timelineEvents.slice(0, 2).map((event, index) => (
                    <div key={event.id} className="flex items-start gap-2 text-sm">
                      <div className="mt-0.5">
                        {event.event_type === 'listing' && <Tag className="h-3.5 w-3.5 text-primary" />}
                        {event.event_type === 'sale' && <MapPin className="h-3.5 w-3.5 text-green-500" />}
                        {event.event_type === 'maintenance' && <Tag className="h-3.5 w-3.5 text-amber-500" />}
                        {!['listing', 'sale', 'maintenance'].includes(event.event_type) && 
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 leading-tight">
                        <p className="font-medium text-xs line-clamp-1">{event.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {event.event_date ? formatDistanceToNow(new Date(event.event_date), { addSuffix: true }) : 'Date unknown'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-2">
                  {vehicle.vin ? `VIN: ${vehicle.vin}` : "No timeline data available"}
                </p>
              )}
            </CardContent>
            <CardFooter className="px-4 py-2 border-t flex justify-between bg-muted/30">
              <div className="flex items-center text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5 mr-1" />
                <span>
                  {vehicle.recentActivity 
                    ? formatDistanceToNow(new Date(vehicle.recentActivity), { addSuffix: true })
                    : 'No recent activity'}
                </span>
              </div>
              {vehicle.source_url && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" asChild>
                  <a 
                    href={vehicle.source_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Source
                  </a>
                </Button>
              )}
            </CardFooter>
          </Card>
        ))}
        
        {isOwnProfile && (
          <Card 
            className="flex items-center justify-center h-[340px] border-dashed cursor-pointer hover:bg-accent/10 transition-colors"
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
