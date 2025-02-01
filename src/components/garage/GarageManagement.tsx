import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Users, Building } from "lucide-react";

export const GarageManagement = () => {
  const [newGarageName, setNewGarageName] = useState("");
  const { toast } = useToast();

  const { data: garages, refetch } = useQuery({
    queryKey: ['garages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('garages')
        .select('*');
      
      if (error) throw error;
      return data;
    }
  });

  const handleCreateGarage = async () => {
    if (!newGarageName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a garage name",
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
    refetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-sm font-mono text-[#283845] tracking-tight uppercase">Garage Management</h2>
          <p className="text-xs text-[#666] font-mono mt-1">Manage your garages and members</p>
        </div>
      </div>

      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <Input
            placeholder="Enter garage name"
            value={newGarageName}
            onChange={(e) => setNewGarageName(e.target.value)}
          />
        </div>
        <Button
          onClick={handleCreateGarage}
          className="bg-[#283845] hover:bg-[#1a2830] text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Garage
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {garages?.map((garage) => (
          <div
            key={garage.id}
            className="p-4 border rounded-lg space-y-4 bg-white shadow-sm"
          >
            <div className="flex items-center gap-2">
              <Building className="w-5 h-5 text-[#283845]" />
              <h3 className="font-mono text-[#283845]">{garage.name}</h3>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Users className="w-4 h-4" />
              <span>Members: 0</span>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                toast({
                  title: "Coming Soon",
                  description: "Member management will be available soon"
                });
              }}
            >
              Manage Members
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};