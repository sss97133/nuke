import type { Database } from '../types';
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, Clock, AlertTriangle, Car, FileText, Image, History, ArrowLeft } from 'lucide-react';
import VehicleImageGallery from '@/components/vehicle-images/VehicleImageGallery';
import { Link } from 'react-router-dom';

interface HistoricalData {
  timestamp: string;
  value: number;
  source: string;
  confidence: number;
}

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  notes: string;
  status: string;
  user_id: string;
  historical_data?: HistoricalData[];
  // Add other fields as needed
}

const VehicleDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  
  useEffect(() => {
    const fetchVehicle = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        console.info('Vehicle ID:', id);
        
        const { data, error } = await supabase
          .from('vehicles')
          .select('*')
          .eq('id', id)
          .single();
        
        if (error) throw error;
        
        if (data) {
          console.info('Vehicle found in Supabase:', data);
          setVehicle(data);
        } else {
          setError('Vehicle not found');
        }
      } catch (err) {
        console.error('Error fetching vehicle:', err);
        setError('Failed to load vehicle details');
        toast({
          title: "Error",
          description: "Failed to load vehicle details. Please try again.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    
    fetchVehicle();
  }, [id, toast]);
  
  // Function to format VIN with proper spacing
  const formatVin = (vin: string) => {
    return vin ? vin.replace(/(.{3})/g, '$1 ').trim() : 'N/A';
  };
  
  // Function to capitalize first letter of each word
  const capitalize = (str: string) => {
    return str ? str.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ') : '';
  };
  
  if (loading) {
    return (
      <div className="container max-w-5xl py-6 space-y-6">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-[20rem] w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }
  
  if (error || !vehicle) {
    return (
      <div className="container max-w-5xl py-6">
        <Card className="border-destructive">
          <CardHeader>
            <div className="flex items-center text-destructive">
              <AlertTriangle className="mr-2 h-5 w-5" />
              <CardTitle>Error Loading Vehicle</CardTitle>
            </div>
            <CardDescription>
              We couldn't load the vehicle details. Please try again later.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p>{error || 'Unknown error occurred'}</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" asChild>
              <Link to="/vehicles">Back to Vehicles</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="container max-w-5xl py-6 space-y-6">
      {/* Navigation */}
      <div className="flex justify-between items-center">
        <Button variant="ghost" asChild>
          <Link to="/vehicles" className="flex items-center">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Vehicles
          </Link>
        </Button>
        
        <div className="flex space-x-2">
          <Button variant="outline">Edit</Button>
          <Button variant="outline">Service History</Button>
        </div>
      </div>
      
      {/* Vehicle Header */}
      <div className="flex flex-col space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          {vehicle.year} {capitalize(vehicle.make)} {capitalize(vehicle.model)}
        </h1>
        <div className="flex items-center text-muted-foreground">
          <span className="flex items-center mr-4">
            <Car className="mr-1 h-4 w-4" />
            VIN: {formatVin(vehicle.vin)}
          </span>
          <span className="flex items-center">
            <Clock className="mr-1 h-4 w-4" />
            Status: {capitalize(vehicle.status)}
          </span>
        </div>
      </div>
      
      {/* Tabs */}
      <Tabs defaultValue="gallery" className="space-y-6">
        <TabsList>
          <TabsTrigger value="gallery">
            <Image className="mr-2 h-4 w-4" />
            Gallery
          </TabsTrigger>
          <TabsTrigger value="details">
            <FileText className="mr-2 h-4 w-4" />
            Details
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-2 h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>
        
        {/* Gallery Tab */}
        <TabsContent value="gallery" className="space-y-6">
          <VehicleImageGallery 
            vehicleId={id as string} 
            key={id} // Add a key to force re-render when vehicle ID changes
          />
        </TabsContent>
        
        {/* Details Tab */}
        <TabsContent value="details" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Vehicle Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Make</p>
                    <p>{capitalize(vehicle.make)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Model</p>
                    <p>{capitalize(vehicle.model)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Year</p>
                    <p>{vehicle.year}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">VIN</p>
                    <p className="font-mono">{formatVin(vehicle.vin)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                {vehicle.notes ? (
                  <p className="text-sm leading-relaxed">{vehicle.notes}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No notes available</p>
                )}
              </CardContent>
              <CardFooter>
                <Button variant="outline" size="sm">Edit Notes</Button>
              </CardFooter>
            </Card>
          </div>
        </TabsContent>
        
        {/* History Tab */}
        <TabsContent value="history" className="space-y-6">
          {vehicle.historical_data ? (
            <Card>
              <CardHeader>
                <CardTitle>Vehicle History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm space-y-3">
                  {vehicle.historical_data.rawResponse && (
                    <pre className="bg-muted p-4 rounded-md overflow-auto max-h-96 text-xs whitespace-pre-wrap">
                      {vehicle.historical_data.rawResponse}
                    </pre>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Vehicle History</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">No historical data available for this vehicle.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default VehicleDetail;
