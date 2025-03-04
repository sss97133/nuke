
import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { DesktopNavSidebar } from './nav/DesktopNavSidebar';
import { MobileNavSidebar } from './nav/MobileNavSidebar';
import { RouteDebug } from '../../debug/RouteDebug';

export const NavSidebar = () => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div className="flex h-screen">
      <RouteDebug />
      <DesktopNavSidebar isCollapsed={isCollapsed} toggleCollapse={toggleCollapse} />
      <MobileNavSidebar isOpen={isMobileOpen} setIsOpen={setIsMobileOpen} />
      
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
};
