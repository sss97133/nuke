import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  HomeIcon, 
  TruckIcon, 
  PlusIcon, 
  UserIcon, 
  CogIcon,
  ChartBarIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
  PhotoIcon,
  DocumentTextIcon,
  BeakerIcon,
  ShieldCheckIcon,
  BriefcaseIcon,
  CameraIcon,
  AcademicCapIcon,
  BuildingOfficeIcon,
  StarIcon,
  UserGroupIcon,
  BuildingStorefrontIcon
} from '@heroicons/react/24/outline';

interface NavigationItem {
  name: string;
  href: string;
  icon: React.ComponentType<any>;
  description?: string;
  badge?: string;
  category: 'main' | 'professional' | 'admin' | 'tools';
}

const navigationItems: NavigationItem[] = [
  // Main Navigation
  { name: 'Discover', href: '/discover', icon: HomeIcon, category: 'main', description: 'Explore vehicles and community' },
  { name: 'All Vehicles', href: '/all-vehicles', icon: TruckIcon, category: 'main' },
  { name: 'My Vehicles', href: '/vehicles', icon: TruckIcon, category: 'main' },
  { name: 'Add Vehicle', href: '/add-vehicle', icon: PlusIcon, category: 'main' },
  { name: 'Dashboard', href: '/dashboard', icon: ChartBarIcon, category: 'main' },
  { name: 'Organizations', href: '/shops', icon: BuildingStorefrontIcon, category: 'main', description: 'Manage your shops and businesses' },
  { name: 'Profile', href: '/profile', icon: UserIcon, category: 'main' },
  { name: 'Viewer Dashboard', href: '/viewer-dashboard', icon: StarIcon, category: 'main', description: 'Your critic profile and activity' },
  { name: 'Interaction Manager', href: '/interaction-manager', icon: UserGroupIcon, category: 'main', description: 'Manage vehicle requests and sessions' },
  
  // Professional Tools
  { name: 'Browse Professionals', href: '/browse-professionals', icon: UsersIcon, category: 'professional', description: 'Find certified mechanics and appraisers' },
  { name: 'Project Management', href: '/project-management', icon: WrenchScrewdriverIcon, category: 'professional', description: 'Manage vehicle projects and tasks' },
  { name: 'Work Timeline', href: '/technician-work-timeline', icon: ChartBarIcon, category: 'professional', description: 'Track professional work sessions' },
  { name: 'Business Dashboard', href: '/business-dashboard', icon: BriefcaseIcon, category: 'professional', description: 'Multi-garage management' },
  
  // Media & Content Tools
  { name: 'Photo Categorizer', href: '/photo-categorizer', icon: PhotoIcon, category: 'tools', description: 'AI-powered image organization' },
  { name: 'Document Capture', href: '/document-capture', icon: CameraIcon, category: 'tools', description: 'Live document scanning' },
  { name: 'Dropbox Import', href: '/dropbox-import', icon: DocumentTextIcon, category: 'tools', description: 'Import vehicle data from Dropbox' },
  { name: 'Live Feed', href: '/live-feed', icon: ChartBarIcon, category: 'tools', description: 'Real-time activity monitoring' },
  
  // Admin & Development
  { name: 'Database Audit', href: '/database-audit', icon: ShieldCheckIcon, category: 'admin', description: 'Database health monitoring' },
  { name: 'Data Diagnostic', href: '/data-diagnostic', icon: BeakerIcon, category: 'admin', description: 'System diagnostics and testing' },
  { name: 'Admin Dashboard', href: '/admin', icon: ShieldCheckIcon, category: 'admin', description: 'Admin approval dashboard' },
  { name: 'Admin Verifications', href: '/admin/verifications', icon: ShieldCheckIcon, category: 'admin', description: 'Manage user verifications' },
  { name: 'Shipping Settings', href: '/admin/shipping-settings', icon: ShieldCheckIcon, category: 'admin', description: 'Configure shipping integrations' },
  { name: 'x402 Payment Settings', href: '/admin/x402-settings', icon: ShieldCheckIcon, category: 'admin', description: 'Configure blockchain payments' },
  { name: 'Test Contributions', href: '/test-contributions', icon: BeakerIcon, category: 'admin', description: 'Test contribution system' },
];

interface MainNavigationProps {
  className?: string;
}

const MainNavigation: React.FC<MainNavigationProps> = ({ className = '' }) => {
  const location = useLocation();

  const isActive = (href: string) => {
    return location.pathname === href || 
           (href !== '/' && location.pathname.startsWith(href));
  };

  const getItemsByCategory = (category: string) => {
    return navigationItems.filter(item => item.category === category);
  };

  const NavSection = ({ title, items, collapsible = false }: { 
    title: string; 
    items: NavigationItem[]; 
    collapsible?: boolean;
  }) => {
    const [isExpanded, setIsExpanded] = React.useState(!collapsible);

    return (
      <div className="mb-6">
        <div 
          className={`flex items-center justify-between mb-3 ${collapsible ? 'cursor-pointer' : ''}`}
          onClick={() => collapsible && setIsExpanded(!isExpanded)}
        >
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {title}
          </h3>
          {collapsible && (
            <span className="text-gray-400">
              {isExpanded ? '−' : '+'}
            </span>
          )}
        </div>
        
        {isExpanded && (
          <nav className="space-y-1">
            {items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`group flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors ${
                    active
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                  title={item.description}
                >
                  <item.icon
                    className={`mr-3 h-5 w-5 flex-shrink-0 ${
                      active ? 'text-gray-500' : 'text-gray-400 group-hover:text-gray-500'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.name}</span>
                  {item.badge && (
                    <span className="ml-auto bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Main Navigation */}
      <NavSection title="Main" items={getItemsByCategory('main')} />
      
      {/* Professional Tools */}
      <NavSection title="Professional Tools" items={getItemsByCategory('professional')} collapsible />
      
      {/* Tools & Utilities */}
      <NavSection title="Tools & Utilities" items={getItemsByCategory('tools')} collapsible />
      
      {/* Admin & Development */}
      {process.env.NODE_ENV === 'development' && (
        <NavSection title="Admin & Development" items={getItemsByCategory('admin')} collapsible />
      )}
      
      {/* Footer */}
      <div className="mt-auto pt-4 border-t border-gray-200">
        <div className="px-2">
          <p className="text-xs text-gray-500">
            Nuke Platform v0.1.0
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Vehicle-centric digital identity
          </p>
        </div>
      </div>
    </div>
  );
};

export default MainNavigation;
