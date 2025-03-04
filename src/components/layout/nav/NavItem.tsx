
import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { NavItemProps } from './types';

export const NavItem = ({ to, icon, label, isActive, isCollapsed, onClick }: NavItemProps) => {
  return (
    <Link 
      to={to} 
      className={cn(
        "flex items-center gap-3 px-2 sm:px-3 py-1.5 sm:py-2 rounded-md transition-colors",
        isCollapsed ? "justify-center" : "",
        isActive 
          ? "bg-primary text-primary-foreground" 
          : "hover:bg-primary/10 text-foreground"
      )}
      onClick={onClick}
    >
      {icon}
      {!isCollapsed && <span className="text-sm sm:text-base truncate">{label}</span>}
    </Link>
  );
};
