
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from "@/components/ui/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Vehicle } from '@/components/vehicles/discovery/types';
import VehicleDetailHeader from '@/components/vehicles/detail/VehicleDetailHeader';
import VehicleSpecifications from '@/components/vehicles/detail/VehicleSpecifications';
import VehicleHistory from '@/components/vehicles/detail/VehicleHistory';
import VehicleMarketData from '@/components/vehicles/detail/VehicleMarketData';
import VehicleGallery from '@/components/vehicles/detail/VehicleGallery';
import { ArrowLeft } from 'lucide-react';
import { mockVehicles } from '@/hooks/vehicles/mockVehicleData';

const VehicleDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch vehicle data directly from mockVehicles
  useEffect(() => {
    const fetchVehicle = async () => {
      try {
        setLoading(true);
        
        if (!id) {
          throw new Error("Vehicle ID is missing");
        }
        
        // Parse the ID to a number (our mock data uses number IDs)
        const vehicleId = parseInt(id);
        
        // Find the vehicle in the mock data
        const foundVehicle = mockVehicles.find(v => v.id === vehicleId);
        
        if (foundVehicle) {
          setVehicle(foundVehicle);
        } else {
          console.error(`Vehicle with ID ${vehicleId} not found in mock data`);
          toast({
            title: "Vehicle not found",
            description: `The vehicle with ID ${vehicleId} could not be found.`,
            variant: "destructive",
          });
          navigate("/discovered-vehicles");
        }
      } catch (error) {
        console.error("Error fetching vehicle:", error);
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
  }, [id, navigate, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <h1 className="text-2xl font-bold">Vehicle Not Found</h1>
        <p className="text-muted-foreground">The vehicle you are looking for does not exist.</p>
        <Button onClick={() => navigate("/discovered-vehicles")}>
          Return to Vehicles
        </Button>
      </div>
    );
  }

  return (
    <ScrollArea className="h-screen">
      <div className="container max-w-6xl p-6 space-y-6">
        <Button 
          variant="ghost" 
          onClick={() => navigate("/discovered-vehicles")}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Vehicles
        </Button>
        
        <VehicleDetailHeader vehicle={vehicle} />
        
        <Tabs defaultValue="details" className="w-full">
          <TabsList className="grid grid-cols-4 md:w-[400px]">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="gallery">Gallery</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="market">Market</TabsTrigger>
          </TabsList>
          
          <TabsContent value="details" className="mt-6">
            <VehicleSpecifications vehicle={vehicle} />
          </TabsContent>
          
          <TabsContent value="gallery" className="mt-6">
            <VehicleGallery vehicle={vehicle} />
          </TabsContent>
          
          <TabsContent value="history" className="mt-6">
            <VehicleHistory vehicle={vehicle} />
          </TabsContent>
          
          <TabsContent value="market" className="mt-6">
            <VehicleMarketData vehicle={vehicle} />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default VehicleDetail;
