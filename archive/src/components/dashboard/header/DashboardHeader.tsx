import React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { UserMenu } from "./menu/UserMenu";
import { MainMenu } from "./MainMenu";
import { AppMenu } from "./AppMenu";
import { GarageDropdown } from "@/components/garage/GarageDropdown";
import { ToastFunction } from "@/components/dashboard/hooks/utils/types";
interface DashboardHeaderProps {
  handleMenuAction: (action: string) => void;
}
export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  handleMenuAction
}) => {
  const navigate = useNavigate();

  // Create a toast wrapper that conforms to our ToastFunction type
  const toastWrapper: ToastFunction = options => {
    if (typeof options === 'string') {
      return toast(options);
    }
    return toast(options.description || '', {
      description: options.title
    });
  };
  return <div className="border-b bg-secondary">
      <div className="flex h-16 items-center gap-4 px-[16px] py-0">
        <AppMenu handleMenuAction={handleMenuAction} />
        
        <MainMenu handleMenuAction={handleMenuAction} />

        <div className="flex-1" />

        <GarageDropdown />

        <UserMenu navigate={navigate} toast={toastWrapper} handleMenuAction={handleMenuAction} />
      </div>
    </div>;
};