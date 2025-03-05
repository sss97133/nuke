import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useVehicleRelationships } from './hooks/useVehicleRelationships';
import { Car, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

interface VehicleRelationshipsSectionProps {
  userId: string;
}

export const VehicleRelationshipsSection = ({ userId }: VehicleRelationshipsSectionProps) => {
  const { vehicles, isLoading, error } = useVehicleRelationships(userId);
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            Vehicle Relationships
          </CardTitle>
          <CardDescription>Loading your vehicle relationships...</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
        </CardContent>
      </Card>
    );
  }
  
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            Vehicle Relationships
          </CardTitle>
          <CardDescription>There was an error loading your vehicles</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center py-8">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <p className="text-muted-foreground mb-4">We couldn't load your vehicles. Please try again later.</p>
          <Button variant="outline">Retry</Button>
        </CardContent>
      </Card>
    );
  }
  
  const hasVehicles = vehicles.all.length > 0;
  
  if (!hasVehicles) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            Vehicle Relationships
          </CardTitle>
          <CardDescription>You don't have any vehicles yet</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center py-8">
          <Car className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">Start discovering vehicles to build your collection</p>
          <Link to="/discovered-vehicles">
            <Button>Discover Vehicles</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Car className="h-5 w-5" />
          Vehicle Relationships
        </CardTitle>
        <CardDescription>
          Vehicles you've discovered, claimed, or verified ownership of
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="all">
          <TabsList className="mb-4">
            <TabsTrigger value="all">
              All ({vehicles.all.length})
            </TabsTrigger>
            <TabsTrigger value="verified">
              Verified ({vehicles.verified.length})
            </TabsTrigger>
            <TabsTrigger value="claimed">
              Claimed ({vehicles.claimed.length})
            </TabsTrigger>
            <TabsTrigger value="discovered">
              Discovered ({vehicles.discovered.length})
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="all" className="mt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {vehicles.all.map(vehicle => (
                <VehicleCard key={vehicle.id} vehicle={vehicle} />
              ))}
            </div>
          </TabsContent>
          
          <TabsContent value="verified" className="mt-0">
            {vehicles.verified.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {vehicles.verified.map(vehicle => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">You don't have any verified vehicles yet</p>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="claimed" className="mt-0">
            {vehicles.claimed.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {vehicles.claimed.map(vehicle => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">You don't have any claimed vehicles pending verification</p>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="discovered" className="mt-0">
            {vehicles.discovered.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {vehicles.discovered.map(vehicle => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Car className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">You haven't discovered any vehicles yet</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

interface VehicleCardProps {
  vehicle: any;
}

const VehicleCard = ({ vehicle }: VehicleCardProps) => {
  // Determine badge color based on relationship
  const getBadgeStyle = (relationship?: string) => {
    switch (relationship) {
      case 'verified':
        return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'claimed':
        return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
      case 'discovered':
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };
  
  // Get badge icon
  const getBadgeIcon = (relationship?: string) => {
    switch (relationship) {
      case 'verified':
        return <CheckCircle className="h-3 w-3" />;
      case 'claimed':
        return <Clock className="h-3 w-3" />;
      case 'discovered':
        return <Car className="h-3 w-3" />;
      default:
        return null;
    }
  };

  return (
    <Link to={`/vehicle/${vehicle.id}`} className="no-underline">
      <div className="border rounded-lg overflow-hidden bg-card h-full flex flex-col hover:border-primary/50 transition-colors">
        <div className="aspect-video bg-muted relative">
          {vehicle.image_url ? (
            <img 
              src={vehicle.image_url} 
              alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              className="object-cover w-full h-full"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Car className="h-12 w-12 text-muted-foreground/40" />
            </div>
          )}
          
          <div className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-medium flex items-center gap-1 border ${getBadgeStyle(vehicle.relationship)}`}>
            {getBadgeIcon(vehicle.relationship)}
            {vehicle.relationship ? vehicle.relationship.charAt(0).toUpperCase() + vehicle.relationship.slice(1) : 'Unknown'}
          </div>
        </div>
        
        <div className="p-4 flex-1 flex flex-col">
          <h3 className="font-medium text-lg">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
          {vehicle.trim && <p className="text-sm text-muted-foreground">{vehicle.trim}</p>}
          
          <div className="flex justify-between items-center mt-auto pt-4">
            <div className="text-sm">
              {vehicle.status && (
                <span className="text-muted-foreground">Status: {vehicle.status}</span>
              )}
            </div>
            <Button size="sm" variant="ghost">View</Button>
          </div>
        </div>
      </div>
    </Link>
  );
};
