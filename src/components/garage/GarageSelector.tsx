
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

// Constants for safety bounds
const MAX_GARAGES = 100;
const MAX_RETRIES = 3;

interface Garage {
  id: string;
  name: string;
  garage_members: Array<{
    role: string;
    status: string;
  }>;
}

// Assertion function
function assert(condition: boolean, message: string): boolean {
  if (!condition) {
    console.error(`[GarageSelector] Assertion failed: ${message}`);
    return false;
  }
  return true;
}

const fetchGarages = async (): Promise<Garage[]> => {
  console.log("[GarageSelector] Fetching garages for user");
  
  // Assertion 1: Check authentication
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!assert(!userError, "User fetch succeeded")) {
    throw new Error("Failed to fetch user");
  }
  
  // Assertion 2: Verify user existence
  if (!assert(user?.id != null, "User ID exists")) {
    throw new Error("No user ID found");
  }

  // First get the garage memberships with bounded fetch
  const { data: memberships, error: membershipError } = await supabase
    .from('garage_members')
    .select('garage_id, role, status')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(MAX_GARAGES);

  // Assertion 3: Check membership fetch
  if (!assert(!membershipError, "Membership fetch succeeded")) {
    throw membershipError;
  }

  // Assertion 4: Verify membership data
  if (!assert(Array.isArray(memberships), "Memberships is an array")) {
    return [];
  }

  if (memberships.length === 0) {
    return [];
  }

  // Assertion 5: Check membership count
  if (!assert(memberships.length <= MAX_GARAGES, "Membership count within bounds")) {
    throw new Error("Too many garages");
  }

  // Then get the garage details with bounded fetch
  const { data: garages, error: garagesError } = await supabase
    .from('garages')
    .select('*')
    .in('id', memberships.map(m => m.garage_id))
    .limit(MAX_GARAGES);

  // Assertion 6: Check garage fetch
  if (!assert(!garagesError, "Garage fetch succeeded")) {
    throw garagesError;
  }

  // Assertion 7: Verify garage data
  if (!assert(Array.isArray(garages), "Garages is an array")) {
    return [];
  }

  // Combine the data with single-level access
  return garages.map(garage => {
    const membership = memberships.find(m => m.garage_id === garage.id);
    return {
      id: garage.id,
      name: garage.name,
      garage_members: [{
        role: membership?.role || 'member',
        status: 'active'
      }]
    };
  });
};

export const GarageSelector = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const { data: garages, isLoading } = useQuery({
    queryKey: ['garages'],
    queryFn: fetchGarages,
    retry: MAX_RETRIES,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const handleSelectGarage = async (garageId: string) => {
    try {
      // Assertion 8: Verify garage ID
      if (!assert(garageId?.length > 0, "Valid garage ID provided")) {
        throw new Error("Invalid garage ID");
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      // Assertion 9: Check user fetch for update
      if (!assert(!userError, "User fetch for update succeeded")) {
        throw userError;
      }

      // Assertion 10: Verify user for update
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
          <Card key={garage.id} className="hover:bg-accent transition-colors">
            <CardHeader>
              <CardTitle>{garage.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Role: {garage.garage_members[0]?.role || 'Member'}
              </p>
              <Button 
                className="w-full"
                onClick={() => handleSelectGarage(garage.id)}
              >
                Select Garage
              </Button>
            </CardContent>
          </Card>
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
