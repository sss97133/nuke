
import { AppMenu } from "./AppMenu";
import { MainMenu } from "./MainMenu";
import { StatusBar } from "./StatusBar";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useEffect, useState } from "react";

interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}

export const DashboardHeader = ({ handleMenuAction }: DashboardHeaderProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [userDetails, setUserDetails] = useState<{
    email?: string;
    avatar_url?: string;
    full_name?: string;
  } | null>(null);

  useEffect(() => {
    const fetchUserDetails = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('avatar_url, full_name')
          .eq('id', user.id)
          .single();

        setUserDetails({
          email: user.email,
          avatar_url: profile?.avatar_url,
          full_name: profile?.full_name
        });
      }
    };

    fetchUserDetails();
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

  return (
    <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center h-6 px-2 bg-secondary border-b border-border shadow-classic">
        <AppMenu handleMenuAction={handleAction} />
        <div className="flex-1">
          <MainMenu handleMenuAction={handleAction} />
        </div>
        <div className="flex items-center gap-2 mr-2">
          {userDetails && (
            <div className="flex items-center gap-2 text-xs">
              <Avatar className="h-4 w-4">
                <AvatarImage src={userDetails.avatar_url || ''} />
                <AvatarFallback className="text-[10px]">
                  {userDetails.full_name?.split(' ').map(n => n[0]).join('') || userDetails.email?.[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-muted-foreground">
                {userDetails.full_name || userDetails.email}
              </span>
            </div>
          )}
        </div>
        <StatusBar />
      </div>
    </header>
  );
};
