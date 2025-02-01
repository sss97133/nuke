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
        title: "ERR",
        description: "GARAGE_NAME_REQUIRED",
        variant: "destructive"
      });
      return;
    }

    const { error } = await supabase
      .from('garages')
      .insert([{ name: newGarageName.trim() }]);

    if (error) {
      toast({
        title: "ERR",
        description: "GARAGE_CREATE_FAILED",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "OK",
      description: "GARAGE_CREATED"
    });
    setNewGarageName("");
    refetch();
  };

  return (
    <div className="space-y-4 font-mono">
      <div className="border-b border-[#283845] pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[#666]">[TAMS]</span>
          <span className="text-xs text-[#283845]">GARAGE_MGMT_SYS v1.0</span>
        </div>
      </div>

      <div className="flex gap-2 items-center bg-[#f8f9fa] p-2 border border-[#283845]">
        <span className="text-xs text-[#666]">CMD:</span>
        <Input
          placeholder="NEW_GARAGE_NAME"
          value={newGarageName}
          onChange={(e) => setNewGarageName(e.target.value)}
          className="h-7 text-xs font-mono bg-white"
        />
        <Button
          onClick={handleCreateGarage}
          size="sm"
          className="h-7 bg-[#283845] hover:bg-[#1a2830] text-white text-xs"
        >
          <Plus className="w-3 h-3 mr-1" />
          ADD
        </Button>
      </div>

      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {garages?.map((garage) => (
          <div
            key={garage.id}
            className="p-2 border border-[#283845] bg-white text-xs"
          >
            <div className="flex items-center gap-2 border-b border-dotted border-[#283845] pb-1">
              <Building className="w-3 h-3 text-[#283845]" />
              <span className="text-[#283845] uppercase">{garage.name}</span>
            </div>
            <div className="flex justify-between items-center pt-1">
              <div className="flex items-center gap-1 text-[#666]">
                <Users className="w-3 h-3" />
                <span>MEM:0</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px]"
                onClick={() => {
                  toast({
                    title: "INFO",
                    description: "MEM_MGMT_COMING_SOON"
                  });
                }}
              >
                MANAGE
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-[#666] border-t border-[#283845] pt-2 mt-4">
        <span>SYS_STATUS: READY</span>
        <span className="ml-4">MEM_USAGE: LOW</span>
        <span className="ml-4">LAST_UPDATE: {new Date().toISOString()}</span>
      </div>
    </div>
  );
};