import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Building, MapPin, Star, Trash2, UserPlus, Users } from "lucide-react";
import { ImportGarages } from "./ImportGarages";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";

type GarageMember = {
  user_id: string;
}

type Garage = {
  id: string;
  name: string;
  address: string | null;
  rating: number | null;
  garage_members: GarageMember[] | null;
}

export const GarageManagement = () => {
  const [newGarageName, setNewGarageName] = useState("");
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

      const { data, error } = await supabase
        .from('garages')
        .select(`
          *,
          garage_members (
            user_id
          )
        `);
      
      if (error) throw error;
      return data as Garage[];
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

    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', newMemberEmail)
      .maybeSingle();

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
    refetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
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
        <ImportGarages />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {garages?.map((garage) => (
          <Card
            key={garage.id}
            className="p-4 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building className="w-5 h-5 text-muted-foreground" />
                <h3 className="font-semibold">{garage.name}</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDeleteGarage(garage.id)}
                className="text-destructive hover:text-destructive"
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

              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <UserPlus className="w-4 h-4" />
                    Add Member
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
          </Card>
        ))}
      </div>

      <div className="text-xs text-muted-foreground border-t pt-4">
        <span>Location: {userLocation ? `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}` : 'Detecting...'}</span>
        <span className="ml-4">Last Update: {new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  );
};