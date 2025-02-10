
import { AppMenu } from "./AppMenu";
import { MainMenu } from "./MainMenu";
import { StatusBar } from "./StatusBar";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}

export const DashboardHeader = ({ handleMenuAction }: DashboardHeaderProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleAction = async (action: string) => {
    if (action === "logout") {
      try {
        // Clear any stored session data
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        toast({
          title: "Logged out",
          description: "Successfully logged out",
        });
        
        // Clear any session storage
        localStorage.clear();
        sessionStorage.clear();
        
        // Force a full page reload and redirect to login
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
        <StatusBar />
      </div>
    </header>
  );
};
