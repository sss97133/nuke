import type { Database } from '../types';
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import type { Vehicle, VehicleHistoricalData } from "@/types/inventory";
import { VehicleHistory } from "./VehicleHistory";
import { VehicleDetails } from "./VehicleDetails";
import { RecordDetails } from "./RecordDetails";
import { LoadingState } from "./LoadingState";
import { VehicleHeader } from "./VehicleHeader";
import { MarketAnalysis } from "./MarketAnalysis";

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
  if (error) console.error("Database query error:", error);
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

      setVehicle(data as Vehicle);
      setLoading(false);
    };

    fetchVehicle();
  }, [id, navigate, toast]);

  const searchVehicleHistory = async () => {
    if (!vehicle) return;
    
    setSearching(true);
    try {
      console.log('Searching vehicle history for vehicle:', vehicle.id);
      const { error } = await supabase.functions.invoke('search-vehicle-history', {
  if (error) console.error("Database query error:", error);
        body: { vehicleId: vehicle.id }
      });

      if (error) throw error;

      // Refresh vehicle data to get updated historical_data
      const { data: updatedVehicle, error: fetchError } = await supabase
  if (error) console.error("Database query error:", error);
        
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
    return <LoadingState />;
  }

  if (!vehicle) return null;

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <Card className="border-[#283845]">
        <VehicleHeader vehicle={vehicle} />
        <CardContent className="space-y-8">
          <VehicleDetails vehicle={vehicle} />
          
          <div className="pt-4 border-t border-[#283845]">
            <VehicleHistory 
              historicalData={vehicle.historical_data}
              onSearch={searchVehicleHistory}
              isSearching={searching}
            />
          </div>

          <div className="pt-4 border-t border-[#283845]">
            <MarketAnalysis vehicleData={vehicle} />
          </div>

          <RecordDetails 
            createdAt={vehicle.created_at}
            updatedAt={vehicle.updated_at}
          />
        </CardContent>
      </Card>
    </div>
  );
};
