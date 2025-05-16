import React, { useState } from 'react';
import { ZoneLayout } from '../shared/ZoneLayout';
import '../styles/navigation-zone.css';

interface NavigationZoneProps {
  className?: string;
  activeRoute?: string;
  userProfile?: {
    name: string;
    avatarUrl?: string;
  };
}

/**
 * Navigation Zone Component
 * 
 * Provides global application navigation and user controls:
 * - Primary navigation (Vehicles, Marketplace, Community)
 * - User profile access
 * - Context-aware secondary navigation
 * - Search and discovery tools
 */
export const NavigationZone: React.FC<NavigationZoneProps> = ({
  className = '',
  activeRoute = '',
  userProfile = { name: 'Guest User' }
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Primary navigation items
  const primaryNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊', path: '/dashboard' },
    { id: 'vehicles', label: 'Vehicles', icon: '🚗', path: '/vehicles' },
    { id: 'marketplace', label: 'Marketplace', icon: '🏪', path: '/marketplace' },
    { id: 'community', label: 'Community', icon: '👥', path: '/community' },
    { id: 'verification', label: 'Verification', icon: '✓', path: '/verification' }
  ];

  // Context-aware secondary navigation
  // These would change based on the active primary section
  const getSecondaryNavItems = () => {
    switch (activeRoute.split('/')[1]) {
      case 'vehicles':
        return [
          { id: 'my-vehicles', label: 'My Vehicles', path: '/vehicles/my-vehicles' },
          { id: 'followed', label: 'Followed', path: '/vehicles/followed' },
          { id: 'add-vehicle', label: 'Add Vehicle', path: '/vehicles/add' }
        ];
      case 'marketplace':
        return [
          { id: 'browse', label: 'Browse', path: '/marketplace/browse' },
          { id: 'auctions', label: 'Auctions', path: '/marketplace/auctions' },
          { id: 'stakes', label: 'Fractional Stakes', path: '/marketplace/stakes' }
        ];
      case 'community':
        return [
          { id: 'professionals', label: 'Professionals', path: '/community/professionals' },
          { id: 'events', label: 'Events', path: '/community/events' },
          { id: 'discussions', label: 'Discussions', path: '/community/discussions' }
        ];
      case 'verification':
        return [
          { id: 'ptz-centers', label: 'PTZ Centers', path: '/verification/ptz-centers' },
          { id: 'schedule', label: 'Schedule', path: '/verification/schedule' },
          { id: 'certificates', label: 'Certificates', path: '/verification/certificates' }
        ];
      default:
        return [];
    }
  };

  const secondaryNavItems = getSecondaryNavItems();

  // Handle navigation
  const handleNavigate = (path: string) => {
    // In a real app, this would use a router
    console.log(`Navigating to: ${path}`);
    window.location.href = path;
  };

  // Handle search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      console.log(`Searching for: ${searchQuery}`);
      // In a real app, this would trigger a search
      // handleNavigate(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  return (
    <ZoneLayout 
      hideHeader={true}
      className={`navigation-zone ${className}`}
    >
      <div className="navigation-content">
        <div className="navigation-primary">
          <div className="nav-logo">
            <span className="logo-icon">🚗</span>
            <span className="logo-text">NUKE</span>
          </div>
          
          <div className="nav-search-container">
            <form 
              className={`nav-search ${isSearchFocused ? 'focused' : ''}`}
              onSubmit={handleSearchSubmit}
            >
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search vehicles, parts, users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
              />
              {searchQuery && (
                <button 
                  type="button" 
                  className="search-clear"
                  onClick={() => setSearchQuery('')}
                >
                  ×
                </button>
              )}
            </form>
          </div>
          
          <div className="user-profile">
            <div className="user-avatar">
              {userProfile.avatarUrl ? (
                <img src={userProfile.avatarUrl} alt={userProfile.name} />
              ) : (
                <div className="avatar-placeholder">
                  {userProfile.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <span className="user-name">{userProfile.name}</span>
          </div>
        </div>
        
        <div className="navigation-menu">
          <div className="primary-menu">
            {primaryNavItems.map((item) => (
              <div 
                key={item.id}
                className={`nav-item ${activeRoute.startsWith(item.path) ? 'active' : ''}`}
                onClick={() => handleNavigate(item.path)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </div>
            ))}
          </div>
          
          {secondaryNavItems.length > 0 && (
            <div className="secondary-menu">
              {secondaryNavItems.map((item) => (
                <div 
                  key={item.id}
                  className={`nav-item secondary ${activeRoute === item.path ? 'active' : ''}`}
                  onClick={() => handleNavigate(item.path)}
                >
                  <span className="nav-label">{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="quick-actions">
          <button className="quick-action-btn">
            <span className="action-icon">📸</span>
            <span className="action-label">Capture</span>
          </button>
          <button className="quick-action-btn">
            <span className="action-icon">📄</span>
            <span className="action-label">Add Document</span>
          </button>
          <button className="quick-action-btn">
            <span className="action-icon">💰</span>
            <span className="action-label">Invest</span>
          </button>
        </div>
      </div>
    </ZoneLayout>
  );
};

export default NavigationZone;
