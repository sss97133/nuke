
import React from "react";
import { NavigateFunction } from "react-router-dom";
import { ToastFunction } from "../../hooks/utils/types";
import { handleProjectNavigation } from "../../hooks/utils/navigationUtils";
import { LoggedButton } from "@/components/ui/logged-button";
import { Warehouse } from "lucide-react";

interface GarageButtonProps {
  navigate: NavigateFunction;
  toast: ToastFunction;
}

export const GarageButton: React.FC<GarageButtonProps> = ({ navigate, toast }) => {
  const handleSelectGarage = () => {
    handleProjectNavigation(navigate, toast, 'garage_selection');
  };

  return (
    <LoggedButton 
      variant="ghost" 
      onClick={handleSelectGarage}
      className="gap-2"
      logId="select_garage_button"
    >
      <Warehouse className="h-4 w-4" />
      Select Garage
    </LoggedButton>
  );
};
