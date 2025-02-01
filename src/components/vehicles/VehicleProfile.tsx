import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { Vehicle } from "@/types/inventory";

export const VehicleProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);

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
        updatedAt: data.updated_at
      });
      setLoading(false);
    };

    fetchVehicle();
  }, [id, navigate, toast]);

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