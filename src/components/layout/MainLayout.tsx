
import React from 'react';
import { NavSidebar } from './NavSidebar';
import { AuthRequiredModal } from '@/components/auth/AuthRequiredModal';

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <div className="flex min-h-screen bg-background">
      <NavSidebar />
      <div className="flex-1 pt-14 md:pt-0">
        <AuthRequiredModal />
        {children}
      </div>
    </div>
  );
};
