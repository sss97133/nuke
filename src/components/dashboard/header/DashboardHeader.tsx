
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { AppMenu } from "./AppMenu";
import { MainMenu } from "./MainMenu";
import { StatusBar } from "./StatusBar";
import { Building2 } from "lucide-react";
import type { Profile, Garage } from "@/types/garage";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}

export const DashboardHeader = ({ handleMenuAction }: DashboardHeaderProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [userDetails, setUserDetails] = useState<Profile | null>(null);
  const [activeGarage, setActiveGarage] = useState<Garage | null>(null);
  const [userGarages, setUserGarages] = useState<Garage[]>([]);

  useEffect(() => {
    const fetchUserDetailsAndGarages = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Fetch profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (profile) {
          setUserDetails(profile);
          
          // Fetch user's garages
          const { data: garageMembers } = await supabase
            .from('garage_members')
            .select('garage_id')
            .eq('user_id', user.id);

          if (garageMembers && garageMembers.length > 0) {
            const garageIds = garageMembers.map(member => member.garage_id);
            const { data: garages } = await supabase
              .from('garages')
              .select('*')
              .in('id', garageIds);

            if (garages) {
              setUserGarages(garages);
              
              // Set active garage
              if (profile.active_garage_id) {
                const active = garages.find(g => g.id === profile.active_garage_id);
                if (active) {
                  setActiveGarage(active);
                }
              } else if (profile.default_garage_id) {
                const defaultGarage = garages.find(g => g.id === profile.default_garage_id);
                if (defaultGarage) {
                  setActiveGarage(defaultGarage);
                }
              } else if (garages.length > 0) {
                setActiveGarage(garages[0]);
              }
            }
          }
        }
      }
    };

    fetchUserDetailsAndGarages();
  }, []);

  const handleAction = async (action: string) => {
    if (action === "logout") {
      try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        toast({
          title: "Logged out",
          description: "Successfully logged out",
        });
        
        localStorage.clear();
        sessionStorage.clear();
        
        window.location.replace('/login');
      } catch (error) {
        console.error("Error:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to log out. Please try again.",
        });
      }
    } else {
      handleMenuAction(action);
    }
  };

  const handleProfileClick = () => {
    navigate('/profile');
  };

  const handleGarageSelect = async (garage: Garage) => {
    if (!userDetails) return;

    // Update active garage in profile
    const { error } = await supabase
      .from('profiles')
      .update({ active_garage_id: garage.id })
      .eq('id', userDetails.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update active garage",
      });
      return;
    }

    setActiveGarage(garage);
    toast({
      title: "Garage Updated",
      description: `Now working in ${garage.name}`,
    });
  };

  const handleCreateGarage = () => {
    navigate('/garage/new');
  };

  return (
    <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center h-6 px-2 bg-secondary border-b border-border shadow-classic">
        <AppMenu handleMenuAction={handleAction} />
        <div className="flex-1">
          <MainMenu handleMenuAction={handleAction} />
        </div>
        <div className="flex items-center gap-2 mr-2">
          {userDetails && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-2 text-xs flex items-center gap-2 hover:bg-secondary-foreground/10"
                  >
                    <Building2 className="h-4 w-4" />
                    <span className="text-muted-foreground">
                      {activeGarage?.name || 'Select Garage'}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {userGarages.map((garage) => (
                    <DropdownMenuItem
                      key={garage.id}
                      onClick={() => handleGarageSelect(garage)}
                      className="cursor-pointer"
                    >
                      {garage.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    onClick={handleCreateGarage}
                    className="cursor-pointer border-t"
                  >
                    Create New Garage
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleProfileClick}
                className="h-5 px-2 text-xs flex items-center gap-2 hover:bg-secondary-foreground/10"
              >
                <Avatar className="h-4 w-4">
                  <AvatarImage src={userDetails.avatar_url || ''} />
                  <AvatarFallback className="text-[10px]">
                    {userDetails.full_name?.split(' ').map(n => n[0]).join('') || userDetails.email?.[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-muted-foreground">
                  {userDetails.full_name || userDetails.email}
                </span>
              </Button>
            </>
          )}
        </div>
        <StatusBar />
      </div>
    </header>
  );
};
