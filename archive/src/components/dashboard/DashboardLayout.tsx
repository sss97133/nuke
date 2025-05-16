
import React from "react";
import { Outlet } from "react-router-dom";
import { DashboardHeader } from "./header/DashboardHeader";

interface DashboardLayoutProps {
  children?: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = () => {
  const handleMenuAction = (action: string) => {
    console.log("[DashboardLayout] Menu action:", action);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader handleMenuAction={handleMenuAction} />
      
      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t">
        <div className="container mx-auto px-4 py-4 text-center text-muted-foreground">
          © 2025 Nuke ltd
        </div>
      </footer>
    </div>
  );
};
