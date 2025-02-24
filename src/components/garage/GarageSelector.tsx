
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { assert } from "./utils/assertions";
import { useGarages } from "./hooks/useGarages";
import { GarageCard } from "./GarageCard";

export const GarageSelector = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: garages, isLoading } = useGarages();

  const handleSelectGarage = async (garageId: string) => {
    try {
      if (!assert(garageId?.length > 0, "Valid garage ID provided")) {
        throw new Error("Invalid garage ID");
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (!assert(!userError, "User fetch for update succeeded")) {
        throw userError;
      }

      if (!assert(user?.id != null, "User exists for update")) {
        throw new Error("No user ID found");
      }

      const { error } = await supabase
        .from('profiles')
        .update({ active_garage_id: garageId })
        .eq('id', user.id);

      if (!assert(!error, "Profile update succeeded")) {
        throw error;
      }

      toast({
        title: "Garage Selected",
        description: "Successfully switched active garage"
      });

      navigate('/dashboard');
    } catch (error) {
      console.error('[GarageSelector] Error selecting garage:', error);
      toast({
        title: "Error",
        description: "Failed to select garage. Please try again.",
        variant: "destructive"
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <h1 className="text-2xl font-bold">Select Garage</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {garages?.map((garage) => (
          <GarageCard 
            key={garage.id} 
            garage={garage} 
            onSelect={handleSelectGarage}
          />
        ))}
      </div>
      {(!garages || garages.length === 0) && (
        <div className="text-center py-8">
          <h2 className="text-xl font-semibold mb-2">No Garages Found</h2>
          <p className="text-muted-foreground">You don't have access to any garages yet.</p>
        </div>
      )}
    </div>
  );
};
