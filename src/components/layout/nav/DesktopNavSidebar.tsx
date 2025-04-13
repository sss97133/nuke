import React from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NavItem } from './NavItem';
import { useNavItems } from './useNavItems';

interface DesktopNavSidebarProps {
  isCollapsed: boolean;
  toggleCollapse: () => void;
}

export const DesktopNavSidebar = ({ isCollapsed, toggleCollapse }: DesktopNavSidebarProps) => {
  const location = useLocation();
  const { getNavItems } = useNavItems();
  
  const navItems = getNavItems();

  return (
    <div 
      className={cn(
        "flex flex-col h-screen border-r border-border bg-background transition-all hidden md:flex",
        isCollapsed ? "w-14 sm:w-16" : "w-48 sm:w-64"
      )}
    >
      <div className="p-3 sm:p-4 flex items-center justify-between border-b">
        {!isCollapsed && <span className="font-semibold text-sm sm:text-base">Vehicle Manager</span>}
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={toggleCollapse}
          className="ml-auto h-7 w-7 sm:h-8 sm:w-8"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {navItems.map((item, index) => (
            <NavItem
              key={item.to && item.to !== '#' ? item.to : `${item.label}-${index}`}
              to={item.to}
              icon={item.icon}
              label={item.label}
              isActive={location.pathname === item.to}
              isCollapsed={isCollapsed}
              onClick={item.onClick}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
