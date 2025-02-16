
import React from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "next-themes";
import { handleProjectNavigation } from "../hooks/utils/navigationUtils";
import { UserMenu } from "./menu/UserMenu";
import { Button } from "@/components/ui/button";
import { Warehouse } from "lucide-react";
import { MainMenu } from "./MainMenu";
import { AppMenu } from "./AppMenu";

interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({ handleMenuAction }) => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

  const handleToggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const handleSelectGarage = () => {
    handleProjectNavigation(navigate, toast, 'garage_selection');
  };

  return (
    <div className="border-b bg-secondary">
      <div className="flex h-16 items-center px-4 gap-4">
        <AppMenu handleMenuAction={handleMenuAction} />
        
        <Button 
          variant="ghost" 
          onClick={handleSelectGarage}
          className="gap-2"
        >
          <Warehouse className="h-4 w-4" />
          Select Garage
        </Button>

        <MainMenu handleMenuAction={handleMenuAction} />

        <div className="flex-1" />

        <UserMenu 
          navigate={navigate}
          toast={toast}
          handleMenuAction={handleMenuAction}
        />
      </div>
    </div>
  );
};
