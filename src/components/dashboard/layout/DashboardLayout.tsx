
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen bg-background dashboard-container">
      <ScrollArea className="h-[calc(100vh-4rem)] pb-16 md:pb-0">
        <div className="container max-w-7xl mx-auto p-6 pb-20 md:pb-6 space-y-6">
          {children}
        </div>
      </ScrollArea>
    </div>
  );
};

export default DashboardLayout;
