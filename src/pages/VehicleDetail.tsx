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
import VehicleComments from '@/components/vehicles/detail/VehicleComments';
import { ArrowLeft } from 'lucide-react';
import { mockVehicles } from '@/hooks/vehicles/mockVehicleData';
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
          <TabsList className="grid grid-cols-4 md:w-[400px]">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="market">Market</TabsTrigger>
            <TabsTrigger value="gallery">Gallery</TabsTrigger>
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
          
          <TabsContent value="gallery" className="mt-6">
            <VehicleGallery vehicle={vehicle} />
          </TabsContent>
        </Tabs>
        
        {/* Comments Section - Always visible, not in tabs */}
        <div className="mt-12 pt-6 border-t border-border">
          <h2 className="text-2xl font-bold mb-6"></h2>
          <VehicleComments vehicle={vehicle} />
        </div>
      </div>
    </ScrollArea>;
};
export default VehicleDetail;