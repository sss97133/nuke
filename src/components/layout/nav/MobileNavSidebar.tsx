
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NavItem } from './NavItem';
import { useNavItems } from './useNavItems';

interface MobileNavSidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const MobileNavSidebar = ({ isOpen, setIsOpen }: MobileNavSidebarProps) => {
  const location = useLocation();
  const { getNavItems } = useNavItems();
  
  const closeMenu = () => {
    setIsOpen(false);
  };

  const navItems = getNavItems();

  return (
    <div className="fixed top-3 left-3 z-40">
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className="md:hidden h-9 w-9">
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64 sm:w-[270px] pb-16">
          <div className="p-3 sm:p-4 flex items-center justify-between border-b">
            <span className="font-semibold text-sm sm:text-base">Vehicle Manager</span>
          </div>
          <ScrollArea className="h-[calc(100vh-57px-4rem)]">
            <div className="p-2 space-y-1">
              {navItems.map((item) => (
                <NavItem
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  label={item.label}
                  isActive={location.pathname === item.to}
                  isCollapsed={false}
                  onClick={(e) => {
                    if (item.onClick) {
                      item.onClick(e);
                    }
                    closeMenu();
                  }}
                />
              ))}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
};
