import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Building, MapPin, Star, Trash2, Users } from "lucide-react";
import { AddGarageMember } from "./AddGarageMember";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

type GarageCardProps = {
  garage: {
    id: string;
    name: string;
    address: string | null;
    rating: number | null;
    garage_members: { user_id: string }[];
  };
};

export const GarageCard = ({ garage }: GarageCardProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleDeleteGarage = async () => {
    try {
      const { error } = await supabase
        .from('garages')
        .delete()
        .eq('id', garage.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Garage deleted successfully"
      });
      
      queryClient.invalidateQueries({ queryKey: ['garages'] });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete garage",
        variant: "destructive"
      });
    }
  };

  const handleMemberAdded = () => {
    queryClient.invalidateQueries({ queryKey: ['garages'] });
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building className="w-5 h-5 text-muted-foreground" />
          <h3 className="font-semibold">{garage.name}</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDeleteGarage}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {garage.address && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="w-4 h-4" />
          <span>{garage.address}</span>
        </div>
      )}

      {garage.rating && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Star className="w-4 h-4" />
          <span>{garage.rating} / 5</span>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="w-4 h-4" />
          <span>Members: {garage.garage_members?.length || 0}</span>
        </div>
        <AddGarageMember garageId={garage.id} onMemberAdded={handleMemberAdded} />
      </div>
    </Card>
  );
};