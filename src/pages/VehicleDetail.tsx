
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
  const {
    id
  } = useParams<{
    id: string;
  }>();
  const navigate = useNavigate();
  const {
    toast
  } = useToast();
  const {
    vehicle,
    loading,
    error
  } = useVehicleDetail(id || '');

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

  return <ScrollArea className="h-screen">
      <div className="container max-w-6xl p-6 space-y-8">
        <Button variant="ghost" onClick={() => navigate("/discovered-vehicles")} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Vehicles
        </Button>
        
        <VehicleDetailHeader vehicle={vehicle} />
        
        {/* Main Vehicle Information Tabs */}
        <Tabs defaultValue="details" className="w-full">
          <TabsList className="grid grid-cols-3 md:w-[300px]">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="market">Market</TabsTrigger>
          </TabsList>
          
          <TabsContent value="details" className="mt-6">
            <VehicleSpecifications vehicle={vehicle} />
          </TabsContent>
          
          <TabsContent value="history" className="mt-6">
            <VehicleHistory vehicle={vehicle} />
          </TabsContent>
          
          <TabsContent value="market" className="mt-6">
            <VehicleMarketData vehicle={vehicle} />
          </TabsContent>
        </Tabs>
        
        {/* Gallery Section - Always visible */}
        <div className="mt-8 pt-4 border-t border-border">
          <h2 className="text-2xl font-bold mb-6">Vehicle Gallery</h2>
          <VehicleGallery vehicle={vehicle} />
        </div>
        
        {/* Comments Section - Always follows the gallery */}
        <div className="mt-8 pt-4 border-t border-border">
          <VehicleComments vehicle={vehicle} />
        </div>
      </div>
    </ScrollArea>;
};

export default VehicleDetail;
