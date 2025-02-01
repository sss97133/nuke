import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { Vehicle, VehicleHistoricalData } from "@/types/inventory";
import { VehicleHistory } from "./VehicleHistory";
import { VehicleDetails } from "./VehicleDetails";
import { RecordDetails } from "./RecordDetails";

export const VehicleProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const fetchVehicle = async () => {
      if (!id) return;

      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        toast({
          title: "Error fetching vehicle",
          description: error.message,
          variant: "destructive",
        });
        navigate("/");
        return;
      }

      if (!data) {
        toast({
          title: "Vehicle not found",
          description: "The requested vehicle could not be found.",
          variant: "destructive",
        });
        navigate("/");
        return;
      }

      setVehicle({
        id: data.id,
        vin: data.vin || undefined,
        make: data.make,
        model: data.model,
        year: data.year,
        notes: data.notes || undefined,
        images: undefined,
        createdBy: data.user_id || '',
        updatedBy: data.user_id || '',
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        historical_data: data.historical_data as VehicleHistoricalData | null
      });
      setLoading(false);
    };

    fetchVehicle();
  }, [id, navigate, toast]);

  const searchVehicleHistory = async () => {
    if (!vehicle) return;
    
    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('search-vehicle-history', {
        body: { vehicleId: vehicle.id }
      });

      if (error) throw error;

      // Refresh vehicle data to get updated historical_data
      const { data: updatedVehicle, error: fetchError } = await supabase
        .from("vehicles")
        .select("*")
        .eq("id", vehicle.id)
        .single();

      if (fetchError) throw fetchError;

      const historicalData = updatedVehicle.historical_data as VehicleHistoricalData;
      
      // Create a summary of what was found
      const summary = [];
      if (historicalData?.previousSales?.length) {
        summary.push(`${historicalData.previousSales.length} previous sales`);
      }
      if (historicalData?.modifications?.length) {
        summary.push(`${historicalData.modifications.length} modifications`);
      }
      if (historicalData?.notableHistory) {
        summary.push("notable history");
      }
      if (historicalData?.conditionNotes) {
        summary.push("condition notes");
      }

      setVehicle(prev => prev ? {
        ...prev,
        historical_data: historicalData
      } : null);

      toast({
        title: "Vehicle History Updated",
        description: summary.length > 0 
          ? `Found: ${summary.join(", ")}`
          : "No significant historical data found for this vehicle",
        variant: summary.length > 0 ? "default" : "destructive",
      });
    } catch (error) {
      console.error('Error searching vehicle history:', error);
      toast({
        title: "Error",
        description: "Failed to search vehicle history. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSearching(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <p className="text-[#283845] font-mono">Loading vehicle details...</p>
      </div>
    );
  }

  if (!vehicle) return null;

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <Button
          onClick={() => navigate("/")}
          variant="outline"
          className="font-mono text-sm"
        >
          ← Back to Vehicle List
        </Button>
      </div>

      <Card className="border-[#283845]">
        <CardHeader>
          <CardTitle className="text-2xl font-mono text-[#283845]">
            {vehicle.make} {vehicle.model} ({vehicle.year})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <VehicleDetails vehicle={vehicle} />
          
          <div className="pt-4 border-t border-[#283845]">
            <VehicleHistory 
              historicalData={vehicle.historical_data}
              onSearch={searchVehicleHistory}
              isSearching={searching}
            />
          </div>

          <RecordDetails 
            createdAt={vehicle.createdAt}
            updatedAt={vehicle.updatedAt}
          />
        </CardContent>
      </Card>
    </div>
  );
};