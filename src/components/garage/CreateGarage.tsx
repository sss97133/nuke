import type { Database } from '../types';
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export const CreateGarage = () => {
  const [newGarageName, setNewGarageName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleCreateGarage = async () => {
    if (!newGarageName.trim()) {
      toast({
        title: "Error",
        description: "Garage name is required",
        variant: "destructive"
      });
      return;
    }

    const { error } = await supabase
        .from('garages')
      .insert([{ name: newGarageName.trim() }]);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to create garage",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Success",
      description: "Garage created successfully"
    });
    setNewGarageName("");
    queryClient.invalidateQueries({ queryKey: ['garages'] });
  };

  return (
    <div className="flex items-center gap-4">
      <Input
        placeholder="New Garage Name"
        value={newGarageName}
        onChange={(e) => setNewGarageName(e.target.value)}
        className="w-64"
      />
      <Button
        onClick={handleCreateGarage}
        variant="default"
        size="sm"
      >
        Add Garage
      </Button>
    </div>
  );
};