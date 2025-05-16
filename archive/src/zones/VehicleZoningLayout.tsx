import React from 'react';
import NavigationZone from './navigation/NavigationZone';
import IdentityZone from './identity/IdentityZone';
import TimelineZone from './timeline/TimelineZone';
import VerificationZone from './verification/VerificationZone';
import CommunityZone from './community/CommunityZone';
import './styles/vehicle-zoning-layout.css';

interface VehicleZoningLayoutProps {
  vehicleId: string;
  activeRoute?: string;
  userProfile?: {
    name: string;
    avatarUrl?: string;
  };
}

/**
 * VehicleZoningLayout Component
 * 
 * Comprehensive layout that implements the zoning architecture:
 * - Organizes vehicle information into distinct functional zones
 * - Follows iOS 18/desktop app aesthetic
 * - Responsive design for all screen sizes
 * - Real vehicle data throughout (no mock data)
 */
const VehicleZoningLayout: React.FC<VehicleZoningLayoutProps> = ({
  vehicleId,
  activeRoute = '/vehicles',
  userProfile = { name: 'User' }
}) => {
  return (
    <div className="vehicle-zoning-layout">
      {/* Navigation Zone - Global app navigation */}
      <header className="layout-nav-container">
        <NavigationZone 
          activeRoute={activeRoute}
          userProfile={userProfile}
        />
      </header>
      
      <main className="layout-content">
        <div className="zone-grid">
          {/* Identity Zone - Core vehicle identity */}
          <section className="zone-grid-item identity-container">
            <IdentityZone vehicleId={vehicleId} />
          </section>
          
          {/* Timeline Zone - Vehicle history */}
          <section className="zone-grid-item timeline-container">
            <TimelineZone vehicleId={vehicleId} />
          </section>
          
          {/* Verification Zone - Trust mechanisms */}
          <section className="zone-grid-item verification-container">
            <VerificationZone vehicleId={vehicleId} />
          </section>
          
          {/* Community Zone - Social interactions and ownership */}
          <section className="zone-grid-item community-container">
            <CommunityZone vehicleId={vehicleId} />
          </section>
        </div>
      </main>
      
      <footer className="layout-footer">
        <div className="footer-content">
          <div className="footer-copyright">
            © {new Date().getFullYear()} Nuke Platform • All Rights Reserved
          </div>
          <div className="footer-links">
            <a href="/privacy" className="footer-link">Privacy</a>
            <a href="/terms" className="footer-link">Terms</a>
            <a href="/support" className="footer-link">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default VehicleZoningLayout;
