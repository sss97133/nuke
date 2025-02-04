import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Users, Building, MapPin, Star, Trash2, Edit, UserPlus } from "lucide-react";
import { ImportGarages } from "./ImportGarages";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const GarageManagement = () => {
  const [newGarageName, setNewGarageName] = useState("");
  const [selectedGarage, setSelectedGarage] = useState<any>(null);
  const [showMemberDialog, setShowMemberDialog] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          console.error("Error getting location:", error);
          toast({
            title: "Location Error",
            description: "Could not get your location. Using default location.",
            variant: "destructive"
          });
          setUserLocation({ lat: 40.7128, lng: -74.0060 });
        }
      );
    }
  }, []);

  const { data: garages, refetch } = useQuery({
    queryKey: ['garages', userLocation],
    queryFn: async () => {
      if (!userLocation) return [];

      const { data: garages, error } = await supabase
        .from('garages')
        .select(`
          *,
          garage_members (
            user_id,
            profiles (
              full_name,
              avatar_url
            )
          )
        `);
      
      if (error) throw error;
      return garages;
    },
    enabled: !!userLocation
  });

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
    refetch();
  };

  const handleDeleteGarage = async (garageId: string) => {
    const { error } = await supabase
      .from('garages')
      .delete()
      .eq('id', garageId);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to delete garage",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Success",
      description: "Garage deleted successfully"
    });
    refetch();
  };

  const handleAddMember = async (garageId: string) => {
    if (!newMemberEmail.trim()) {
      toast({
        title: "Error",
        description: "Member email is required",
        variant: "destructive"
      });
      return;
    }

    // First get the user ID from the profiles table
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', newMemberEmail)
      .single();

    if (profileError || !profiles) {
      toast({
        title: "Error",
        description: "User not found",
        variant: "destructive"
      });
      return;
    }

    const { error } = await supabase
      .from('garage_members')
      .insert([{ 
        garage_id: garageId,
        user_id: profiles.id
      }]);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to add member",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Success",
      description: "Member added successfully"
    });
    setNewMemberEmail("");
    setShowMemberDialog(false);
    refetch();
  };

  return (
    <div className="space-y-4 font-mono">
      <div className="border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">[TAMS]</span>
          <span className="text-xs text-foreground">GARAGE_MGMT_SYS v1.0</span>
        </div>
      </div>

      <div className="flex gap-2 items-center bg-muted p-2 border border-border">
        <span className="text-xs text-muted-foreground">CMD:</span>
        <Input
          placeholder="NEW_GARAGE_NAME"
          value={newGarageName}
          onChange={(e) => setNewGarageName(e.target.value)}
          className="h-7 text-xs font-mono bg-background"
        />
        <Button
          onClick={handleCreateGarage}
          size="sm"
          className="h-7 text-xs"
        >
          <Plus className="w-3 h-3 mr-1" />
          ADD
        </Button>
        <ImportGarages />
      </div>

      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {garages?.map((garage) => (
          <div
            key={garage.id}
            className="p-2 border border-border bg-background text-xs animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-dotted border-border pb-1">
              <div className="flex items-center gap-2">
                <Building className="w-3 h-3 text-foreground" />
                <span className="text-foreground uppercase">{garage.name}</span>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setSelectedGarage(garage)}
                >
                  <Edit className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive"
                  onClick={() => handleDeleteGarage(garage.id)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
            
            {garage.address && (
              <div className="flex items-center gap-1 text-muted-foreground mt-1">
                <MapPin className="w-3 h-3" />
                <span className="truncate">{garage.address}</span>
              </div>
            )}
            
            {garage.rating && (
              <div className="flex items-center gap-1 text-muted-foreground mt-1">
                <Star className="w-3 h-3" />
                <span>{garage.rating} / 5</span>
              </div>
            )}

            <div className="flex justify-between items-center pt-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>Members: {garage.garage_members?.length || 0}</span>
              </div>
              
              <Dialog open={showMemberDialog} onOpenChange={setShowMemberDialog}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px]"
                  >
                    <UserPlus className="w-3 h-3 mr-1" />
                    ADD MEMBER
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New Member</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <Input
                      placeholder="Member Email"
                      value={newMemberEmail}
                      onChange={(e) => setNewMemberEmail(e.target.value)}
                    />
                    <Button 
                      onClick={() => handleAddMember(garage.id)}
                      className="w-full"
                    >
                      Add Member
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-muted-foreground border-t border-border pt-2 mt-4">
        <span>SYS_STATUS: {userLocation ? 'READY' : 'WAITING_FOR_LOCATION'}</span>
        <span className="ml-4">LOCATION: {userLocation ? `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}` : 'UNKNOWN'}</span>
        <span className="ml-4">LAST_UPDATE: {new Date().toISOString()}</span>
      </div>
    </div>
  );
};