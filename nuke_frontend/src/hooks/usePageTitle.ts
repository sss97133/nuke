import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getVehicleIdentityParts } from '../utils/vehicleIdentity';

/**
 * Hook to manage page titles dynamically
 * 
 * Usage:
 *   usePageTitle('My Page Title');
 *   usePageTitle(() => vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'Loading...');
 */
export function usePageTitle(title: string | (() => string)) {
  const location = useLocation();

  useEffect(() => {
    const resolvedTitle = typeof title === 'function' ? title() : title;
    if (resolvedTitle) {
      document.title = `${resolvedTitle} | n-zero`;
    }
  }, [title, location.pathname]);
}

/**
 * Utility to generate vehicle page title from vehicle data
 */
export function getVehicleTitle(vehicle: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  normalized_model?: string | null;
  trim?: string | null;
  series?: string | null;
  transmission?: string | null;
  transmission_model?: string | null;
} | null): string {
  if (!vehicle) {
    return 'Vehicle Profile';
  }

  const identity = getVehicleIdentityParts(vehicle as any);
  const title = [...identity.primary, ...identity.differentiators].join(' ').trim();
  return title || 'Vehicle Profile';
}

/**
 * Utility to generate page title from route
 * Used as fallback when page doesn't set its own title
 */
export function getTitleFromRoute(pathname: string): string {
  // Remove leading slash and split
  const segments = pathname.split('/').filter(Boolean);
  
  if (segments.length === 0) {
    return 'n-zero';
  }

  const [first, second, third] = segments;

  // Homepage
  if (first === '' || first === undefined) {
    return 'n-zero';
  }

  // Vehicle routes
  if (first === 'vehicle') {
    if (second === 'add') {
      return 'Add Vehicle';
    }
    if (second === 'list' || second === undefined) {
      return 'Vehicles';
    }
    if (third === 'edit') {
      return 'Edit Vehicle';
    }
    if (third === 'mailbox') {
      return 'Vehicle Mailbox';
    }
    if (third === 'wiring') {
      return 'Wiring Plan';
    }
    if (third === 'work' || third === 'jobs') {
      return 'Vehicle Work';
    }
    // Vehicle profile (second is vehicleId)
    return 'Vehicle Profile';
  }

  // Organization routes
  if (first === 'org') {
    if (second === 'create') {
      return 'Create Organization';
    }
    if (second === 'dashboard') {
      return 'Dashboard';
    }
    return 'Organization';
  }

  // Dealer routes
  if (first === 'dealer') {
    return 'Dealer';
  }

  // Admin routes
  if (first === 'admin') {
    if (second === 'database-audit') {
      return 'Database Audit';
    }
    if (second === 'data-diagnostic') {
      return 'Data Diagnostic';
    }
    if (second === 'test-contributions') {
      return 'Test Contributions';
    }
    return 'Admin';
  }

  // Marketplace routes
  if (first === 'market') {
    return 'Marketplace';
  }

  // Auth routes
  if (first === 'login') {
    return 'Login';
  }
  if (first === 'reset-password') {
    return 'Reset Password';
  }

  // Static pages
  if (first === 'about') {
    return 'About';
  }
  if (first === 'privacy') {
    return 'Privacy Policy';
  }
  if (first === 'terms') {
    return 'Terms of Service';
  }
  if (first === 'data-deletion') {
    return 'Data Deletion';
  }

  // Legacy routes
  if (first === 'profile') {
    return 'Profile';
  }
  if (first === 'capsule') {
    return 'Capsule';
  }
  if (first === 'library') {
    return 'Library';
  }
  if (first === 'auctions') {
    return 'Auctions';
  }
  if (first === 'notifications') {
    return 'Notifications';
  }
  if (first === 'claim-identity') {
    return 'Claim Identity';
  }

  // Default: capitalize first segment
  return first.charAt(0).toUpperCase() + first.slice(1).replace(/-/g, ' ');
}

