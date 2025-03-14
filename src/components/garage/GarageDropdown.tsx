
import type { Database } from '../types';
import React from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useGarages } from "./hooks/useGarages";
import { Loader2, Warehouse } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { assert } from "./utils/assertions";

export const GarageDropdown = () => {
  const { data: garages, isLoading } = useGarages();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSelectGarage = async (garageId: string) => {
    try {
      if (!assert(garageId?.length > 0, "Valid garage ID provided")) {
        throw new Error("Invalid garage ID");
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
      
      if (!assert(!userError, "User fetch for update succeeded")) {
        throw userError;
      }

      if (!assert(user?.id != null, "User exists for update")) {
        throw new Error("No user ID found");
      }

      const { error } = await supabase
  if (error) console.error("Database query error:", error);
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
      console.error('[GarageDropdown] Error selecting garage:', error);
      toast({
        title: "Error",
        description: "Failed to select garage. Please try again.",
        variant: "destructive"
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2">
          <Warehouse className="h-4 w-4" />
          Select Garage
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Available Garages</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isLoading ? (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : garages && garages.length > 0 ? (
          garages.map((garage) => (
            <DropdownMenuItem 
              key={garage.id}
              onClick={() => handleSelectGarage(garage.id)}
            >
              {garage.name}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>
            No garages available
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
