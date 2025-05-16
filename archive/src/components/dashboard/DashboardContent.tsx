
import React from 'react';
import RecentActivity from './RecentActivity';
import QuickActions from './QuickActions';
import { GeoFencedDiscovery } from '../discovery/GeoFencedDiscovery';

const DashboardContent = () => {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <div className="col-span-full">
        <GeoFencedDiscovery />
      </div>
      <RecentActivity />
      <QuickActions />
    </div>
  );
};

export default DashboardContent;
