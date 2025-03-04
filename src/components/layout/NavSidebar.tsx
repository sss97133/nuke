
import React, { useState, useEffect } from 'react';
import { MobileNavSidebar } from './nav/MobileNavSidebar';
import { DesktopNavSidebar } from './nav/DesktopNavSidebar';

export const NavSidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768) {
        setIsCollapsed(true);
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  if (isMobile) {
    return <MobileNavSidebar isOpen={isOpen} setIsOpen={setIsOpen} />;
  }

  return (
    <DesktopNavSidebar 
      isCollapsed={isCollapsed} 
      toggleCollapse={toggleCollapse} 
    />
  );
}
