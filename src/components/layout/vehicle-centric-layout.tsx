import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ModernNavigation } from '@/components/navigation/modern-navigation';
import { tokens } from '@/styles/design-tokens';
import { useUserStore } from '@/stores/userStore';
import { useAuth } from '@/providers/AuthProvider';
import { FloatingActionButton } from '@/components/ui/floating-action-button';

/**
 * Vehicle-Centric Layout
 * 
 * This layout component implements the CEO's vision of vehicle-first design,
 * treating vehicles as first-class digital entities with persistent identities
 * throughout their lifecycle. All UI elements are organized around this
 * vehicle-centric philosophy, with a focus on:
 * 
 * 1. Timeline-based event aggregation
 * 2. Verification level indicators
 * 3. Trust mechanisms
 * 4. Multi-source data aggregation
 * 5. Vehicle-centric navigation and organization
 */
export function VehicleCentricLayout({
  children,
  showNavigation = true,
  showQuickActions = true,
  className,
}: {
  children?: React.ReactNode;
  showNavigation?: boolean;
  showQuickActions?: boolean;
  className?: string;
}) {
  const { isAuthenticated } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const user = useUserStore(state => state.user);
  
  // Track scroll position for header styling
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      setIsScrolled(scrollTop > 10);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  // Quick action for adding a vehicle - the primary action in a vehicle-centric application
  const handleAddVehicle = () => {
    // Navigate to add vehicle page or open modal
    window.location.href = '/add-vehicle';
  };
  
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Modern Navigation Sidebar */}
      {showNavigation && (
        <ModernNavigation
          isCollapsed={isCollapsed}
          setIsCollapsed={setIsCollapsed}
        />
      )}
      
      {/* Main Content */}
      <main
        className={cn(
          "flex flex-col min-h-screen transition-all duration-300",
          showNavigation && "lg:pl-64",
          showNavigation && isCollapsed && "lg:pl-16",
          className
        )}
      >
        {/* Header - shows on scroll */}
        {isAuthenticated && (
          <header
            className={cn(
              "sticky top-0 z-30 w-full border-b border-transparent bg-white/0 transition-all duration-300 dark:bg-neutral-950/0",
              isScrolled && "border-neutral-200 bg-white/90 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-950/90"
            )}
          >
            <div className="container mx-auto flex h-16 items-center justify-between px-4">
              {/* Page title - only shows when scrolled */}
              {isScrolled && (
                <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  Nuke
                </h1>
              )}
              
              {/* Right-side actions */}
              <div className="ml-auto flex items-center space-x-4">
                {/* Theme toggle - uses system color scheme */}
                <button
                  className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  aria-label="Toggle theme"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                  </svg>
                </button>
                
                {/* Notifications */}
                <button
                  className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  aria-label="Notifications"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                </button>
                
                {/* User profile */}
                <div className="hidden sm:block">
                  <div className="flex items-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                      {user?.email?.[0]?.toUpperCase() || 'U'}
                    </div>
                    <div className="ml-2">
                      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        {user?.email || 'User'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </header>
        )}
        
        {/* Content */}
        <div className="flex-1 p-4 md:p-6">
          {children || <Outlet />}
        </div>
        
        {/* Footer */}
        <footer className="border-t border-neutral-200 bg-white py-6 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="container mx-auto px-4">
            <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
              <div className="flex items-center">
                <span className="text-lg font-bold text-primary-500">Nuke</span>
                <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-400">
                  &copy; {new Date().getFullYear()} Vehicle Digital Identity Platform
                </span>
              </div>
              
              <div className="flex space-x-6">
                <a
                  href="/terms"
                  className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  Terms
                </a>
                <a
                  href="/privacy"
                  className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  Privacy
                </a>
                <a
                  href="/contact"
                  className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  Contact
                </a>
              </div>
            </div>
          </div>
        </footer>
      </main>
      
      {/* Quick Action Button (only for authenticated users) */}
      {isAuthenticated && showQuickActions && (
        <FloatingActionButton
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          }
          label="Add Vehicle"
          onClick={handleAddVehicle}
          variant="primary"
          tooltip="Add a new vehicle to track"
        />
      )}
    </div>
  );
}

/**
 * Vehicle Detail Layout
 * 
 * A specialized layout for vehicle detail pages that emphasizes
 * the timeline and persistent identity of vehicles.
 */
export function VehicleDetailLayout({
  children,
  vehicleName,
  vehicleImage,
  trustScore,
  verificationLevel,
  className,
}: {
  children: React.ReactNode;
  vehicleName: string;
  vehicleImage?: string;
  trustScore?: number;
  verificationLevel?: keyof typeof tokens.verificationLevels;
  className?: string;
}) {
  return (
    <VehicleCentricLayout showQuickActions={false}>
      {/* Vehicle header with image */}
      <div className="relative mb-6 h-48 overflow-hidden rounded-xl bg-gradient-to-r from-primary-500 to-primary-700 sm:h-64">
        {vehicleImage ? (
          <img
            src={vehicleImage}
            alt={vehicleName}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <svg
              className="h-24 w-24 text-white opacity-50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M5 17h14v-5.5a5.5 5.5 0 0 0-11 0V17zm6 0v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1M4 5h16l-2 5H6zM12 4V2M7 9l-3 3M17 9l3 3"
              />
            </svg>
          </div>
        )}
        
        {/* Gradient overlay for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        
        {/* Vehicle information */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{vehicleName}</h1>
          
          {/* Verification badge */}
          {verificationLevel && (
            <div className="mt-2">
              <span className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                verificationLevel === 'BLOCKCHAIN' && "bg-status-blockchain text-white",
                verificationLevel === 'PTZ_VERIFIED' && "bg-status-verified text-white",
                verificationLevel === 'PROFESSIONAL' && "bg-status-success text-white",
                verificationLevel === 'MULTI_SOURCE' && "bg-secondary-500 text-white",
                verificationLevel === 'SINGLE_SOURCE' && "bg-neutral-500 text-white",
              )}>
                {verificationLevel.replace('_', ' ')}
              </span>
            </div>
          )}
        </div>
      </div>
      
      {/* Main content */}
      <div className={cn("", className)}>
        {children}
      </div>
    </VehicleCentricLayout>
  );
}

/**
 * Vehicle Marketplace Layout
 * 
 * A specialized layout for the marketplace that emphasizes
 * tokenized vehicle assets and ownership tracking.
 */
export function VehicleMarketplaceLayout({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <VehicleCentricLayout>
      {/* Marketplace header */}
      <div className="mb-6 bg-gradient-to-r from-accent-500 to-accent-700 p-6 rounded-xl">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Vehicle Marketplace</h1>
        <p className="mt-2 text-accent-100">
          Discover and trade vehicles with verified digital identities
        </p>
      </div>
      
      {/* Main content */}
      <div className={cn("", className)}>
        {children}
      </div>
    </VehicleCentricLayout>
  );
}
