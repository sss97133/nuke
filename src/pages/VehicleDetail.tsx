
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from "@/components/ui/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import VehicleDetailHeader from '@/components/vehicles/detail/VehicleDetailHeader';
import VehicleSpecifications from '@/components/vehicles/detail/VehicleSpecifications';
import VehicleHistory from '@/components/vehicles/detail/VehicleHistory';
import VehicleMarketData from '@/components/vehicles/detail/VehicleMarketData';
import VehicleGallery from '@/components/vehicles/detail/VehicleGallery';
import VehicleComments from '@/components/vehicles/detail/VehicleComments';
import { ArrowLeft } from 'lucide-react';
import { useVehicleDetail } from '@/hooks/vehicles/useVehicleDetail';

const VehicleDetail = () => {
  const { id } = useParams<{ id: string; }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { vehicle, loading, error } = useVehicleDetail(id || '');

  if (loading) {
    return <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>;
  }

  if (error || !vehicle) {
    return <div className="flex flex-col items-center justify-center h-screen gap-4">
        <h1 className="text-2xl font-bold">Vehicle Not Found</h1>
        <p className="text-muted-foreground">The vehicle you are looking for does not exist.</p>
        <Button onClick={() => navigate("/discovered-vehicles")}>
          Return to Vehicles
        </Button>
      </div>;
  }

  return (
    <ScrollArea className="h-screen">
      <div className="container max-w-7xl p-4 space-y-6">
        <Button variant="ghost" onClick={() => navigate("/discovered-vehicles")} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Vehicles
        </Button>
        
        <VehicleDetailHeader vehicle={vehicle} />
        
        {/* Main content area with editorial layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Tabs for vehicle details, history, market data */}
            <Tabs defaultValue="editorial" className="w-full">
              <TabsList className="grid grid-cols-3 w-full lg:w-auto">
                <TabsTrigger value="editorial">Editorial</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
                <TabsTrigger value="market">Market</TabsTrigger>
              </TabsList>
              
              <TabsContent value="editorial" className="mt-4 prose max-w-none">
                <h2 className="text-xl font-semibold mb-3">About this {vehicle.make} {vehicle.model}</h2>
                <p>This {vehicle.year} {vehicle.make} {vehicle.model} represents one of the finest examples of automotive craftsmanship from its era. With its distinctive {vehicle.body_type} styling and powerful {vehicle.engine_type} engine, this vehicle combines performance and aesthetics in a package that continues to captivate enthusiasts today.</p>
                
                <p>Maintained in excellent condition with a rating of {vehicle.condition_rating}/10, this vehicle showcases the enduring appeal of {vehicle.era || "classic"} automotive design. The {vehicle.transmission} transmission paired with its {vehicle.drivetrain} drivetrain delivers a driving experience that remains engaging and responsive.</p>
                
                <p>With {vehicle.mileage.toLocaleString()} miles on the odometer, this vehicle has been well-used but carefully maintained throughout its life. Its current market value of ${vehicle.market_value?.toLocaleString()} reflects both its inherent quality and the growing collector interest in vehicles of this type.</p>
              </TabsContent>
              
              <TabsContent value="history" className="mt-4">
                <VehicleHistory vehicle={vehicle} />
              </TabsContent>
              
              <TabsContent value="market" className="mt-4">
                <VehicleMarketData vehicle={vehicle} />
              </TabsContent>
            </Tabs>
            
            {/* Gallery Section - Always visible, without redundant headers */}
            <div className="space-y-4">
              <VehicleGallery vehicle={vehicle} />
            </div>
            
            {/* Comments Section - Always follows the gallery */}
            <div className="space-y-4">
              <VehicleComments vehicle={vehicle} />
            </div>
          </div>
          
          {/* Sidebar with specifications */}
          <div className="lg:col-span-1">
            <VehicleSpecifications vehicle={vehicle} />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
};

export default VehicleDetail;
