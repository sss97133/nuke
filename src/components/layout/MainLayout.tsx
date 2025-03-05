
import React from 'react';
import { NavSidebar } from "./NavSidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HelmetProvider } from '../providers/HelmetProvider';

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout = ({ children }: MainLayoutProps) => {
  return (
    <HelmetProvider>
      <div className="flex h-screen">
        <NavSidebar />
        <main className="flex-1 overflow-hidden">
          <ScrollArea className="h-full w-full">
            {children}
          </ScrollArea>
        </main>
      </div>
    </HelmetProvider>
  );
};
