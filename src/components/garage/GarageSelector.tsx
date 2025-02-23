
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export const GarageSelector = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const { data: garages, isLoading } = useQuery({
    queryKey: ['garages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('garages')
        .select(`
          id,
          name,
          garage_members!inner (
            id,
            role,
            status
          )
        `)
        .eq('garage_members.user_id', (await supabase.auth.getUser()).data.user?.id)
        .eq('garage_members.status', 'active');

      if (error) throw error;
      return data;
    }
  });

  const handleSelectGarage = async (garageId: string) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ active_garage_id: garageId })
        .eq('id', (await supabase.auth.getUser()).data.user?.id);

      if (error) throw error;

      toast({
        title: "Garage Selected",
        description: "Successfully switched active garage"
      });

      navigate('/dashboard');
    } catch (error) {
      console.error('Error selecting garage:', error);
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
