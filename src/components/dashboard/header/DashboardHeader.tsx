
import React from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { UserMenu } from "./menu/UserMenu";
import { MainMenu } from "./MainMenu";
import { AppMenu } from "./AppMenu";
import { GarageDropdown } from "@/components/garage/GarageDropdown";

interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({ handleMenuAction }) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  return (
    <div className="border-b bg-secondary">
      <div className="flex h-16 items-center px-4 gap-4">
        <AppMenu handleMenuAction={handleMenuAction} />
        
        <MainMenu handleMenuAction={handleMenuAction} />

        <div className="flex-1" />

        <GarageDropdown />

        <UserMenu 
          navigate={navigate}
          toast={toast}
          handleMenuAction={handleMenuAction}
        />
      </div>
    </div>
  );
};
