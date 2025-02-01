import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { Vehicle } from "@/types/inventory";
import { Loader2 } from "lucide-react";

interface VehicleHistory {
  previousSales?: Array<{
    date?: string;
    price?: string;
    source?: string;
  }>;
  modifications?: string[];
  notableHistory?: string;
  conditionNotes?: string;
}

export const VehicleProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();

Let me help you clean up the display of the historical data in the VehicleProfile component. The issue is that the raw JSON response from the Perplexity API might contain HTML tags or unformatted content. We'll format it properly and display it in a more structured way.

<lov-code>
Let's update the VehicleProfile component to better format and display the historical data:

<lov-write file_path="src/components/vehicles/VehicleProfile.tsx">
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { Vehicle } from "@/types/inventory";
import { Loader2 } from "lucide-react";

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
        historical_data: data.historical_data
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

      setVehicle(prev => prev ? {
        ...prev,
        historical_data: updatedVehicle.historical_data
      } : null);

      toast({
        title: "Success",
        description: "Vehicle history has been updated",
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

  const renderHistoricalData = () => {
    if (!vehicle?.historical_data) return null;

    const data = vehicle.historical_data;
    return (
      <div className="space-y-4">
        {data.previousSales && data.previousSales.length > 0 && (
          <div>
            <h4 className="font-mono text-sm font-semibold mb-2">Previous Sales</h4>
            <div className="space-y-2">
              {data.previousSales.map((sale: any, index: number) => (
                <div key={index} className="bg-gray-50 p-3 rounded-md">
                  <p className="font-mono text-sm">
                    Date: {sale.date || 'N/A'}
                  </p>
                  <p className="font-mono text-sm">
                    Price: {sale.price || 'N/A'}
                  </p>
                  {sale.source && (
                    <p className="font-mono text-sm">
                      Source: {sale.source}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.modifications && data.modifications.length > 0 && (
          <div>
            <h4 className="font-mono text-sm font-semibold mb-2">Modifications</h4>
            <ul className="list-disc list-inside space-y-1">
              {data.modifications.map((mod: string, index: number) => (
                <li key={index} className="font-mono text-sm">{mod}</li>
              ))}
            </ul>
          </div>
        )}

        {data.notableHistory && (
          <div>
            <h4 className="font-mono text-sm font-semibold mb-2">Notable History</h4>
            <p className="font-mono text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded-md">
              {data.notableHistory}
            </p>
          </div>
        )}

        {data.conditionNotes && (
          <div>
            <h4 className="font-mono text-sm font-semibold mb-2">Condition Notes</h4>
            <p className="font-mono text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded-md">
              {data.conditionNotes}
            </p>
          </div>
        )}
      </div>
    );
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
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <h3 className="font-mono text-sm text-[#666]">Vehicle Information</h3>
              <p className="font-mono">VIN: {vehicle.vin || 'N/A'}</p>
              <p className="font-mono">Make: {vehicle.make}</p>
              <p className="font-mono">Model: {vehicle.model}</p>
              <p className="font-mono">Year: {vehicle.year}</p>
            </div>
            {vehicle.notes && (
              <div className="space-y-2">
                <h3 className="font-mono text-sm text-[#666]">Notes</h3>
                <p className="font-mono">{vehicle.notes}</p>
              </div>
            )}
          </div>
          
          <div className="pt-4 border-t border-[#283845]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-mono text-sm text-[#666]">Vehicle History</h3>
              <Button 
                onClick={searchVehicleHistory} 
                disabled={searching}
                className="font-mono text-sm"
              >
                {searching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {searching ? 'Searching...' : 'Search History'}
              </Button>
            </div>
            {vehicle.historical_data ? (
              renderHistoricalData()
            ) : (
              <p className="text-sm text-muted-foreground font-mono">
                No historical data available. Click "Search History" to find information about this vehicle.
              </p>
            )}
          </div>

          <div className="pt-4 border-t border-[#283845]">
            <h3 className="font-mono text-sm text-[#666] mb-2">Record Details</h3>
            <p className="text-xs font-mono text-[#666]">
              Created: {new Date(vehicle.createdAt).toLocaleDateString()}
            </p>
            <p className="text-xs font-mono text-[#666]">
              Last Updated: {new Date(vehicle.updatedAt).toLocaleDateString()}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};