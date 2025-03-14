
import type { Database } from '../types';
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Car, Calendar, MapPin, Plus, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { LoadingState } from '@/components/skills/LoadingState';

type DiscoveredVehicle = {
  id: string;
  make: string;
  model: string;
  year: number;
  price?: string;
  source: string;
  location?: string;
  created_at: string;
  status: 'verified' | 'unverified';
};

export const UserDiscoveredVehicles = ({ userId }: { userId: string }) => {
  const { toast } = useToast();
  
  const { data: vehicles, isLoading, error } = useQuery({
    queryKey: ['user-discovered-vehicles', userId],
    queryFn: async () => {
      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        .from('discovered_vehicles')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5);
      
      if (error) {
        console.error('Error fetching discovered vehicles:', error);
        throw error;
      }
      
      return data as DiscoveredVehicle[];
    },
    meta: {
      onError: (error: Error) => {
        toast({
          title: 'Error',
          description: 'Failed to load discovered vehicles',
          variant: 'destructive',
        });
      }
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Discovered Vehicles</CardTitle>
        </CardHeader>
        <CardContent>
          <LoadingState />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Discovered Vehicles</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive">Failed to load discovered vehicles</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Discovered Vehicles</CardTitle>
        <Link to="/dashboard/discovered-vehicles">
          <Button variant="ghost" size="sm">
            View All
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {vehicles && vehicles.length > 0 ? (
          <div className="space-y-4">
            {vehicles.map((vehicle) => (
              <div key={vehicle.id} className="flex items-start border-b pb-3 last:border-0">
                <div className="bg-muted rounded-full p-2 mr-3">
                  <Car className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <h4 className="font-medium">{vehicle.year} {vehicle.make} {vehicle.model}</h4>
                  <div className="flex flex-wrap text-sm text-muted-foreground gap-x-4 mt-1">
                    {vehicle.price && (
                      <span>{vehicle.price}</span>
                    )}
                    <span className="flex items-center">
                      <Calendar className="mr-1 h-3 w-3" />
                      {new Date(vehicle.created_at).toLocaleDateString()}
                    </span>
                    {vehicle.location && (
                      <span className="flex items-center">
                        <MapPin className="mr-1 h-3 w-3" />
                        {vehicle.location}
                      </span>
                    )}
                  </div>
                </div>
                <div className="bg-primary/10 text-xs px-2 py-1 rounded-full">
                  {vehicle.status === 'verified' ? 'Verified' : 'Unverified'}
                </div>
              </div>
            ))}
            
            <div className="flex justify-center pt-2">
              <Link to="/dashboard/discovered-vehicles">
                <Button className="w-full" variant="outline">
                  View All Discoveries
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <Car className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-medium mb-2">No vehicles discovered yet</h3>
            <p className="text-muted-foreground mb-4">
              Start discovering interesting vehicles across the web
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/dashboard/discovered-vehicles">
                <Button className="flex items-center gap-2" variant="default">
                  <Plus className="h-4 w-4" />
                  Add Manually
                </Button>
              </Link>
              <Link to="/dashboard/plugin-download">
                <Button className="flex items-center gap-2" variant="outline">
                  <ExternalLink className="h-4 w-4" />
                  Get Plugin
                </Button>
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
