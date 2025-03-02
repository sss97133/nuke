
import React from 'react';
import RecentActivity from './RecentActivity';
import QuickActions from './QuickActions';

const DashboardContent = () => {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <RecentActivity />
      <QuickActions />
    </div>
  );
};

export default DashboardContent;
