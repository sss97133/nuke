
import { useState, useEffect } from "react";
import { NewToken, Vehicle } from "@/types/token";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface ReviewStepProps {
  token: NewToken;
}

const ReviewStep = ({ token }: ReviewStepProps) => {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  
  useEffect(() => {
    if (token.vehicle_id) {
      fetchVehicle(token.vehicle_id);
    }
  }, [token.vehicle_id]);
  
  const fetchVehicle = async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year, vin')
        .eq('id', id)
        .single();
        
      if (error) throw error;
      setVehicle(data);
    } catch (error) {
      console.error('Error fetching vehicle details:', error);
    }
  };
  
  return (
    <div className="space-y-4 py-2">
      <p className="text-sm text-muted-foreground mb-4">
        Please review your token details before creating. Make sure all information is correct.
      </p>
      
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Token Name</h3>
              <p className="font-semibold">{token.name}</p>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Symbol</h3>
              <p className="font-semibold">{token.symbol}</p>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Total Supply</h3>
              <p className="font-semibold">{token.total_supply.toLocaleString()}</p>
            </div>
            
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Decimals</h3>
              <p className="font-semibold">{token.decimals}</p>
            </div>
            
            <div className="col-span-2">
              <h3 className="text-sm font-medium text-muted-foreground">Status</h3>
              <p className="font-semibold capitalize">{token.status}</p>
            </div>
            
            <div className="col-span-2">
              <h3 className="text-sm font-medium text-muted-foreground">Description</h3>
              <p className="text-sm">
                {token.description || "No description provided"}
              </p>
            </div>
            
            {token.vehicle_id && vehicle && (
              <div className="col-span-2 mt-2">
                <h3 className="text-sm font-medium text-muted-foreground">Linked Vehicle</h3>
                <div className="mt-1 p-3 bg-muted rounded-md">
                  <p className="text-sm font-semibold">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                    {vehicle.vin && ` (VIN: ${vehicle.vin})`}
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ReviewStep;
