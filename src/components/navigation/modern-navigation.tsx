import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { tokens } from '@/styles/design-tokens';
import { useAuth } from '@/providers/AuthProvider';
import { useUserStore } from '@/stores/userStore';
import { Button } from '@/components/ui/button-system';
import { TooltipWrapper as Tooltip } from '@/components/ui/tooltip-wrapper';

// SVG icons for the navigation
const VehicleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 17h14v-5.5a5.5 5.5 0 0 0-11 0V17zm6 0v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1" />
    <path d="M4 5h16l-2 5H6zM12 4V2M7 9l-3 3M17 9l3 3" />
  </svg>
);

const ExploreIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" />
    <path d="m15 9-3 3-3-3M15 15l-3-3-3 3" />
  </svg>
);

const MarketplaceIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 10v12" />
    <path d="M17 10v12" />
    <path d="M3 6h18" />
    <path d="m4 3 2 3" />
    <path d="m18 3 2 3" />
    <path d="M4 10h16" />
    <path d="M8 3h8" />
  </svg>
);

const DashboardIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />
  </svg>
);

const ProfileIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

// Navigation item interface
interface NavigationItem {
  name: string;
  path: string;
  icon: React.ReactNode;
  badge?: {
    text: string;
    variant: 'primary' | 'secondary' | 'accent' | 'verified' | 'blockchain';
  };
  children?: NavigationItem[];
  vehicleCentric?: boolean; // Highlighting vehicle-centric navigation items
}

// Main navigation items
const navigationItems: NavigationItem[] = [
  {
    name: 'Dashboard',
    path: '/dashboard',
    icon: <DashboardIcon />,
  },
  {
    name: 'Vehicles',
    path: '/vehicles',
    icon: <VehicleIcon />,
    vehicleCentric: true,
    children: [
      {
        name: 'My Vehicles',
        path: '/vehicles',
        icon: <VehicleIcon />,
        vehicleCentric: true,
      },
      {
        name: 'Add Vehicle',
        path: '/add-vehicle',
        icon: <VehicleIcon />,
        vehicleCentric: true,
      },
      {
        name: 'Discovered',
        path: '/discovered-vehicles',
        icon: <VehicleIcon />,
        badge: {
          text: 'New',
          variant: 'accent',
        },
        vehicleCentric: true,
      },
      {
        name: 'Import',
        path: '/import-vehicles',
        icon: <VehicleIcon />,
        vehicleCentric: true,
      },
    ],
  },
  {
    name: 'Explore',
    path: '/explore',
    icon: <ExploreIcon />,
  },
  {
    name: 'Marketplace',
    path: '/marketplace',
    icon: <MarketplaceIcon />,
    badge: {
      text: 'Beta',
      variant: 'blockchain',
    },
  },
  {
    name: 'Profile',
    path: '/profile',
    icon: <ProfileIcon />,
  },
];

/**
 * Navigation Item Component
 */
const NavigationItem: React.FC<{
  item: NavigationItem;
  isActive: boolean;
  isMobile?: boolean;
  isCollapsed?: boolean;
  onClick?: () => void;
}> = ({ item, isActive, isMobile = false, isCollapsed = false, onClick }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Toggle submenu
  const toggleSubmenu = (e: React.MouseEvent) => {
    if (item.children) {
      e.preventDefault();
      setIsOpen(!isOpen);
    }
  };
  
  // Navigate and close mobile menu if needed
  const handleClick = () => {
    if (isMobile && onClick) {
      onClick();
    }
    
    if (!item.children) {
      setIsOpen(false);
    }
  };
  
  const navItemContent = (
    <>
      <span className="mr-3">{item.icon}</span>
      {!isCollapsed && (
        <>
          <span className="flex-1">{item.name}</span>
          {item.badge && (
            <span className={cn(
              "ml-2 rounded-full px-2 py-0.5 text-xs font-medium",
              item.badge.variant === 'primary' && "bg-primary-500 text-white",
              item.badge.variant === 'secondary' && "bg-secondary-500 text-white",
              item.badge.variant === 'accent' && "bg-accent-500 text-white",
              item.badge.variant === 'verified' && "bg-status-verified text-white",
              item.badge.variant === 'blockchain' && "bg-status-blockchain text-white",
            )}>
              {item.badge.text}
            </span>
          )}
          {item.children && (
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                isOpen && "rotate-180"
              )} 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6"/>
            </svg>
          )}
        </>
      )}
    </>
  );
  
  return (
    <li>
      {item.children ? (
        <div>
          <button
            className={cn(
              "flex w-full items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary-100 text-primary-900 dark:bg-primary-900/20 dark:text-primary-100"
                : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
              item.vehicleCentric && "border-l-4 border-primary-500 pl-2",
              isCollapsed && "justify-center"
            )}
            onClick={toggleSubmenu}
            aria-expanded={isOpen}
          >
            {isCollapsed ? (
              <Tooltip content={item.name}>{item.icon}</Tooltip>
            ) : (
              navItemContent
            )}
          </button>
          
          {item.children && (isOpen || isActive) && !isCollapsed && (
            <ul className="mt-1 space-y-1 pl-6">
              {item.children.map((child) => (
                <li key={child.path}>
                  <Link
                    to={child.path}
                    className={cn(
                      "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      window.location.pathname === child.path
                        ? "bg-primary-100 text-primary-900 dark:bg-primary-900/20 dark:text-primary-100"
                        : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
                      child.vehicleCentric && "border-l-4 border-primary-500 pl-2"
                    )}
                    onClick={handleClick}
                  >
                    <span className="mr-3">{child.icon}</span>
                    <span className="flex-1">{child.name}</span>
                    {child.badge && (
                      <span className={cn(
                        "ml-2 rounded-full px-2 py-0.5 text-xs font-medium",
                        child.badge.variant === 'primary' && "bg-primary-500 text-white",
                        child.badge.variant === 'secondary' && "bg-secondary-500 text-white",
                        child.badge.variant === 'accent' && "bg-accent-500 text-white",
                        child.badge.variant === 'verified' && "bg-status-verified text-white",
                        child.badge.variant === 'blockchain' && "bg-status-blockchain text-white",
                      )}>
                        {child.badge.text}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <Link
          to={item.path}
          className={cn(
            "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
            isActive
              ? "bg-primary-100 text-primary-900 dark:bg-primary-900/20 dark:text-primary-100"
              : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
            item.vehicleCentric && "border-l-4 border-primary-500 pl-2",
            isCollapsed && "justify-center"
          )}
          onClick={handleClick}
        >
          {isCollapsed ? (
            <Tooltip content={item.name}>{item.icon}</Tooltip>
          ) : (
            navItemContent
          )}
        </Link>
      )}
    </li>
  );
};

/**
 * Navigation Badge Component
 */
interface NavigationBadgeProps {
  count: number;
  variant?: 'primary' | 'secondary' | 'accent' | 'verified' | 'blockchain';
}

const NavigationBadge: React.FC<NavigationBadgeProps> = ({ 
  count, 
  variant = 'primary' 
}) => {
  if (count <= 0) return null;
  
  return (
    <span className={cn(
      "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium",
      variant === 'primary' && "bg-primary-500 text-white",
      variant === 'secondary' && "bg-secondary-500 text-white",
      variant === 'accent' && "bg-accent-500 text-white",
      variant === 'verified' && "bg-status-verified text-white",
      variant === 'blockchain' && "bg-status-blockchain text-white",
    )}>
      {count > 99 ? '99+' : count}
    </span>
  );
};

/**
 * Modern Navigation Component
 * 
 * This component implements a modern, responsive navigation system
 * that highlights vehicle-centric features in accordance with
 * the CEO's vision of vehicles as first-class digital entities.
 */
export function ModernNavigation({
  className,
  isCollapsed = false,
  setIsCollapsed,
}: {
  className?: string;
  isCollapsed?: boolean;
  setIsCollapsed?: (isCollapsed: boolean) => void;
}) {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const user = useUserStore(state => state.user);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Determine active state for a navigation item
  const isItemActive = (item: NavigationItem): boolean => {
    if (location.pathname === item.path) return true;
    
    if (item.children) {
      return item.children.some(child => location.pathname === child.path);
    }
    
    return false;
  };
  
  // Toggle sidebar collapse state
  const toggleCollapse = () => {
    if (setIsCollapsed) {
      setIsCollapsed(!isCollapsed);
    }
  };
  
  // Main navigation content
  const navigationContent = (
    <ul className={cn("space-y-1", isCollapsed && "px-2")}>
      {navigationItems.map((item) => (
        <NavigationItem
          key={item.path}
          item={item}
          isActive={isItemActive(item)}
          isMobile={isMobileMenuOpen}
          isCollapsed={isCollapsed}
          onClick={() => setIsMobileMenuOpen(false)}
        />
      ))}
    </ul>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden transform border-r border-neutral-200 bg-white transition-all duration-300 dark:border-neutral-800 dark:bg-neutral-900 lg:flex lg:flex-col",
          isCollapsed ? "w-16" : "w-64",
          className
        )}
      >
        {/* Logo and collapse button */}
        <div className={cn(
          "flex h-16 items-center border-b border-neutral-200 px-4 dark:border-neutral-800",
          isCollapsed ? "justify-center" : "justify-between"
        )}>
          {!isCollapsed && (
            <Link to="/" className="flex items-center">
              <span className="text-xl font-bold text-primary-500">Nuke</span>
            </Link>
          )}
          
          <button
            onClick={toggleCollapse}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={cn("h-6 w-6 transition-transform", isCollapsed && "rotate-180")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
        
        {/* Navigation links */}
        <div className="flex flex-1 flex-col overflow-y-auto py-4">
          {navigationContent}
        </div>
        
        {/* User profile */}
        {isAuthenticated && (
          <div className={cn(
            "border-t border-neutral-200 p-4 dark:border-neutral-800",
            isCollapsed ? "flex justify-center" : ""
          )}>
            {isCollapsed ? (
              <Tooltip content={user?.email || 'Your Profile'}>
                <Link
                  to="/profile"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800"
                >
                  {user?.email?.[0]?.toUpperCase() || 'U'}
                </Link>
              </Tooltip>
            ) : (
              <Link to="/profile" className="flex items-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                  {user?.email?.[0]?.toUpperCase() || 'U'}
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {user?.email || 'User'}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    View profile
                  </p>
                </div>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Mobile Header */}
      <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900 lg:hidden">
        <Link to="/" className="flex items-center">
          <span className="text-xl font-bold text-primary-500">Nuke</span>
        </Link>
        
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          aria-label="Toggle menu"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            {isMobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50" onClick={() => setIsMobileMenuOpen(false)}>
          <div 
            className="absolute right-0 top-0 h-full w-64 bg-white p-4 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-200 pb-4 dark:border-neutral-800">
              <span className="text-xl font-bold text-primary-500">Menu</span>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                aria-label="Close menu"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="mt-4">
              {navigationContent}
            </div>
            
            {isAuthenticated && (
              <div className="mt-auto border-t border-neutral-200 pt-4 dark:border-neutral-800">
                <Link to="/profile" className="flex items-center" onClick={() => setIsMobileMenuOpen(false)}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                    {user?.email?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {user?.email || 'User'}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      View profile
                    </p>
                  </div>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
